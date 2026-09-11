import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'

import ActivityBar, { ACTIVITY_TITLES } from '@/components/activity/ActivityBar'
import LayerTree from '@/components/activity/LayerTree'
import BeautifyPanel from '@/components/beautify/BeautifyPanel'
import AIChatPanel from '@/components/chat/AIChatPanel'
import { NodeRenderer } from '@/canvas/NodeRenderer'
import { freezeToFreeLayout } from '@/canvas/freeze'
import type { DesignCanvasHandle } from '@/canvas/DesignCanvas'
import { EFFECT_SPECS } from '@/design/beautify'
import { loadBaseSnapshot, saveBaseSnapshot, type BaseSnapshot } from '@/lib/baseSnapshot'
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
import SessionBar from '@/components/chat/SessionBar'
import { deriveCollabRoom } from '@/lib/collabRoom'
import { clearSnapshots, deleteSnapshot, loadSnapshots, saveSnapshot, type SessionSnapshot } from '@/lib/sessionSnapshots'
import { sessionApi, type SessionMeta } from '@/lib/sessionApi'
import { deriveSessionKey, isSessionKey, randomSessionKey, SESSION_PARAM } from '@/lib/sessionKey'
import { migrateLegacySessions } from '@/lib/migrateLegacySessions'
import { useDesignStore } from '@/yjs/useDesignStore'

interface OptimizeReport {
  spacing: number
  align: number
  size: number
  total: number
}

/**
 * 工作台入口（缺陷 4）：解析会话身份并写回 URL，再按会话 key 挂载内部工作台。
 * 切换会话 = navigate 换 ?session= → key 变化 → 整个工作台干净重挂（会话状态天然不串）。
 */
export default function WorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const designParam = searchParams.get('design')
  const sessionParam = searchParams.get(SESSION_PARAM)
  const sessionRef = useRef<string | null>(null)
  if (sessionRef.current === null) {
    // 懒初始化：StrictMode 双渲染下随机值只生成一次，会话身份稳定
    sessionRef.current = deriveSessionKey(sessionParam, designParam, randomSessionKey())
  }
  const sessionKey = isSessionKey(sessionParam) ? (sessionParam as string) : sessionRef.current
  useEffect(() => {
    if (searchParams.get(SESSION_PARAM) === sessionKey) return
    const next = new URLSearchParams(searchParams)
    next.set(SESSION_PARAM, sessionKey)
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey])
  return <WorkspaceInner key={sessionKey} sessionKey={sessionKey} />
}

/** 工作台内部：组件面板 + 画布 + 右侧活动栏（P1：活动栏图标 + 展开面板） */
function WorkspaceInner({ sessionKey }: { sessionKey: string }) {
  const wsUrl = import.meta.env.VITE_WS_URL ?? 'ws://localhost:1234'
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const designParam = searchParams.get('design')
  // 协作 room（P0-4 + 缺陷 4）：?room= > design-{id} > session-{sessionKey}（不再每标签随机）
  const roomRef = useRef<string | null>(null)
  if (roomRef.current === null) {
    roomRef.current = deriveCollabRoom(searchParams.get('room'), designParam, sessionKey)
  }
  const room = roomRef.current
  // D5：presence 昵称（?user= 可区分多标签演示；默认与登录账号一致）
  const userName = searchParams.get('user') ?? 'demo'
  const { design, store } = useDesignStore(wsUrl, DEMO_DESIGNS[0], room)
  /** 转自由画布（P1-13）：测量需要画布的 DOM 与缩放状态，因此由画布暴露能力 */
  const canvasRef = useRef<DesignCanvasHandle>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // P1 文件系统（缺陷 5/8/11）：打开保存的设计 / 模板起手 / 草稿 / 空白
  const [loaded, setLoaded] = useState(false)
  const [savedMeta, setSavedMeta] = useState<{ id?: number; name?: string }>({})
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  /** B3-3：已保存设计的"本地有未同步修改"提示——保存基线 JSON 与当前 design 防抖比对 */
  const [unsaved, setUnsaved] = useState(false)
  const lastSavedJsonRef = useRef<string | null>(null)
  /** D5：协作在场感——在线人数/昵称列表与连接状态 */
  const [online, setOnline] = useState<{ count: number; users: string[] }>({ count: 1, users: [] })
  const [connStatus, setConnStatus] = useState('connecting')

  // D5：presence 广播与订阅（store 内部管理订阅，room 重建后自动重挂）
  useEffect(() => {
    store.setPresence(userName)
    const update = () => setOnline({ count: store.onlineCount, users: store.onlineUsers })
    update()
    const unsubP = store.subscribePresence(update)
    const unsubS = store.subscribeStatus(setConnStatus)
    return () => {
      unsubP()
      unsubS()
    }
  }, [store, userName])

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
          const d = loadDraft(sessionKey)
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

  // P1 草稿自动保存（缺陷 5/8 + 缺陷 4：按会话分片，300ms 防抖）
  useEffect(() => {
    if (!loaded) return
    const timer = window.setTimeout(
      () => saveDraft(sessionKey, design, { savedId: savedMeta.id, savedName: savedMeta.name }),
      300,
    )
    return () => window.clearTimeout(timer)
  }, [design, savedMeta, loaded, sessionKey])

  // 缺陷 4：卸载（切会话/离开工作台）前立即落草稿，避免 300ms 防抖窗口内丢内容
  const latestDraftRef = useRef({ design, savedMeta, sessionKey, loaded })
  latestDraftRef.current = { design, savedMeta, sessionKey, loaded }
  useEffect(
    () => () => {
      const { design: d, savedMeta: m, sessionKey: k, loaded: l } = latestDraftRef.current
      if (l) saveDraft(k, d, { savedId: m.id, savedName: m.name })
    },
    [],
  )

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
        .then(() => {
          setSaving(false)
          lastSavedJsonRef.current = JSON.stringify(design)
          setUnsaved(false)
        })
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
      // B3-1：新建保存为正式设计后迁移到 design-{id} 协作房间（保留 ydoc/撤销栈，不整页刷新）
      store.reconnectRoom(wsUrl, `design-${r.id}`)
      // 缺陷 4：URL 补 design 参数（刷新后 room 派生一致）+ 会话绑定该设计
      const next = new URLSearchParams(searchParams)
      next.set('design', String(r.id))
      next.set(SESSION_PARAM, sessionKey)
      setSearchParams(next, { replace: true })
      sessionApi.bindDesign(sessionKey, r.id).catch(() => {})
      lastSavedJsonRef.current = JSON.stringify(design)
      setUnsaved(false)
      setSaveDialogOpen(false)
    } catch (err) {
      // P0-5：保存失败必须可见（此前静默/未处理，用户误以为已保存到后端）
      const msg = err instanceof Error ? err.message : String(err)
      setSaveError(`保存失败：${msg}`)
    } finally {
      setSaving(false)
    }
  }

  // B3-3：已保存设计的"本地有未同步修改"提示（对保存基线做 400ms 防抖 JSON 比对；
  // 首次加载完成只记基线不提示——语义是"保存之后又有改动"）
  useEffect(() => {
    if (!loaded) return
    const timer = window.setTimeout(() => {
      const cur = JSON.stringify(design)
      if (lastSavedJsonRef.current === null) {
        lastSavedJsonRef.current = cur
        return
      }
      if (cur !== lastSavedJsonRef.current) setUnsaved(true)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [design, loaded])

  // 深色模式：只切换工作台 UI（shadcn dark class），不改变设计稿画布（v2.2 §5.1/§12）
  const [dark, setDark] = useState(() => localStorage.getItem('design-dark') === '1')
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('design-dark', dark ? '1' : '0')
  }, [dark])

  // AI 生成中：画布锁定（v2.2 §8.8）
  const [generating, setGenerating] = useState(false)

  // ---- 缺陷 4：会话（列表 / 快照 / 老数据迁移）----
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionError, setSessionError] = useState('')
  const [snapshots, setSnapshots] = useState<SessionSnapshot[]>(() => loadSnapshots(sessionKey))

  const refreshSessions = useCallback(async () => {
    setSessionsLoading(true)
    try {
      const r = await sessionApi.list(20)
      setSessions(r.sessions)
    } catch (err) {
      setSessionError(`会话列表加载失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  // 进入工作台：先跑一次性老数据迁移（失败下次重试），再确保本会话存在（幂等），最后拉列表
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const report = await migrateLegacySessions()
      if (report.error && !cancelled) {
        setSessionError(`历史会话迁移未完成（下次进入自动重试）：${report.error}`)
      }
      try {
        await sessionApi.ensure(sessionKey)
      } catch (err) {
        if (!cancelled) {
          setSessionError(`会话同步失败（当前仅本地可见）：${err instanceof Error ? err.message : String(err)}`)
        }
      }
      if (!cancelled) await refreshSessions()
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [sessionKey, refreshSessions])

  /** 切换会话：换 URL 即换会话（重挂载，零状态泄漏） */
  const handleSwitchSession = (key: string) => {
    const roomParam = searchParams.get('room')
    navigate(`/workspace?session=${encodeURIComponent(key)}${roomParam ? `&room=${encodeURIComponent(roomParam)}` : ''}`)
  }

  /** 新建会话：全新随机 sessionId + 空白画布（不继承任何历史） */
  const handleNewSession = () => {
    navigate(`/workspace?session=${randomSessionKey()}&from=blank`)
  }

  /** 删除会话（4b：二次确认；连带服务端消息与本地快照） */
  const handleDeleteSession = (key: string) => {
    const target = sessions.find((x) => x.session_id === key)
    if (!window.confirm(`删除会话「${target?.title ?? key}」？消息与快照将删除且不可恢复，画布内容不受影响。`)) return
    void (async () => {
      try {
        await sessionApi.remove(key)
        clearSnapshots(key)
        if (key === sessionKey) {
          handleNewSession()
          return
        }
        await refreshSessions()
      } catch (err) {
        setSessionError(`删除会话失败：${err instanceof Error ? err.message : String(err)}`)
      }
    })()
  }

  const handleSaveSessionSnapshot = (label: string) => {
    setSnapshots(saveSnapshot(sessionKey, design, label))
  }

  /** 回退到会话快照（4b：二次确认 + 可撤销） */
  const handleRestoreSessionSnapshot = (id: string) => {
    const snap = snapshots.find((x) => x.id === id)
    if (!snap) return
    if (!window.confirm(`回退到快照「${snap.label || '未命名快照'}」？当前画布内容会被覆盖（可撤销）。`)) return
    store.pushSnapshot()
    setUndoCount((c) => c + 1)
    store.resetDesign(snap.design)
    setSelectedIds(new Set())
  }

  const handleDeleteSessionSnapshot = (id: string) => {
    setSnapshots(deleteSnapshot(sessionKey, id))
  }

  // ---- 缺陷 3：美化阶段（版面确认 + 效果白名单 + 基础版对照）----
  const beautifyScope = sessionKey
  const [baseSnapshot, setBaseSnapshot] = useState<BaseSnapshot | null>(() => loadBaseSnapshot(beautifyScope))
  const [layoutLocked, setLayoutLocked] = useState(false)
  const [effectsPreview, setEffectsPreview] = useState(false)
  const [beautifying, setBeautifying] = useState(false)
  const [beautifyError, setBeautifyError] = useState('')
  const [lockHint, setLockHint] = useState('')

  // 越权写入（拖拽/改文本/改布局）被写入层拒绝时提示；换设计会话时重挂基础版快照
  useEffect(() => {
    const unsub = store.subscribeBlocked((reason) => {
      setLockHint(reason)
      window.setTimeout(() => setLockHint(''), 4000)
    })
    return unsub
  }, [store])

  useEffect(() => {
    setBaseSnapshot(loadBaseSnapshot(designParam ?? undefined))
    setEffectsPreview(false)
  }, [designParam])

  /** 版面确认：保留基础版快照 + 锁定版面（只放行样式效果） */
  const handleConfirmLayout = () => {
    if (!saveBaseSnapshot(beautifyScope, design)) {
      setBeautifyError('基础版快照保存失败（本地存储不可用或已满），暂不锁定版面。')
      return
    }
    setBaseSnapshot({ design: JSON.parse(JSON.stringify(design)) as DesignNode, at: Date.now() })
    store.setBeautifyLock(true)
    setLayoutLocked(true)
    setBeautifyError('')
  }

  const handleUnlockLayout = () => {
    store.setBeautifyLock(false)
    setLayoutLocked(false)
  }

  /** 应用高级效果：尺寸类效果先二次确认；写入走服务端白名单铁闸，成功后入快照可撤销 */
  const handleApplyEffect = async (nodeId: string, key: string, value: string | number | null) => {
    const spec = EFFECT_SPECS.find((s) => s.key === key)
    if (value !== null && spec?.changesSize && !window.confirm('该效果可能改变组件尺寸，是否确认应用？')) return
    setBeautifying(true)
    setBeautifyError('')
    try {
      const resp = await api<{ design: DesignNode; applied: string[]; removed: string[] }>('/api/apply-effects', {
        method: 'POST',
        body: JSON.stringify({ design, node_id: nodeId, effects: { [key]: value } }),
      })
      store.pushSnapshot()
      setUndoCount((c) => c + 1)
      store.resetDesign(resp.design)
      sessionApi.recordToolCall(sessionKey, `apply-effects:${key}`, true).catch(() => {})
    } catch (err) {
      sessionApi.recordToolCall(sessionKey, `apply-effects:${key}`, false).catch(() => {})
      setBeautifyError(err instanceof Error ? `效果被拒绝：${err.message}` : '效果应用失败')
    } finally {
      setBeautifying(false)
    }
  }

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
    // 语义（P1-13）：保留当前视觉现状，只把子节点变成可拖拽——**不是重新排布**
    if (store.isBeautifyLocked) {
      setErrorMsg('版面已确认：请先解除版面锁定再转自由画布')
      return
    }
    const canvas = canvasRef.current
    if (!canvas) {
      setErrorMsg('画布未就绪，请重试')
      return
    }
    const childIds = design.children.filter((c) => !c.hidden).map((c) => c.id)
    const { measurements, missing } = canvas.measureFreeze(design.id, childIds)
    if (measurements.length === 0) {
      setErrorMsg('未能测量到任何节点，已取消转换')
      return
    }
    const updated = freezeToFreeLayout(design.children, measurements)
    const updates = updated
      .filter((c) => typeof c.x === 'number' && typeof c.y === 'number')
      .map((c) => ({
        id: c.id,
        x: c.x as number,
        y: c.y as number,
        width: Number(c.style?.width ?? 0),
        height: Number(c.style?.height ?? 0),
      }))
    // 先快照（可"还原布局"），再单事务提交（一次 Ctrl+Z 完整还原）
    store.pushSnapshot()
    setUndoCount((c) => c + 1)
    const result = store.convertToFreeLayout(design.id, updates)
    if (!result.ok) {
      store.popSnapshot()
      setUndoCount((c) => Math.max(0, c - 1))
      setErrorMsg('版面已锁定或存在越权改动，转换已取消')
      return
    }
    setErrorMsg(
      missing.length
        ? `已冻结 ${updates.length} 个节点的位置与尺寸，现在可自由拖拽；${missing.length} 个隐藏节点未冻结`
        : `已冻结 ${updates.length} 个节点的位置与尺寸，现在可自由拖拽`,
    )
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
      <header className="z-20 flex h-12 items-center justify-between border-b bg-background/85 px-4 shadow-sm backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 font-semibold">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-primary to-secondary text-[11px] font-bold text-primary-foreground">
              A
            </span>
            <span className="hidden text-sm lg:inline">AI 原生设计工作台</span>
          </span>
          <span className="h-5 w-px bg-border" />
          <AlignToolbar design={design} selectedIds={selectedIds} store={store} />
          <span className="h-5 w-px bg-border" />
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
              disabled={layoutLocked}
              title={
                layoutLocked
                  ? '版面已确认：请先解除版面锁定再转自由画布'
                  : '保留当前布局，把子节点变成可自由拖拽（不改位置与尺寸）'
              }
              onClick={handleConvertToFree}
            >
              🔓 转自由画布
            </Button>
          )}
          <span className="h-5 w-px bg-border" />
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
            {savedMeta.id !== undefined && unsaved && !saving && (
              <span className="text-[10px] text-destructive" data-testid="unsaved-indicator">● 未保存</span>
            )}
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
          <span
            className="flex cursor-default items-center gap-1 text-[11px] text-muted-foreground"
            data-testid="presence-count"
            title={online.users.length > 0 ? `在线：${online.users.join('、')}` : '仅自己'}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${connStatus === 'connected' || connStatus === 'local' ? 'bg-emerald-500' : 'bg-amber-400'}`}
            />
            {online.count} 人在线
          </span>
          {connStatus === 'disconnected' && (
            <span className="text-[11px] text-amber-600" data-testid="presence-reconnecting">
              连接断开，自动重连中…
            </span>
          )}
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
            canvasRef={canvasRef}
          />
          {generating && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/60" data-testid="canvas-lock">
              <span className="rounded-lg bg-background px-4 py-2 text-sm shadow">AI 生成中，画布已锁定…</span>
            </div>
          )}
          {/* 缺陷 3：临时关闭全部高级效果 —— 只读渲染基础版快照（结构与样式=基础版） */}
          {effectsPreview && baseSnapshot && (
            <div className="absolute inset-0 z-40 flex flex-col bg-background/95" data-testid="base-preview">
              <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs">
                <span data-testid="base-preview-banner">
                  正在查看基础版（高级效果已临时关闭）· 快照于 {new Date(baseSnapshot.at).toLocaleTimeString()}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[11px]"
                  data-testid="base-preview-exit"
                  onClick={() => setEffectsPreview(false)}
                >
                  恢复高级效果
                </Button>
              </div>
              <div className="flex-1 overflow-auto p-4">
                <div
                  className="mx-auto bg-white shadow-md"
                  style={{
                    width: typeof baseSnapshot.design.style?.width === 'number' ? baseSnapshot.design.style.width : 800,
                    minHeight: typeof baseSnapshot.design.style?.height === 'number' ? baseSnapshot.design.style.height : 600,
                  }}
                >
                  <NodeRenderer node={baseSnapshot.design} selectedIds={new Set<string>()} decorative />
                </div>
              </div>
            </div>
          )}
          {lockHint && (
            <div
              className="absolute bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-700 shadow"
              data-testid="beautify-blocked-hint"
            >
              {lockHint}
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
                      locked={layoutLocked}
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
                  <div className="flex h-full flex-col">
                    <SessionBar
                      sessionKey={sessionKey}
                      sessions={sessions}
                      loading={sessionsLoading}
                      error={sessionError}
                      onSwitch={handleSwitchSession}
                      onNew={handleNewSession}
                      onDelete={handleDeleteSession}
                      snapshots={snapshots}
                      onSaveSnapshot={handleSaveSessionSnapshot}
                      onRestoreSnapshot={handleRestoreSessionSnapshot}
                      onDeleteSnapshot={handleDeleteSessionSnapshot}
                    />
                    <div className="min-h-0 flex-1">
                  <AIChatPanel
                    sessionKey={sessionKey}
                    onGeneratingChange={setGenerating}
                    onGenerate={(generated) => {
                      store.resetDesign(generated)
                      setSelectedIds(new Set())
                    }}
                    design={design}
                    onIncrementalEdit={handleIncrementalEdit}
                    onUndo={handleUndo}
                    canUndo={undoCount > 0}
                    onComplianceRestore={(fix) => {
                      // D1：还原单条合规修正——updateNode 走 Yjs 事务（LOCAL_ORIGIN，单撤销步）
                      store.updateNode(fix.node_id, (n) => ({
                        ...n,
                        style: { ...(n.style ?? {}), [fix.field]: fix.original },
                      }))
                    }}
                    onUseExploreDesign={(explored) => {
                      // D3：采用探索方案——先快照（可撤销回加载前），再整树替换（不入操作级撤销栈）
                      store.pushSnapshot()
                      setUndoCount((c) => c + 1)
                      store.resetDesign(explored)
                      setSelectedIds(new Set())
                    }}
                  />
                    </div>
                  </div>
                )}
                {activePanel === 'beautify' && (
                  <BeautifyPanel
                    design={design}
                    selectedNode={selectedNode}
                    baseSnapshot={baseSnapshot}
                    locked={layoutLocked}
                    applying={beautifying}
                    error={beautifyError}
                    previewing={effectsPreview}
                    onConfirmLayout={handleConfirmLayout}
                    onUnlock={handleUnlockLayout}
                    onApplyEffect={(nodeId, key, value) => void handleApplyEffect(nodeId, key, value)}
                    onPreviewToggle={setEffectsPreview}
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
  canvasRef,
}: {
  design: DesignNode
  store: ReturnType<typeof useDesignStore>['store']
  selectedIds: Set<string>
  onSelectChange: (ids: Set<string>) => void
  onDropComponent?: (type: string, x: number, y: number) => void
  showGrid?: boolean
  onCanvasContextMenu?: (nodeId: string | null, x: number, y: number) => void
  highlightIds?: Set<string>
  canvasRef?: React.Ref<DesignCanvasHandle>
}) {
  return (
    <DesignCanvas
      ref={canvasRef}
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
