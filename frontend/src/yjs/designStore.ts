/**
 * Yjs 设计存储（v2.2 §8.2：DesignNode → Y.Map/Y.Array；读取 toJSON，修改走 transaction）。
 * 设计 JSON 是唯一数据源，Yjs 文档是它的协作载体；编辑操作在此统一为 transaction，
 * 保证多人编辑（y-websocket 同步）、撤销（操作级 UndoManager + AI 版本快照）与
 * AI 生成（origin=ai-generator）共享同一通道。
 *
 * 结构：
 *   ydoc.getMap('design') → { root: YNode }
 *   YNode = Y.Map { id, type, componentType, props: Y.Map, style: Y.Map, x, y, children: Y.Array<YNode> }
 */
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

import type { DesignNode } from '@/design/types'

const DESIGN_MAP = 'design'
const ROOT_KEY = 'root'

/** 本地用户操作的 origin（操作级 UndoManager 只跟踪它；AI 生成/协作远程/快照恢复不记录） */
export const LOCAL_ORIGIN = 'local-user-op'
const RESET_ORIGIN = 'reset-design'

type YNode = Y.Map<unknown>

function plainToY(node: DesignNode): YNode {
  const yMap = new Y.Map<unknown>()
  yMap.set('id', node.id)
  yMap.set('type', node.type)
  if (node.componentType) yMap.set('componentType', node.componentType)
  if (node.x !== undefined) yMap.set('x', node.x)
  if (node.y !== undefined) yMap.set('y', node.y)
  if (node.hidden === true) yMap.set('hidden', true)
  if (node.props && Object.keys(node.props).length) {
    const p = new Y.Map<unknown>()
    for (const [k, v] of Object.entries(node.props)) p.set(k, v)
    yMap.set('props', p)
  }
  if (node.style && Object.keys(node.style).length) {
    const s = new Y.Map<unknown>()
    for (const [k, v] of Object.entries(node.style)) s.set(k, v)
    yMap.set('style', s)
  }
  if (node.children?.length) {
    const arr = new Y.Array<unknown>()
    arr.insert(0, node.children.map(plainToY))
    yMap.set('children', arr)
  }
  return yMap
}

export function yToPlain(yMap: Y.Map<unknown>): DesignNode {
  const node: DesignNode = { id: yMap.get('id') as string, type: yMap.get('type') as DesignNode['type'] }
  const componentType = yMap.get('componentType')
  if (typeof componentType === 'string') node.componentType = componentType as DesignNode['componentType']
  if (typeof yMap.get('x') === 'number') node.x = yMap.get('x') as number
  if (typeof yMap.get('y') === 'number') node.y = yMap.get('y') as number
  if (typeof yMap.get('hidden') === 'boolean') node.hidden = yMap.get('hidden') as boolean
  const props = yMap.get('props')
  if (props instanceof Y.Map) node.props = props.toJSON() as DesignNode['props']
  const style = yMap.get('style')
  if (style instanceof Y.Map) node.style = style.toJSON() as DesignNode['style']
  const children = yMap.get('children')
  if (children instanceof Y.Array) {
    node.children = children.toArray().map((c) => yToPlain(c as YNode))
  }
  return node
}

/** 递归查找 Y 节点 */
function findYNode(yNode: YNode, id: string): YNode | null {
  if (yNode.get('id') === id) return yNode
  const children = yNode.get('children')
  if (!(children instanceof Y.Array)) return null
  for (const c of children.toArray()) {
    const hit = findYNode(c as YNode, id)
    if (hit) return hit
  }
  return null
}

/** 递归查找父 Y 节点 */
function findYParent(yNode: YNode, id: string): { parent: YNode; index: number } | null {
  const children = yNode.get('children')
  if (children instanceof Y.Array) {
    const arr = children.toArray()
    for (let i = 0; i < arr.length; i++) {
      if ((arr[i] as YNode).get('id') === id) return { parent: yNode, index: i }
      const hit = findYParent(arr[i] as YNode, id)
      if (hit) return hit
    }
  }
  return null
}

export class DesignStore {
  ydoc: Y.Doc
  private designMap: Y.Map<unknown>
  provider: WebsocketProvider | null = null
  /** 快照缓存：文档无更新时返回同一引用（React useSyncExternalStore 要求 getSnapshot 引用稳定） */
  private cached: DesignNode | null = null
  /** AI 版本快照栈（E3-2/P0-1）：优化与增量编辑前保存，恢复时整体重置文档 */
  private snapshots: DesignNode[] = []
  private static MAX_SNAPSHOTS = 10
  /** 操作级撤销/重做（缺陷 13）：只跟踪本地用户操作（LOCAL_ORIGIN） */
  undoManager: Y.UndoManager

  constructor(wsUrl?: string, initialDesign?: DesignNode, room = 'design-room') {
    this.ydoc = new Y.Doc()
    this.designMap = this.ydoc.getMap(DESIGN_MAP)
    if (initialDesign && this.designMap.size === 0) {
      this.ydoc.transact(() => {
        this.designMap.set(ROOT_KEY, plainToY(initialDesign))
      }, RESET_ORIGIN)
    }
    if (wsUrl) {
      this.provider = new WebsocketProvider(wsUrl, room, this.ydoc)
    }
    // 操作级撤销：绑定整棵设计树（designMap 及其子树），只记录本地用户操作
    this.undoManager = new Y.UndoManager([this.designMap], {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: 0, // 画布操作是离散事务，无需合并窗口，保证 canUndo 即时可用
    })
    // 缓存失效与订阅解耦：任何 update（本地事务/协作同步）都使快照失效
    this.ydoc.on('update', () => {
      this.cached = null
    })
  }

  destroy() {
    this.provider?.destroy()
    this.ydoc.destroy()
  }

  /** B3-1：room 重建（新建保存为正式设计后迁移到 design-{id} 协作房间）。
   * destroy 旧 provider 并用同一 ydoc 建新 provider——保留本地编辑、撤销栈与会话状态，
   * 避免整页导航刷新丢失未保存内容。 */
  reconnectRoom(wsUrl: string | undefined, newRoom: string): void {
    if (this.provider) {
      this.provider.destroy()
      this.provider = null
    }
    if (wsUrl) {
      this.provider = new WebsocketProvider(wsUrl, newRoom, this.ydoc)
    }
  }

  getDesign(): DesignNode {
    if (this.cached) return this.cached
    const root = this.designMap.get(ROOT_KEY) as YNode | undefined
    this.cached = root ? yToPlain(root) : { id: 'empty', type: 'frame' }
    return this.cached
  }

  /** 订阅文档变化（React 绑定入口） */
  subscribe(cb: () => void): () => void {
    this.ydoc.on('update', cb)
    return () => this.ydoc.off('update', cb)
  }

  /** 操作级撤销（P0-1）：回退最近一次本地用户操作；无可撤销返回 false */
  undo(): boolean {
    if (!this.undoManager.canUndo()) return false
    this.undoManager.undo()
    return true
  }

  /** 操作级重做（P0-1）：恢复被撤销的操作；无重做返回 false */
  redo(): boolean {
    if (!this.undoManager.canRedo()) return false
    this.undoManager.redo()
    return true
  }

  get canUndo(): boolean {
    return this.undoManager.canUndo()
  }

  get canRedo(): boolean {
    return this.undoManager.canRedo()
  }

  /** 通用字段更新：updater 返回新 DesignNode，同步写回 Y 节点（props/style 整表替换保持引用稳定） */
  updateNode(id: string, updater: (node: DesignNode) => DesignNode) {
    this.ydoc.transact(
      () => {
        const root = this.designMap.get(ROOT_KEY) as YNode | undefined
        if (!root) return
        const target = findYNode(root, id)
        if (!target) return
        this._applyUpdate(target, updater(yToPlain(target)))
      },
      LOCAL_ORIGIN,
    )
  }

  /** 批量更新多个节点（缺陷 1 多选属性编辑 / P1 转自由画布）：单事务单撤销步 */
  updateMany(ids: string[], updater: (node: DesignNode, index: number) => DesignNode) {
    this.ydoc.transact(
      () => {
        const root = this.designMap.get(ROOT_KEY) as YNode | undefined
        if (!root) return
        ids.forEach((id, index) => {
          const target = findYNode(root, id)
          if (!target) return
          this._applyUpdate(target, updater(yToPlain(target), index))
        })
      },
      LOCAL_ORIGIN,
    )
  }

  /** updateNode/updateMany 共用的 Y 节点写回逻辑 */
  private _applyUpdate(target: YNode, next: DesignNode) {
    target.set('id', next.id)
    target.set('type', next.type)
    if (next.componentType) target.set('componentType', next.componentType)
    if (next.x !== undefined) target.set('x', next.x)
    if (next.y !== undefined) target.set('y', next.y)
    if (next.hidden !== undefined) target.set('hidden', next.hidden)
    else if (target.has('hidden')) target.delete('hidden')
    const props = target.get('props')
    if (props instanceof Y.Map) {
      for (const k of Array.from(props.keys())) props.delete(k)
      for (const [k, v] of Object.entries(next.props ?? {})) props.set(k, v)
    } else if (next.props && Object.keys(next.props).length) {
      const p = new Y.Map<unknown>()
      for (const [k, v] of Object.entries(next.props)) p.set(k, v)
      target.set('props', p)
    }
    const style = target.get('style')
    if (style instanceof Y.Map) {
      for (const k of Array.from(style.keys())) style.delete(k)
      for (const [k, v] of Object.entries(next.style ?? {})) style.set(k, v)
    } else if (next.style && Object.keys(next.style).length) {
      const s = new Y.Map<unknown>()
      for (const [k, v] of Object.entries(next.style)) s.set(k, v)
      target.set('style', s)
    }
  }

  removeNode(id: string) {
    this.ydoc.transact(
      () => {
        const root = this.designMap.get(ROOT_KEY) as YNode | undefined
        if (!root) return
        if (root.get('id') === id) {
          this.designMap.delete(ROOT_KEY)
          return
        }
        const found = findYParent(root, id)
        if (!found) return
        ;(found.parent.get('children') as Y.Array<unknown>).delete(found.index, 1)
      },
      LOCAL_ORIGIN,
    )
  }

  duplicateNode(id: string) {
    this.ydoc.transact(
      () => {
        const root = this.designMap.get(ROOT_KEY) as YNode | undefined
        if (!root) return
        const target = findYNode(root, id)
        if (!target) return
        const copy = plainToY(duplicatePlain(yToPlain(target)))
        if (root.get('id') === id) {
          const wrapper = new Y.Map<unknown>()
          wrapper.set('id', `frame-${Date.now().toString(36)}`)
          wrapper.set('type', 'frame')
          const styleMap = new Y.Map<unknown>()
          styleMap.set('layout', 'column')
          wrapper.set('style', styleMap)
          const wrapperChildren = new Y.Array<unknown>()
          wrapperChildren.insert(0, [root, copy])
          wrapper.set('children', wrapperChildren)
          this.designMap.set(ROOT_KEY, wrapper)
          return
        }
        const found = findYParent(root, id)
        if (!found) return
        const children = found.parent.get('children') as Y.Array<unknown>
        children.push([copy])
      },
      LOCAL_ORIGIN,
    )
  }

  /** 重置整个文档为指定设计（AI 生成/快照恢复/打开设计；不入操作级撤销栈） */
  resetDesign(design: DesignNode) {
    // 整树替换后旧操作失去上下文，清空操作级撤销/重做栈
    this.undoManager.clear()
    this.ydoc.transact(
      () => {
        const root = this.designMap.get(ROOT_KEY)
        if (root instanceof Y.Map) root.clear()
        this.designMap.set(ROOT_KEY, plainToY(design))
      },
      RESET_ORIGIN,
    )
  }

  /** 在指定父节点 children 末尾插入新节点（组件面板添加）；index 指定插入位置（E3-3 推荐落位） */
  insertChild(parentId: string, node: DesignNode, index?: number) {
    this.ydoc.transact(
      () => {
        const root = this.designMap.get(ROOT_KEY) as YNode | undefined
        if (!root) return
        const parent = findYNode(root, parentId)
        if (!parent) return
        let children: Y.Array<unknown>
        const existing = parent.get('children')
        if (existing instanceof Y.Array) {
          children = existing
        } else {
          children = new Y.Array<unknown>()
          parent.set('children', children)
        }
        const at = index === undefined ? children.length : Math.max(0, Math.min(children.length, index))
        children.insert(at, [plainToY(node)])
      },
      LOCAL_ORIGIN,
    )
  }

  /** 智能优化前保存快照（E3-2/P0-1 AI 版本回退）；栈上限 10 */
  pushSnapshot() {
    this.snapshots.push(this.getDesign())
    if (this.snapshots.length > DesignStore.MAX_SNAPSHOTS) this.snapshots.shift()
  }

  /** 恢复最近一次快照（撤销 AI 版本）；无快照返回 false */
  popSnapshot(): boolean {
    const snapshot = this.snapshots.pop()
    if (!snapshot) return false
    this.resetDesign(snapshot)
    return true
  }

  get canUndoOptimize(): boolean {
    return this.snapshots.length > 0
  }

  /** 跨父移动（图层管理：拖拽改父级）；目标不能是自己的后代 */
  moveNodeTo(nodeId: string, newParentId: string, index: number) {
    this.ydoc.transact(
      () => {
        const root = this.designMap.get(ROOT_KEY) as YNode | undefined
        if (!root) return
        const target = findYNode(root, nodeId)
        if (!target) return
        if (newParentId === nodeId) return
        // 防循环：目标父不能是 nodeId 的后代
        if (findYNode(target, newParentId)) return
        // 先拷贝（delete 后 Y.Map 字段会变 undefined，必须先读）
        const copy = plainToY(yToPlain(target))
        // 从原父移除
        const oldParent = findYParent(root, nodeId)
        if (oldParent) {
          const oldChildren = oldParent.parent.get('children') as Y.Array<unknown> | undefined
          oldChildren?.delete(oldParent.index, 1)
        }
        // 插入新父（全新副本，避免复用已删除 item 的 Yjs 集成问题）
        const newParent = findYNode(root, newParentId)
        if (!newParent) return
        let children: Y.Array<unknown>
        const existing = newParent.get('children')
        if (existing instanceof Y.Array) {
          children = existing
        } else {
          children = new Y.Array<unknown>()
          newParent.set('children', children)
        }
        children.insert(Math.max(0, Math.min(children.length, index)), [copy])
      },
      LOCAL_ORIGIN,
    )
  }

  /** flex 布局拖拽重排 */
  moveChild(childId: string, parentId: string, targetIndex: number) {
    this.ydoc.transact(
      () => {
        const root = this.designMap.get(ROOT_KEY) as YNode | undefined
        if (!root) return
        const parent = findYNode(root, parentId)
        if (!parent) return
        const children = parent.get('children')
        if (!(children instanceof Y.Array)) return
        const arr = children.toArray()
        const from = arr.findIndex((c) => (c as YNode).get('id') === childId)
        if (from < 0) return
        // 允许 target = arr.length（插入末尾 = 置底）
        const target = Math.max(0, Math.min(arr.length, targetIndex))
        // 移动后位置（先插后删语义）：from < target 时副本前移一位
        const movedPos = target > from ? target - 1 : target
        if (movedPos === from) return // 位置未变：跳过，避免每次 pointermove 都替换 Yjs item（渲染风暴）
        // 先插入全新副本，再删除原节点（"先删后插"在 Yjs 同一事务内存在索引/集成缺陷；
        // 新副本保证协作端合并语义一致：删除 + 新增）
        children.insert(target, [plainToY(yToPlain(arr[from] as YNode))])
        children.delete(from < target ? from : from + 1, 1)
      },
      LOCAL_ORIGIN,
    )
  }
}

/** 复制 plain 节点（新 id），供 duplicate 使用 */
export function duplicatePlain(node: DesignNode): DesignNode {
  const genId = (prefix: string) =>
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  return {
    ...node,
    id: genId(node.componentType ?? node.type),
    children: node.children?.map(duplicatePlain),
  }
}
