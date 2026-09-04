import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'

import ActivityBar, { ACTIVITY_TITLES } from '@/components/activity/ActivityBar'
import LayerTree from '@/components/activity/LayerTree'
import AIChatPanel from '@/components/chat/AIChatPanel'
import ExportDialog from '@/components/export/ExportDialog'
import HistoryPanel from '@/components/history/HistoryPanel'
import { SaveNameForm } from '@/components/history/SaveNameForm'
import ComponentPalette from '@/components/palette/ComponentPalette'
import ComponentRecommend, { type RecommendItem } from '@/components/props/ComponentRecommend'
import CanvasSettings from '@/components/props/CanvasSettings'
import MultiSelectPanel from '@/components/props/MultiSelectPanel'
import PropertyPanel from '@/components/props/PropertyPanel'
import FollowupModeSelect from '@/components/settings/FollowupModeSelect'
import AlignToolbar from '@/components/toolbar/AlignToolbar'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { BLANK_DESIGN, DEMO_DESIGNS } from '@/design/demoData'
import { loadDraft, saveDraft } from '@/lib/designSession'
import { findNode, findParent as findParentOf, genId } from '@/design/tree'
import type { ComponentType, DesignNode } from '@/design/types'
import { api } from '@/lib/api'
import { deriveCollabRoom, randomRoom } from '@/lib/collabRoom'
import { useDesignStore } from '@/yjs/useDesignStore'

interface OptimizeReport {
  spacing: number
  align: number
  size: number
  total: number
}

/** 工作台：组件面板 + 画布 + 右侧活动栏（P1：活动栏图标 + 展开面板） */
export default function WorkspacePage() {
  const wsUrl = import.meta.env.VITE_WS_URL ?? 'ws://localhost:1234'
  const [searchParams] = useSearchParams()
  // 协作 room（P0-4）：显式 ?room=（E2E/多人同稿）> 已存设计按 design-{id} 隔离 > 其余每标签随机。
  // useRef 懒初始化保证 StrictMode 双渲染下 room 稳定（随机值只生成一次）。
  const roomRef = useRef<string | null>(null)
  if (roomRef.current === null) {
    roomRef.current = deriveCollabRoom(
      searchParams.get('room'),
      searchParams.get('design'),
      randomRoom(),
    )
  }
  const room = roomRef.current
  const designParam = searchParams.get('design')
  const { design, store } = useDesignStore(wsUrl, DEMO_DESIGNS[0], room)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // P1 文件系统（缺陷 5/8/11）：打开保存的设计 / 模板起手 / 草稿 / 空白
  const [loaded, setLoaded] = useState(false)
  const [savedMeta, setSavedMeta] = useState<{ id?: number; name?: string }>({})
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    if (loaded) return
    const run = async () => {
      const designParam = searchParams.get('design')
      const templateParam = searchParams.get('template')
      const from = searchParams.get('from')
      let target: DesignNode | null = null
      let meta: { id?: number; name?: string } = {}
      try {
        if (designParam) {
          const r = await api<{ design: DesignNode; name: string; id: number }>(`/api/designs/${designParam}`)
          target = r.design
          meta = { id: r.id, name: r.name }
        } else if (templateParam) {
          const r = await api<{ design: DesignNode; name: string }>(`/api/generate/templates/${templateParam}`)
          target = r.design
          meta = { name: r.name }
        } else if (from === 'blank' || from === 'draft') {
          const d = loadDraft()
          target = d?.design ?? BLANK_DESIGN
          if (d) meta = { id: d.meta.savedId, name: d.meta.savedName }
        } else if (from === 'demo') {
          const demoId = searchParams.get('demo')
          target = DEMO_DESIGNS.find((d) => d.id === demoId) ?? DEMO_DESIGNS[0]
        }
      } catch {
        target = null
      }
      if (target) {
        store.resetDesign(target)
        setSavedMeta(meta)
      }
      setLoaded(true)
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // P1 草稿自动保存（缺陷 5/8：刷新/误关不丢；300ms 防抖）
  useEffect(() => {
    if (!loaded) return
    const timer = window.setTimeout(() => saveDraft(design, { savedId: savedMeta.id, savedName: savedMeta.name }), 300)
    return () => window.clearTimeout(timer)
  }, [design, savedMeta, loaded])

  // 保存到后端（缺陷 16/17）：未命名先弹命名框，已命名直接 PUT
  const handleSave = () => {
    if (saving) return
    if (savedMeta.id !== undefined) {
      setSaving(true)
      setSaveError('')
      api(`/api/designs/${savedMeta.id}`, {
        method: 'PUT',
        body: JSON.stringify({ design }),
      })
        .then(() => setSaving(false))
        .catch(() => {
          setSaving(false)
          setSaveError('保存失败：网络或服务器错误。草稿已自动保存在本地，可稍后重试。')
        })
      return
    }
    setSaveDialogOpen(true)
  }

  const confirmSave = async (name: string) => {
    if (!name.trim()) return
    setSaving(true)
    setSaveError('')
    try {
      const r = await api<{ id: number; name: string }>('/api/designs', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), design }),
      })
      setSavedMeta({ id: r.id, name: r.name })
      setSaveDialogOpen(false)
    } catch (err) {
      // P0-5：保存失败必须可见（此前静默/未处理，用户误以为已保存到后端）
      const msg = err instanceof Error ? err.message : String(err)
      setSaveError(`保存失败：${msg}`)
    } finally {
      setSaving(false)
    }
  }

  // 深色模式：只切换工作台 UI（shadcn dark class），不改变设计稿画布（v2.2 §5.1/§12）
  const [dark, setDark] = useState(() => localStorage.getItem('design-dark') === '1')
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('design-dark', dark ? '1' : '0')
  }, [dark])

  // AI 生成中：画布锁定（v2.2 §8.8）
  const [generating, setGenerating] = useState(false)

  // 画布背景网格点（P2-11，localStorage 记忆）
  const [showGrid, setShowGrid] = useState(() => localStorage.getItem('design-grid') !== '0')

  // 选中单个节点时显示属性
  const selectedNode = useMemo(() => {
    if (selectedIds.size !== 1) return null
    return findNode(design, [...selectedIds][0])
  }, [design, selectedIds])

  // 缺陷 1：多选时展示共有属性批量编辑
  const multiNodes = useMemo(() => {
    if (selectedIds.size < 2) return []
    return [...selectedIds]
      .map((id) => findNode(design, id))
      .filter((n): n is DesignNode => n !== null)
  }, [design, selectedIds])

  // 底部状态栏选中信息
  const selectionInfo = useMemo(() => {
    if (selectedIds.size !== 1 || !selectedNode) return null
    return {
      type: selectedNode.componentType ?? selectedNode.type,
      id: selectedNode.id,
      x: selectedNode.x ?? 0,
      y: selectedNode.y ?? 0,
      w: typeof selectedNode.style?.width === 'number' ? selectedNode.style.width : 'auto',
      h: typeof selectedNode.style?.height === 'number' ? selectedNode.style.height : 'auto',
    }
  }, [selectedIds, selectedNode])

  // 右侧活动面板：点击图标展开，再次点击收起
  const [activePanel, setActivePanel] = useState<string | null>('props')
  const togglePanel = (key: string) => setActivePanel((prev) => (prev === key ? null : key))

  // 左侧组件库折叠
  const [paletteCollapsed, setPaletteCollapsed] = useState(false)

  const handleMoveLayer = (dir: 'top' | 'up' | 'down' | 'bottom') => {
    if (!selectedNode) return
    const parent = findNode(design, selectedNode.id) ? findParentOf(design, selectedNode.id) : null
    if (!parent) return
    const siblings = parent.children ?? []
    const from = siblings.findIndex((s) => s.id === selectedNode.id)
    if (from < 0) return
    // 层级语义：children 末尾 = 最后渲染 = 最上层；开头 = 最下层
    // moveChild(target) 的实际落位：target > from 时为 target-1，target < from 时为 target
    // 因此上移（目标 from+1）需传 from+2；置顶传 length；下移/置底直接传目标位
    const target = dir === 'top' ? siblings.length : dir === 'up' ? from + 2 : dir === 'down' ? from - 1 : 0
    store.moveChild(selectedNode.id, parent.id, target)
  }

  /** 容器切到自由布局：为尚无坐标的子节点初始化位置（P3） */
  const handleSwitchToFree = () => {
    if (!selectedNode) return
    const container = findNode(design, selectedNode.id)
    if (!container?.children?.length) return
    container.children.forEach((child, index) => {
      if (child.x === undefined || child.y === undefined) {
        store.updateNode(child.id, (n) => ({ ...n, x: 40 + index * 190, y: 40 }))
      }
    })
  }

  const handleAdd = (node: DesignNode) => {
    const parentId = selectedNode?.id ?? design.id
    store.insertChild(parentId, node)
  }

  /** 组件库拖入画布：落点在自由布局根容器时设置坐标，否则追加 */
  const handleDropComponent = (type: string, x: number, y: number) => {
    const node: DesignNode = {
      id: genId(type),
      type: 'component',
      componentType: type as DesignNode['componentType'],
      props: {},
      style: { width: 200 },
    }
    if (design.style?.layout === 'free') {
      node.x = Math.max(0, Math.round(x))
      node.y = Math.max(0, Math.round(y))
    }
    store.insertChild(design.id, node)
  }

  // ---- E3-2：智能布局优化（快照撤销 + 优化报告）----
  const [optimizing, setOptimizing] = useState(false)
  const [optimizeReport, setOptimizeReport] = useState<OptimizeReport | null>(null)
  const [undoCount, setUndoCount] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')

  const handleOptimize = async () => {
    setOptimizing(true)
    try {
      store.pushSnapshot()
      setUndoCount((c) => c + 1)
      const resp = await api<{ design: DesignNode; report: OptimizeReport }>('/api/optimize-layout', {
        method: 'POST',
        body: JSON.stringify({ design }),
      })
      store.resetDesign(resp.design)
      setSelectedIds(new Set())
      setOptimizeReport(resp.report)
    } catch (err) {
      // 失败：弹回快照，画布不动
      store.popSnapshot()
      setUndoCount((c) => Math.max(0, c - 1))
      setOptimizeReport(null)
      setErrorMsg(err instanceof Error ? `优化失败：${err.message}` : '优化失败')
    } finally {
      setOptimizing(false)
    }
  }

  /** P1-13（缺陷 6 替代方案）：flex/网格布局 → 自由画布（子节点铺网格坐标，可拖拽） */
  const handleConvertToFree = () => {
    if (!design.children?.length) return
    const children = design.children
    const sheetW = typeof design.style?.width === 'number' ? design.style.width : 800
    const perRow = Math.max(1, Math.floor(Math.max(240, sheetW) / 230))
    store.updateNode(design.id, (n) => ({ ...n, style: { ...(n.style ?? {}), layout: 'free' as const } }))
    store.updateMany(children.map((c) => c.id), (n, index) => ({
      ...n,
      x: (index % perRow) * 220 + 24,
      y: Math.floor(index / perRow) * 180 + 24,
    }))
    setSelectedIds(new Set())
  }

  /** P0-1 操作级撤销/重做（缺陷 13）：用户编辑步骤，Ctrl+Z / Ctrl+Shift+Z */
  const handleUndoOp = () => {
    if (store.undo()) {
      setSelectedIds(new Set())
      setHighlightIds(new Set())
    }
  }

  const handleRedoOp = () => {
    if (store.redo()) {
      setSelectedIds(new Set())
      setHighlightIds(new Set())
    }
  }

  const handleUndo = () => {
    if (store.popSnapshot()) {
      setUndoCount((c) => Math.max(0, c - 1))
      setSelectedIds(new Set())
      setOptimizeReport(null)
      setHighlightIds(new Set())
    }
  }

  // ---- P0-1 增量编辑：被修改节点高亮（3 秒后消失）----
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set())

  const handleIncrementalEdit = (newDesign: DesignNode, changedIds: string[]) => {
    store.pushSnapshot()
    setUndoCount((c) => c + 1)
    store.resetDesign(newDesign)
    setSelectedIds(new Set())
    setHighlightIds(new Set(changedIds))
    window.setTimeout(() => setHighlightIds(new Set()), 5000)
  }

  // ---- E3-3：组件推荐（右键菜单浮层 + 落位）----
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string | null } | null>(null)
  const [recommendPop, setRecommendPop] = useState<{ x: number; y: number; containerId: string } | null>(null)
  /** P0-2 导出代码对话框 */
  const [exportOpen, setExportOpen] = useState(false)

  const handleRecommendAdd = (targetId: string, item: RecommendItem) => {
    const props = { ...(item.default_props ?? {}) }
    const styleHint = (props.style_hint ?? {}) as Record<string, unknown>
    delete props.style_hint
    const node: DesignNode = {
      id: genId(item.component_type),
      type: 'component',
      componentType: item.component_type as ComponentType,
      props,
      style: { width: 200, ...styleHint },
    }
    store.insertChild(targetId, node, item.suggested_index)
    setRecommendPop(null)
    setCtxMenu(null)
  }

  return (
    <div className="flex h-screen flex-col" data-testid="workspace-page">
      <header className="flex h-12 items-center justify-between border-b px-4">
        <div className="flex items-center gap-4">
          <span className="font-semibold">AI 原生设计工作台 <span className="text-xs font-normal text-muted-foreground">v0.2</span></span>
          <AlignToolbar design={design} selectedIds={selectedIds} store={store} />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            data-testid="optimize-layout"
            disabled={optimizing}
            onClick={handleOptimize}
          >
            ✨ 智能优化布局
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            data-testid="export-code"
            onClick={() => setExportOpen(true)}
          >
            ⬇ 导出代码
          </Button>
          {design.style?.layout !== 'free' && design.children && design.children.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              data-testid="convert-free"
              title="转为自由画布后子节点可自由拖拽"
              onClick={handleConvertToFree}
            >
              🔓 转自由画布
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            data-testid="undo-op"
            disabled={!store.canUndo}
            title="撤销（Ctrl+Z）"
            onClick={handleUndoOp}
          >
            ↩ 撤销
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            data-testid="redo-op"
            disabled={!store.canRedo}
            title="重做（Ctrl+Shift+Z）"
            onClick={handleRedoOp}
          >
            ↪ 重做
          </Button>
          {undoCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              data-testid="undo-optimize"
              onClick={handleUndo}
            >
              ↩ 撤销优化
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {/* P1 文件系统（缺陷 5/8/16/17）：主页 + 文件名 + 保存；demo 切换已迁至主页 */}
          <span className="flex items-center gap-1 font-medium text-foreground" data-testid="design-name" title={savedMeta.name ?? '未命名'}>
            {savedMeta.name ?? '未命名'}
            {saving && <span className="text-[10px] text-muted-foreground">保存中…</span>}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            data-testid="save-design"
            disabled={saving}
            onClick={handleSave}
          >
            💾 保存
          </Button>
          <Link to="/" className="hover:text-foreground" data-testid="go-home">← 主页</Link>
          <Link to="/api-config" className="hover:text-foreground">API 配置</Link>
          <span data-testid="selection-count">{selectedIds.size > 0 ? `已选 ${selectedIds.size} 个节点` : ''}</span>
        </div>
      </header>
      <main className="flex flex-1 overflow-hidden">
        {/* 左侧：组件库（可折叠，P2） */}
        <aside
          className="shrink-0 border-r bg-background transition-[width] duration-200"
          style={{ width: paletteCollapsed ? 44 : 192 }}
        >
          <ComponentPalette
            collapsed={paletteCollapsed}
            onToggle={() => setPaletteCollapsed((c) => !c)}
            onAdd={handleAdd}
          />
        </aside>

        {/* 中间：画布（AI 生成期间锁定） */}
        <div
          className="relative flex-1"
          onPointerDown={() => {
            setCtxMenu(null)
            setRecommendPop(null)
          }}
        >
          <CanvasWithSelection
            design={design}
            store={store}
            selectedIds={selectedIds}
            onSelectChange={setSelectedIds}
            onDropComponent={handleDropComponent}
            showGrid={showGrid}
            onCanvasContextMenu={(nodeId, x, y) => setCtxMenu({ x, y, nodeId })}
            highlightIds={highlightIds}
          />
          {generating && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/60" data-testid="canvas-lock">
              <span className="rounded-lg bg-background px-4 py-2 text-sm shadow">AI 生成中，画布已锁定…</span>
            </div>
          )}
          {/* E3-2：优化报告（可一键撤销） */}
          {optimizeReport && (
            <div
              className="absolute left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-2 rounded-lg border bg-background px-4 py-2 text-xs shadow"
              data-testid="optimize-report"
            >
              <span>
                已优化 {optimizeReport.spacing} 处间距、{optimizeReport.align} 处对齐、{optimizeReport.size} 处尺寸
              </span>
              <button className="text-primary hover:underline" data-testid="optimize-report-undo" onClick={handleUndo}>
                撤销
              </button>
              <button
                className="text-muted-foreground hover:text-foreground"
                data-testid="optimize-report-close"
                onClick={() => setOptimizeReport(null)}
              >
                ✕
              </button>
            </div>
          )}
          {/* E3-3：右键菜单 */}
          {ctxMenu && (
            <div
              className="absolute z-50 w-44 rounded-lg border bg-background p-1 shadow-lg"
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
              data-testid="context-menu"
            >
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-40"
                data-testid="ctx-recommend"
                disabled={!ctxMenu.nodeId}
                onClick={() => {
                  if (!ctxMenu.nodeId) return
                  setRecommendPop({ x: ctxMenu.x, y: ctxMenu.y, containerId: ctxMenu.nodeId })
                  setCtxMenu(null)
                }}
              >
                ✨ 推荐组件
              </button>
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                data-testid="ctx-optimize"
                onClick={() => {
                  setCtxMenu(null)
                  handleOptimize()
                }}
              >
                ✨ 智能优化布局
              </button>
              {ctxMenu.nodeId && (
                <>
                  <div className="my-1 border-t" />
                  <button
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                    data-testid="ctx-duplicate"
                    onClick={() => {
                      store.duplicateNode(ctxMenu.nodeId!)
                      setCtxMenu(null)
                    }}
                  >
                    复制
                  </button>
                  <button
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-destructive hover:bg-accent"
                    data-testid="ctx-delete"
                    onClick={() => {
                      store.removeNode(ctxMenu.nodeId!)
                      setSelectedIds(new Set())
                      setCtxMenu(null)
                    }}
                  >
                    删除
                  </button>
                </>
              )}
            </div>
          )}
          {/* E3-3：推荐浮层（右键触发，挂载即分析） */}
          {recommendPop && (
            <ComponentRecommend
              design={design}
              containerId={recommendPop.containerId}
              floating={{ x: recommendPop.x, y: recommendPop.y }}
              onAdd={handleRecommendAdd}
              onClose={() => setRecommendPop(null)}
            />
          )}
          {errorMsg && (
            <div className="absolute bottom-3 left-1/2 z-40 -translate-x-1/2 rounded-lg border bg-background px-4 py-2 text-xs text-destructive shadow" data-testid="canvas-error">
              {errorMsg}
            </div>
          )}
          {saveError && (
            <div className="absolute bottom-12 left-1/2 z-40 -translate-x-1/2 rounded-lg border bg-background px-4 py-2 text-xs text-destructive shadow" data-testid="save-error">
              {saveError}
            </div>
          )}
        </div>

        {/* 右侧：活动面板 + 活动栏（P1） */}
        <div className="flex">
          {activePanel && (
            <aside className="w-80 shrink-0 overflow-hidden border-l bg-background" data-testid="activity-panel" data-panel={activePanel}>
              <div className="flex h-10 items-center justify-between border-b px-3">
                <span className="text-sm font-medium">{ACTIVITY_TITLES[activePanel]}</span>
                <button
                  className="rounded p-1 hover:bg-accent"
                  data-testid="panel-close"
                  title="收起面板"
                  onClick={() => setActivePanel(null)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="h-[calc(100%-40px)]">
                {activePanel === 'props' && multiNodes.length >= 2 && (
                  <MultiSelectPanel
                    nodes={multiNodes}
                    onUpdateMany={(updater) => store.updateMany(multiNodes.map((n) => n.id), updater)}
                    onDeleteAll={() => {
                      multiNodes.forEach((n) => store.removeNode(n.id))
                      setSelectedIds(new Set())
                    }}
                  />
                )}
                {activePanel === 'props' && multiNodes.length < 2 && (
                  selectedNode ? (
                    <PropertyPanel
                      node={selectedNode}
                      design={design}
                      onUpdate={(updater) => store.updateNode(selectedNode.id, updater)}
                      onDelete={() => {
                        store.removeNode(selectedNode.id)
                        setSelectedIds(new Set())
                      }}
                      onMoveLayer={handleMoveLayer}
                      onSwitchToFree={handleSwitchToFree}
                      onAddRecommend={handleRecommendAdd}
                    />
                  ) : (
                    <CanvasSettings root={design} onUpdate={(updater) => store.updateNode(design.id, updater)} />
                  )
                )}
                {activePanel === 'ai' && (
                  <AIChatPanel
                    onGeneratingChange={setGenerating}
                    onGenerate={(generated) => {
                      store.resetDesign(generated)
                      setSelectedIds(new Set())
                    }}
                    design={design}
                    onIncrementalEdit={handleIncrementalEdit}
                    onUndo={handleUndo}
                    canUndo={undoCount > 0}
                    historyScope={designParam ?? undefined}
                  />
                )}
                {activePanel === 'layers' && (
                  <LayerTree design={design} selectedIds={selectedIds} onSelect={(id) => setSelectedIds(new Set([id]))} store={store} />
                )}
                {activePanel === 'history' && (
                  <HistoryPanel
                    design={design}
                    savedId={savedMeta.id}
                    onRestore={(restored: DesignNode) => {
                      store.resetDesign(restored)
                      setSelectedIds(new Set())
                    }}
                    onVersionSaved={() => setSavedMeta((m) => ({ ...m }))}
                  />
                )}
                {activePanel === 'settings' && (
                  <div className="flex flex-col gap-4 p-4" data-testid="settings-panel">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium">深色模式</div>
                        <div className="text-xs text-muted-foreground">只切换工作台界面，不影响设计稿</div>
                      </div>
                      <Switch
                        data-testid="settings-dark"
                        checked={dark}
                        onCheckedChange={(v) => setDark(Boolean(v))}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium">画布网格点</div>
                        <div className="text-xs text-muted-foreground">Figma 风格坐标纸背景</div>
                      </div>
                      <Switch
                        data-testid="settings-grid"
                        checked={showGrid}
                        onCheckedChange={(v) => {
                          setShowGrid(Boolean(v))
                          localStorage.setItem('design-grid', v ? '1' : '0')
                        }}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-sm font-medium">AI 模型</div>
                      <div className="text-xs text-muted-foreground">在「API 配置」页设置多供应商 Key</div>
                      <Link to="/api-config" className="text-xs text-primary hover:underline">前往 API 配置 →</Link>
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-sm font-medium">追问模式（Q1）</div>
                      <FollowupModeSelect />
                    </div>
                  </div>
                )}
              </div>
            </aside>
          )}
          <ActivityBar active={activePanel} onSelect={togglePanel} />
        </div>
      </main>
      {exportOpen && <ExportDialog design={design} onClose={() => setExportOpen(false)} />}
      {saveDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="save-dialog" onClick={() => setSaveDialogOpen(false)}>
          <div className="w-80 rounded-xl border bg-background p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 text-sm font-semibold">保存设计</div>
            <SaveNameForm onCancel={() => setSaveDialogOpen(false)} onConfirm={confirmSave} />
          </div>
        </div>
      )}
      {/* 底部状态栏（P2-13）：选中信息 / 画布尺寸 / 快捷键提示 */}
      <footer className="flex h-8 items-center justify-between border-t bg-background px-4 text-[11px] text-muted-foreground" data-testid="status-bar">
        <span data-testid="status-selection">
          {selectionInfo
            ? `${selectionInfo.type} · ${selectionInfo.id.slice(0, 10)} · x=${selectionInfo.x} y=${selectionInfo.y} · ${selectionInfo.w}×${selectionInfo.h}`
            : `画布 ${typeof design.style?.width === 'number' ? design.style.width : 800}×${typeof design.style?.height === 'number' ? design.style.height : 600}`}
        </span>
        <span className="hidden md:inline">Delete 删除 · Ctrl+D 复制 · Ctrl+滚轮缩放 · 拖空白平移 · 选中后拖手柄调整大小</span>
      </footer>
    </div>
  )
}

/** 画布容器：选择状态桥接 */
import DesignCanvas from '@/canvas/DesignCanvas'

function CanvasWithSelection({
  design,
  store,
  selectedIds,
  onSelectChange,
  onDropComponent,
  showGrid,
  onCanvasContextMenu,
  highlightIds,
}: {
  design: DesignNode
  store: ReturnType<typeof useDesignStore>['store']
  selectedIds: Set<string>
  onSelectChange: (ids: Set<string>) => void
  onDropComponent?: (type: string, x: number, y: number) => void
  showGrid?: boolean
  onCanvasContextMenu?: (nodeId: string | null, x: number, y: number) => void
  highlightIds?: Set<string>
}) {
  return (
    <DesignCanvas
      design={design}
      store={store}
      selectedIds={selectedIds}
      onSelectionChange={onSelectChange}
      onDropComponent={onDropComponent}
      showGrid={showGrid}
      onContextMenu={onCanvasContextMenu}
      highlightIds={highlightIds}
    />
  )
}
