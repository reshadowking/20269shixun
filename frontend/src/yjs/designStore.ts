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

import { LOCKED_EDITABLE_STYLE_KEYS } from '@/design/beautify'
import { applyNodePatch, type DesignDiff } from '@/design/applyDiff'
import { findNode as findPlainNode } from '@/design/tree'
import type { DesignNode } from '@/design/types'

const DESIGN_MAP = 'design'
const ROOT_KEY = 'root'

/** 光标节流：awareness 是逐帧可写的，但没必要（60ms ≈ 16fps 已经足够顺滑） */
const CURSOR_THROTTLE_MS = 60

/**
 * 撤销步骤的元数据（挂在 Yjs `stackItem.meta` 上）。
 * 用途：撤销前判断"这一步还该不该照原样执行"——见 `undo()`。
 */
const UNDO_META = 'design-undo-meta'

interface UndoMeta {
  kind: 'property' | 'structural'
  /** 我这一步写进去的值（用于判断"是否已被队友覆盖"） */
  writes: Array<{ nodeId: string; key: string; value: unknown }>
  /** 结构性步骤涉及的节点（用于判断"之后是否被队友改过"） */
  nodeIds: string[]
  at: number
  /**
   * 这一步的**单调序号**（不是时间戳！）。
   * 踩过：同一毫秒内的"本地步 → 远端改"用 `Date.now()` 比较会漏判（`>` 不成立），
   * 于是该弹的确认不弹。序号比较没有这个问题。
   */
  seq: number
}

/** 属性值比较：原始值直接比，对象/数组比序列化（props 里可能存对象） */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/** 我这一步改了哪些字段（用于判断"是否还被队友覆盖"） */
function diffWrites(nodeId: string, prev: DesignNode, next: DesignNode): UndoMeta['writes'] {
  const out: UndoMeta['writes'] = []
  if (prev.x !== next.x) out.push({ nodeId, key: 'x', value: next.x })
  if (prev.y !== next.y) out.push({ nodeId, key: 'y', value: next.y })
  if (prev.hidden !== next.hidden) out.push({ nodeId, key: 'hidden', value: next.hidden })
  for (const [k, v] of Object.entries(next.props ?? {})) {
    if ((prev.props ?? {})[k] !== v) out.push({ nodeId, key: `props.${k}`, value: v })
  }
  for (const [k, v] of Object.entries(next.style ?? {})) {
    if ((prev.style ?? {})[k] !== v) out.push({ nodeId, key: `style.${k}`, value: v })
  }
  return out
}

export interface CursorPos {
  x: number
  y: number
}

export interface RemoteCursor extends CursorPos {
  clientId: number
  name: string
  color: string
  /** 队友当前选中的元素（如 `按钮「提交」`）——光标标签里带上，回答"在改哪儿" */
  label?: string
}

/** 由 clientId 推导一个稳定颜色（同一队友每次进来颜色一致） */
function cursorColor(clientId: number): string {
  return `hsl(${(clientId * 47) % 360} 72% 45%)`
}

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
  /** T46a-3d：网关拒绝连接（4403）时的回调——由上层显示"无权进入该协作房间"。 */
  onForbidden?: () => void
  /**
   * 2026-09-16：撤销的两种"要人拍板"的情况，交给页面做 UI（store 不弹窗）。
   * - `onUndoBlocked`：这一步写进去的值已被队友改掉 → **跳过并告知**（Yjs 的撤销在这种情况下会静默失效）；
   * - `onUndoConfirm`：结构性步骤（新增/删除/换父级）涉及的节点之后被队友改过 →
   *   撤销会连队友的改动一起撤掉，必须先确认（返回 false = 取消，栈保留）。
   */
  onUndoBlocked?: (reason: string) => void
  onUndoConfirm?: (reason: string) => boolean

  /** 当前步骤的元数据（在事务内写入，事务结束时由 stack-item-added 取走） */
  private pendingUndoMeta: Omit<UndoMeta, 'at' | 'seq'> | null = null
  /** 单调递增的操作序号：本地步骤与远端改动共用一条线，用来判断"谁在谁之后" */
  private opSeq = 0
  /** 节点最近一次"被远端改过"的序号（节点级，避免把不相关的节点算进来） */
  private lastRemoteChangeSeq = new Map<string, number>()
  /** 上一次的节点快照（用于 diff 出远端改了哪些节点） */
  private nodeSnapshots = new Map<string, string>()

  /**
   * T46a-3c：把登录 JWT 作为 WS 查询参数带上（网关用它验签 + 查成员资格）。
   *
   * 用 `params` 而不是拼进 serverUrl——y-websocket 会自己拼 `/<room>`，拼在 serverUrl 上会拼错。
   * 没有 token（未登录/未启用网关）时返回 undefined，**行为与改造前完全一致**。
   */
  private wsOptions(): { params: Record<string, string> } | undefined {
    try {
      const token = localStorage.getItem('design-tool-token') // 与 lib/api.ts 的 TOKEN_KEY 一致
      return token ? { params: { token } } : undefined
    } catch {
      return undefined
    }
  }
  /** 快照缓存：文档无更新时返回同一引用（React useSyncExternalStore 要求 getSnapshot 引用稳定） */
  private cached: DesignNode | null = null
  /** AI 版本快照栈（E3-2/P0-1）：优化与增量编辑前保存，恢复时整体重置文档 */
  private snapshots: DesignNode[] = []
  private static MAX_SNAPSHOTS = 10
  /** D5：presence/连接状态订阅集合（provider 重建后自动重挂，调用方无需重新订阅） */
  private presenceCbs = new Set<() => void>()
  private statusCbs = new Set<(status: string) => void>()
  /** 操作级撤销/重做（缺陷 13）：只跟踪本地用户操作（LOCAL_ORIGIN） */
  undoManager: Y.UndoManager
  /** 缺陷 3：美化阶段版面锁定——只有效果白名单的 style 键允许改动（写入层强制，不靠 UI 禁用） */
  private beautifyLock = false
  /** T46a-3e：只读访客（viewer）——所有写方法在数据层直接拒绝 */
  private readOnly = false
  private blockedCbs = new Set<(reason: string) => void>()
  /** T2：连接端点。构造只记忆、不建立连接——provider 的生灭与 React effect 配对 */
  private wsEndpoint: string | undefined
  private roomName: string
  /** T2：最近一次广播的 presence 昵称，provider 重建（重挂/重连）后自动写回 */
  private presenceName: string | null = null
  /** 2026-09-16：最近一次光标节流时间（见 publishCursor） */
  private lastCursorAt = 0

  private handleAwareness = (): void => {
    this.presenceCbs.forEach((cb) => cb())
  }

  private handleStatus = (s: { status: string }): void => {
    this.statusCbs.forEach((cb) => cb(s.status))
  }

  /** 把 awareness/status 事件挂到当前 provider（constructor 与 reconnectRoom 后调用） */
  private bindProviderEvents(): void {
    const provider = this.provider
    if (!provider) return
    provider.awareness.on('change', this.handleAwareness)
    provider.on('status', this.handleStatus)
  }

  constructor(wsUrl?: string, initialDesign?: DesignNode, room = 'design-room') {
    this.ydoc = new Y.Doc()
    this.designMap = this.ydoc.getMap(DESIGN_MAP)
    this.wsEndpoint = wsUrl
    this.roomName = room
    if (initialDesign && this.designMap.size === 0) {
      this.ydoc.transact(() => {
        this.designMap.set(ROOT_KEY, plainToY(initialDesign))
      }, RESET_ORIGIN)
    }
    // T2 presence 泄漏修复：provider 不再在构造期创建（原实现在渲染期建连、
    // 组件卸载后从不销毁，socket/awareness 残留导致服务端在线人数虚增）。
    // 连接改由 useDesignStore 的 effect 调 connectProvider 建立、cleanup 调 disconnectProvider 断开。
    // 操作级撤销：绑定整棵设计树（designMap 及其子树），只记录本地用户操作
    this.undoManager = new Y.UndoManager([this.designMap], {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: 0, // 画布操作是离散事务，无需合并窗口，保证 canUndo 即时可用
    })
    // 缓存失效与订阅解耦：任何 update（本地事务/协作同步）都使快照失效
    this.ydoc.on('update', (_update, origin) => {
      this.cached = null
      // 2026-09-16：只有**远端**改动才记账（本地/重置/撤销自身都不算"队友改的"）
      if (origin === RESET_ORIGIN) {
        // 整树替换（打开稿件/AI 恢复）：只更新基线，别把全树算成"队友改的"
        this._trackRemoteChanges(false)
        return
      }
      if (this._isLocalOrigin(origin)) return
      this._trackRemoteChanges(true)
    })
    // 撤销步骤的元数据：事务结束时把 pendingUndoMeta 挂到栈项上
    this.undoManager.on('stack-item-added', (event: { stackItem: { meta: Map<unknown, unknown> } }) => {
      if (!this.pendingUndoMeta) return
      event.stackItem.meta.set(UNDO_META, {
        ...this.pendingUndoMeta,
        at: Date.now(),
        seq: ++this.opSeq,
      } satisfies UndoMeta)
      this.pendingUndoMeta = null
    })
    // 初始化基线快照：构造期写入初始设计时 update 处理器还没挂上，这里补一次，
    // 否则第一笔"远端改动"会被当成基线更新（跳过记账），结构性步骤就永远不弹确认。
    this._trackRemoteChanges(false)
  }

  destroy() {
    this.provider?.destroy()
    this.ydoc.destroy()
  }

  /** T2：按端点确保 provider 存在（幂等）。与 disconnectProvider 配对使用：
   * StrictMode 的 mount→cleanup→mount 语义下经历断开→重连，ydoc/撤销栈不受影响。 */
  connectProvider(wsUrl?: string, room?: string): void {
    if (wsUrl !== undefined) this.wsEndpoint = wsUrl
    if (room !== undefined) this.roomName = room
    if (!this.wsEndpoint || this.provider) return
    this.provider = new WebsocketProvider(this.wsEndpoint, this.roomName, this.ydoc, this.wsOptions())
    this.provider.on('connection-close', (event: CloseEvent | null) => {
      // 4403 = 网关判定"未授权/非成员"（见 docker/collab-gateway）；其余关闭码交给默认重连逻辑
      if (event?.code === 4403) this.onForbidden?.()
    })
    this.bindProviderEvents()
    this._reapplyPresence()
  }

  /** T2：仅销毁协作连接（awareness 从服务端移除、socket 关闭），store 本体保持可用 */
  disconnectProvider(): void {
    if (this.provider) {
      this.provider.destroy()
      this.provider = null
    }
  }

  /** B3-1：room 重建（新建保存为正式设计后迁移到 design-{id} 协作房间）。
   * destroy 旧 provider 并用同一 ydoc 建新 provider——保留本地编辑、撤销栈与会话状态，
   * 避免整页导航刷新丢失未保存内容。T2：换房间后 presence 昵称自动写回新 provider。 */
  reconnectRoom(wsUrl: string | undefined, newRoom: string): void {
    if (this.provider) {
      this.provider.destroy()
      this.provider = null
    }
    this.wsEndpoint = wsUrl
    this.roomName = newRoom
    if (wsUrl) {
      this.provider = new WebsocketProvider(wsUrl, newRoom, this.ydoc, this.wsOptions())
      this.bindProviderEvents()
      this._reapplyPresence()
    }
  }

  // ---- D5：协作在场感（presence：在线用户/连接状态）----

  /** 广播本地在场状态（用户昵称；URL ?user= 可区分多标签演示）。
   * T2：昵称被记忆，provider 重建（StrictMode 重挂/room 迁移）后由 _reapplyPresence 写回 */
  setPresence(userName: string): void {
    this.presenceName = userName
    this.provider?.awareness.setLocalStateField('user', { name: userName })
  }

  /** T2：把最近一次 presence 昵称写回当前 provider（无 provider 时跳过） */
  private _reapplyPresence(): void {
    if (this.presenceName !== null && this.provider) {
      this.provider.awareness.setLocalStateField('user', { name: this.presenceName })
    }
  }

  // ---- 2026-09-16：光标级 presence（把"谁在线"变成"谁在哪"）----

  /**
   * 广播本地光标（画布世界坐标）；传 null 表示离开画布（立即清掉，不受节流影响）。
   * 无 provider（本地模式/单测）时静默跳过——与 presence 的处理一致。
   */
  publishCursor(pos: CursorPos | null): void {
    if (!this.provider) return
    if (pos !== null) {
      const now = Date.now()
      if (now - this.lastCursorAt < CURSOR_THROTTLE_MS) return
      this.lastCursorAt = now
    }
    this.provider.awareness.setLocalStateField('cursor', pos)
  }

  /**
   * 广播"我正在编辑什么"（选中元素的简短描述，如 `按钮「提交」`）。
   * 空选择就清掉——队友不该看到你早已不看的元素还挂着一个标签。
   */
  publishSelection(label: string): void {
    if (!this.provider) return
    this.provider.awareness.setLocalStateField('selection', label ? { label } : null)
  }

  /** 队友光标（排除自己）：只有同时带 cursor 与昵称的状态才会画出来 */
  get remoteCursors(): RemoteCursor[] {
    const awareness = this.provider?.awareness
    if (!awareness) return []
    const out: RemoteCursor[] = []
    for (const [clientId, state] of awareness.getStates()) {
      if (clientId === awareness.clientID) continue
      const cursor = (state as { cursor?: CursorPos | null } | undefined)?.cursor
      const name = (state as { user?: { name?: unknown } } | undefined)?.user?.name
      if (!cursor || typeof cursor.x !== 'number' || typeof cursor.y !== 'number') continue
      const label = (state as { selection?: { label?: unknown } | null } | undefined)?.selection?.label
      out.push({
        clientId,
        x: cursor.x,
        y: cursor.y,
        name: typeof name === 'string' && name ? name : '队友',
        color: cursorColor(clientId),
        label: typeof label === 'string' && label ? label : undefined,
      })
    }
    return out
  }

  /** 订阅 awareness 变化（他人进出/状态更新）；无 provider（本地模式）时立即回调一次 */
  subscribePresence(cb: () => void): () => void {
    this.presenceCbs.add(cb)
    cb()
    if (!this.provider) return () => this.presenceCbs.delete(cb)
    return () => this.presenceCbs.delete(cb)
  }

  /** 当前房间在线人数（含自己）；无 provider 时视为单人本地会话 */
  get onlineCount(): number {
    return this.provider?.awareness.getStates().size ?? 1
  }

  /** 在线用户昵称列表（无名字的远端状态排除） */
  get onlineUsers(): string[] {
    const awareness = this.provider?.awareness
    if (!awareness) return []
    const users: string[] = []
    for (const state of awareness.getStates().values()) {
      const name = (state as { user?: { name?: unknown } } | undefined)?.user?.name
      if (typeof name === 'string' && name) users.push(name)
    }
    return users
  }

  /** 订阅 y-websocket 连接状态（connecting/connected/disconnected），断线提示用 */
  subscribeStatus(cb: (status: string) => void): () => void {
    this.statusCbs.add(cb)
    return () => this.statusCbs.delete(cb)
  }

  // ---- 缺陷 3：美化阶段版面锁定（数据写入层强制）----

  setBeautifyLock(locked: boolean): void {
    this.beautifyLock = locked
  }

  get isBeautifyLocked(): boolean {
    return this.beautifyLock
  }

  /** 订阅"越权写入被拒"事件（UI 提示用：拖拽/改文本在锁定阶段会被静默拦下） */
  subscribeBlocked(cb: (reason: string) => void): () => void {
    this.blockedCbs.add(cb)
    return () => this.blockedCbs.delete(cb)
  }

  private _rejectBlocked(reason: string): void {
    this.blockedCbs.forEach((cb) => cb(reason))
  }

  /**
   * T46a-3e：设置只读态（viewer 角色）。协作网关已经在服务端丢弃 viewer 的写消息，
   * 这里是**同一条规则的前端入口**：让"没有权限"立刻可见，而不是拖完之后发现没动、
   * 或者被服务端静默回滚。写方法统一走 `_blockedByRole`，不靠 UI 禁用兜底。
   */
  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly
  }

  get isReadOnly(): boolean {
    return this.readOnly
  }

  /** 只读拦截：返回 true 表示本次写入已被拒绝（并已广播可读原因） */
  private _blockedByRole(what: string): boolean {
    if (!this.readOnly) return false
    this._rejectBlocked(`只读访客：${what}不会生效（需要 owner / editor 权限）`)
    return true
  }

  /**
   * 锁定期的单节点改动白名单：只允许效果白名单 style 键变化。
   * props（文本/内容）、结构（children/type/id）、位置尺寸（x/y/hidden/width/height/layout 等）一律拒绝。
   */
  private _allowedWhileLocked(prev: DesignNode, next: DesignNode): boolean {
    if (!this.beautifyLock) return true
    if (prev.id !== next.id || prev.type !== next.type || prev.componentType !== next.componentType) return false
    if (JSON.stringify(prev.props ?? {}) !== JSON.stringify(next.props ?? {})) return false
    if (prev.x !== next.x || prev.y !== next.y || prev.hidden !== next.hidden) return false
    const prevIds = (prev.children ?? []).map((c) => c.id).join(',')
    const nextIds = (next.children ?? []).map((c) => c.id).join(',')
    if (prevIds !== nextIds) return false
    const prevStyle = (prev.style ?? {}) as Record<string, unknown>
    const nextStyle = (next.style ?? {}) as Record<string, unknown>
    for (const key of new Set([...Object.keys(prevStyle), ...Object.keys(nextStyle)])) {
      if (LOCKED_EDITABLE_STYLE_KEYS.includes(key)) continue
      if (prevStyle[key] !== nextStyle[key]) return false
    }
    return true
  }

  /** 锁定期结构/顺序类操作（新增/删除/复制/移动）一律拒绝 */
  private _blockStructuralWhileLocked(): boolean {
    if (!this.beautifyLock) return false
    this._rejectBlocked('版面已确认：模块新增/删除/排序已锁定，请先解除版面锁定')
    return true
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
    // 2026-09-16：撤销前先看这一步**还该不该照原样执行**（实测结论见卡 §撤销的并发口径）
    const top = this.undoManager.undoStack[this.undoManager.undoStack.length - 1]
    const meta = top?.meta?.get(UNDO_META) as UndoMeta | undefined
    if (meta) {
      if (meta.kind === 'property') {
        // 属性类：该字段已被队友改成别的值 → Yjs 的撤销会静默失效（实测：按钮消耗掉、界面无变化）。
        // 与其"按了没反应、再按一次跳到更早一步"，不如丢掉这一步并明确告诉他。
        const covered = meta.writes.some((w) => !sameValue(this._currentValue(w.nodeId, w.key), w.value))
        if (covered) {
          this.undoManager.undoStack.pop()
          this.undoManager.redoStack.length = 0
          this.onUndoBlocked?.('这一步已被队友的修改覆盖，撤销不生效（已跳过；再按 Ctrl+Z 会撤销你更早的一步）')
          return false
        }
      } else {
        // 结构性：撤销"我加的节点"会连带删掉队友在它上面做的一切（不可逆）→ 必须先问
        const touched = meta.nodeIds.some((id) => (this.lastRemoteChangeSeq.get(id) ?? 0) > meta.seq)
        if (touched && !(this.onUndoConfirm?.('这一步新增/删除的节点之后被队友改过，撤销会连他的改动一起撤掉。仍要撤销吗？') ?? true)) {
          return false // 取消：栈保留，下次再问
        }
      }
    }
    if (!this.undoManager.canUndo()) return false
    this.undoManager.undo()
    return true
  }

  /** 队友改了这个节点的哪些值？——节点级作用域，不相关节点不算（见 undo 的噪声检查） */
  private _currentValue(nodeId: string, key: string): unknown {
    const node = findPlainNode(this.getDesign(), nodeId)
    if (!node) return undefined
    if (key === 'x' || key === 'y' || key === 'hidden') return node[key]
    if (key.startsWith('props.')) return node.props?.[key.slice('props.'.length)]
    if (key.startsWith('style.')) return node.style?.[key.slice('style.'.length)]
    return undefined
  }

  /** 本地来源（本地操作/重置/撤销重做自身）——这些不算"队友改的" */
  private _isLocalOrigin(origin: unknown): boolean {
    return origin === LOCAL_ORIGIN || origin === RESET_ORIGIN || origin === this.undoManager
  }

  /**
   * 远端改动记账：diff 出"哪些节点变了"并打时间戳。
   * mark=false 时只更新基线（用于 resetDesign 这类本地整体替换，避免下次 diff 把全树算成"队友改的"）。
   */
  private _trackRemoteChanges(mark: boolean): void {
    const next = new Map<string, string>()
    const collect = (node: DesignNode): void => {
      next.set(node.id, JSON.stringify(node))
      for (const child of node.children ?? []) collect(child)
    }
    collect(this.getDesign())
    const first = this.nodeSnapshots.size === 0
    if (mark && !first) {
      const seq = ++this.opSeq
      for (const [id, json] of next) {
        if (this.nodeSnapshots.get(id) !== json) this.lastRemoteChangeSeq.set(id, seq)
      }
    }
    this.nodeSnapshots = next
  }

  /**
   * 测试专用缝隙：模拟"队友改了某个节点"（与 `__setStorageForTests` 同一套约定）。
   * 走真实 Yjs 事务 + 非本地 origin，因此和线上远端改动的落地路径一致。
   */
  __applyRemoteForTests(nodeId: string, updater: (node: DesignNode) => DesignNode): void {
    this.ydoc.transact(() => {
      const root = this.designMap.get(ROOT_KEY) as YNode | undefined
      const target = root ? findYNode(root, nodeId) : null
      if (target) this._applyUpdate(target, updater(yToPlain(target)))
    }, 'remote-test-origin')
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
    if (this._blockedByRole('修改节点')) return
    this.ydoc.transact(
      () => {
        const root = this.designMap.get(ROOT_KEY) as YNode | undefined
        if (!root) return
        const target = findYNode(root, id)
        if (!target) return
        const prev = yToPlain(target)
        const next = updater(prev)
        if (!this._allowedWhileLocked(prev, next)) {
          this._rejectBlocked('版面已确认：仅允许修改样式效果（布局/文本/结构已锁定）')
          return
        }
        this._applyUpdate(target, next)
        this.pendingUndoMeta = { kind: 'property', writes: diffWrites(id, prev, next), nodeIds: [id] }
      },
      LOCAL_ORIGIN,
    )
  }

  /** 批量更新多个节点（缺陷 1 多选属性编辑 / P1 转自由画布）：单事务单撤销步 */
  updateMany(ids: string[], updater: (node: DesignNode, index: number) => DesignNode) {
    if (this._blockedByRole('批量修改节点')) return
    this.ydoc.transact(
      () => {
        const root = this.designMap.get(ROOT_KEY) as YNode | undefined
        if (!root) return
        // 锁定阶段：任一批次含越权改动则整批拒绝（原子语义，避免半应用）
        const targets = ids
          .map((id, index) => {
            const target = findYNode(root, id)
            if (!target) return null
            const prev = yToPlain(target)
            return { target, prev, next: updater(prev, index) }
          })
          .filter((t): t is { target: YNode; prev: DesignNode; next: DesignNode } => t !== null)
        if (targets.some((t) => !this._allowedWhileLocked(t.prev, t.next))) {
          this._rejectBlocked('版面已确认：仅允许修改样式效果（布局/文本/结构已锁定）')
          return
        }
        for (const t of targets) this._applyUpdate(t.target, t.next)
        this.pendingUndoMeta = {
          kind: 'property',
          writes: targets.flatMap((t) => diffWrites(t.target.get('id') as string, t.prev, t.next)),
          nodeIds: targets.map((t) => t.target.get('id') as string),
        }
      },
      LOCAL_ORIGIN,
    )
  }

  /**
   * 转自由画布（P1-13 像素级冻结）：父容器 layout 与全部子节点坐标在**同一事务**内提交，
   * 保证一次 Ctrl+Z 完整还原（此前的 updateNode + updateMany 两次调用会产生两个撤销步，
   * 撤销后只剩 layout:'free' 而坐标被回滚，子节点会全部堆到左上角）。
   *
   * 锁定期直接拒绝：layout 不在效果白名单内，_allowedWhileLocked 也会拦下（双保险）。
   */
  convertToFreeLayout(
    parentId: string,
    updates: Array<{ id: string; x: number; y: number; width: number; height: number }>,
    containerSize?: { width: number; height: number },
  ): { ok: boolean; reason?: string } {
    if (this._blockedByRole('转自由画布')) return { ok: false, reason: 'read-only' }
    if (this.beautifyLock) {
      this._rejectBlocked('版面已确认：请先解除版面锁定再转自由画布')
      return { ok: false, reason: 'locked' }
    }
    let ok = false
    this.ydoc.transact(
      () => {
        const root = this.designMap.get(ROOT_KEY) as YNode | undefined
        if (!root) return
        const parent = findYNode(root, parentId)
        if (!parent) return

        const prevParent = yToPlain(parent)
        const nextParent: DesignNode = {
          ...prevParent,
          style: {
            ...(prevParent.style ?? {}),
            layout: 'free' as const,
            // 2026-09-17：容器自己的盒子也要一起冻。子节点变绝对定位后不再撑高父容器，
            // 而模板/AI 产物的容器多是 auto 高度 → 只冻结子节点会把容器塌成"只剩 padding"
            // 的一条（E2E 实测 demo 根节点 276 → 64），背景/圆角消失、子节点浮在容器外。
            ...(containerSize
              ? { width: Math.round(containerSize.width), height: Math.round(containerSize.height) }
              : {}),
          },
        }
        if (!this._allowedWhileLocked(prevParent, nextParent)) {
          this._rejectBlocked('版面已确认：仅允许修改样式效果（布局/文本/结构已锁定）')
          return
        }

        // 先收集全部目标，任一越权则整批不落（原子语义）
        const targets: Array<{ target: YNode; next: DesignNode }> = []
        for (const u of updates) {
          const target = findYNode(root, u.id)
          if (!target) continue
          const prev = yToPlain(target)
          const next: DesignNode = {
            ...prev,
            x: Math.round(u.x),
            y: Math.round(u.y),
            style: { ...(prev.style ?? {}), width: u.width, height: u.height },
          }
          if (!this._allowedWhileLocked(prev, next)) {
            this._rejectBlocked('版面已确认：仅允许修改样式效果（布局/文本/结构已锁定）')
            return
          }
          targets.push({ target, next })
        }

        this._applyUpdate(parent, nextParent)
        for (const t of targets) this._applyUpdate(t.target, t.next)
        this.pendingUndoMeta = { kind: 'structural', writes: [], nodeIds: [parentId, ...updates.map((u) => u.id)] }
        ok = true
      },
      LOCAL_ORIGIN,
    )
    return ok ? { ok: true } : { ok: false, reason: 'blocked' }
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
    if (this._blockedByRole('删除节点')) return
    if (this._blockStructuralWhileLocked()) return
    this.pendingUndoMeta = { kind: 'structural', writes: [], nodeIds: [id] }
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
    if (this._blockedByRole('复制节点')) return
    if (this._blockStructuralWhileLocked()) return
    this.pendingUndoMeta = { kind: 'structural', writes: [], nodeIds: [id] }
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

  /**
   * 落地 AI 修改的**差量**（2026-09-17，替代原来的整树 `resetDesign`）。
   *
   * 两条语义要点：
   * 1) 只写被改动的节点 → 队友在这期间对**其它节点**的并发改动不会被整树替换吞掉；
   * 2) 期间**临时关掉 beautifyLock 守卫**：锁定的权威判定在**服务端闸门**
   *    （`/api/apply-locked-edit` 按会话查表），客户端这把锁只是 UX 护栏。
   *    旧实现 `resetDesign` 本来就不经过该守卫；若这里不关，服务端放行的合法效果
   *    会被客户端二次否决（实测：`locked-edit` 用例「合法效果照常落地」直接红）。
   */
  applyAiDiff(diff: DesignDiff): void {
    if (diff.replace) {
      this.resetDesign(diff.replace)
      return
    }
    const lock = this.beautifyLock
    this.beautifyLock = false
    try {
      for (const id of diff.removed) this.removeNode(id)
      for (const m of diff.moved) this.moveNodeTo(m.id, m.toParent, m.index)
      for (const u of diff.updated) this.updateNode(u.id, (cur) => applyNodePatch(cur, u.patch))
      for (const a of diff.added) this.insertChild(a.parentId, a.node, a.index)
      for (const o of diff.orders) this.reorderChildren(o.parentId, o.ids)
    } finally {
      this.beautifyLock = lock
    }
  }

  /** 在指定父节点 children 末尾插入新节点（组件面板添加）；index 指定插入位置（E3-3 推荐落位） */
  insertChild(parentId: string, node: DesignNode, index?: number) {
    if (this._blockedByRole('添加组件')) return
    if (this._blockStructuralWhileLocked()) return
    this.pendingUndoMeta = { kind: 'structural', writes: [], nodeIds: [node.id, parentId] }
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
    if (this._blockedByRole('撤销优化')) return false
    // 2026-09-17：版面锁定（版面已确认）阶段不允许**整树回退**——它会把布局/尺寸一起改回去，
    // 与「转自由画布」「智能优化」同一口径（后两者早已被拦）。
    // 三处内部回退（优化失败 / 自动冻结回滚 / 转自由画布失败）都在"锁定已被前置拦截"的路径里，
    // 所以这里加锁不会破坏那些回滚。
    if (this.beautifyLock) {
      this._rejectBlocked('版面已确认：不能回退到旧版面（会改变布局/尺寸），请先解除版面锁定')
      return false
    }
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
    if (this._blockedByRole('移动图层')) return
    if (this._blockStructuralWhileLocked()) return
    this.pendingUndoMeta = { kind: 'structural', writes: [], nodeIds: [nodeId, newParentId] }
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
    if (this._blockedByRole('调整顺序')) return
    if (this._blockStructuralWhileLocked()) return
    this.pendingUndoMeta = { kind: 'structural', writes: [], nodeIds: [childId, parentId] }
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

  /**
   * 按目标顺序重排某父级的子节点（单个事务；AI 差量落地用，2026-09-17）。
   *
   * 存在的理由：`moveNodeTo` 只在**换父级**时被记录，同父级的顺序变化（ops 的 move、
   * "把某个模块挪到最上面"）不会产生任何 diff 条目 —— 落地时被整条丢掉。
   * 逐位就位：第 i 位不是期望 id 就把期望节点搬过来（先插副本再删原件，与 moveChild 同款，
   * 规避 Yjs 同事务"先删后插"的集成问题）；期望 id 已不存在（被队友删了）则跳过，不硬造。
   */
  reorderChildren(parentId: string, orderedIds: string[]): void {
    if (this._blockedByRole('调整顺序')) return
    if (this._blockStructuralWhileLocked()) return
    this.pendingUndoMeta = { kind: 'structural', writes: [], nodeIds: [parentId, ...orderedIds] }
    this.ydoc.transact(
      () => {
        const root = this.designMap.get(ROOT_KEY) as YNode | undefined
        const parent = root ? findYNode(root, parentId) : null
        const children = parent?.get('children')
        if (!(children instanceof Y.Array)) return
        for (let i = 0; i < orderedIds.length; i++) {
          const arr = children.toArray() as YNode[]
          const want = orderedIds[i]
          if (arr[i]?.get('id') === want) continue
          const from = arr.findIndex((c) => c?.get('id') === want)
          if (from < 0) continue
          children.insert(i, [plainToY(yToPlain(arr[from]))])
          children.delete(from < i ? from : from + 1, 1)
        }
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
