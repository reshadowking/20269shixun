import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'

import ActivityBar, { ACTIVITY_TITLES } from '@/components/activity/ActivityBar'
import LayerTree from '@/components/activity/LayerTree'
import BeautifyPanel from '@/components/beautify/BeautifyPanel'
import CodeViewer from '@/components/export/CodeViewer'
import AIChatPanel from '@/components/chat/AIChatPanel'
import { NodeRenderer } from '@/canvas/NodeRenderer'
import { collectFreezeTargets, freezeToFreeLayout, waitForLayoutStable } from '@/canvas/freeze'
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
import MembersPanel from '@/components/collab/MembersPanel'
import FollowupModeSelect from '@/components/settings/FollowupModeSelect'
import AlignToolbar from '@/components/toolbar/AlignToolbar'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { BLANK_DESIGN, DEMO_DESIGNS } from '@/design/demoData'
import { loadDraft, saveDraft } from '@/lib/designSession'
import { designToReactApp } from '@/export/designToReact'
import { findNode, findParent as findParentOf, genId } from '@/design/tree'
import { diffDesign, planAiLanding } from '@/design/applyDiff'
import { canAutoFreeze, readAutoFreeze, writeAutoFreeze } from '@/lib/autoFreeze'
import type { ComponentType, DesignNode } from '@/design/types'
import { api } from '@/lib/api'
import SessionBar from '@/components/chat/SessionBar'
import { deriveCollabRoom, needsSignedRoom, usesGateway } from '@/lib/collabRoom'
import { clearSnapshots, deleteSnapshot, loadSnapshots, saveSnapshot, type SessionSnapshot } from '@/lib/sessionSnapshots'
import { sessionApi, type SessionMeta } from '@/lib/sessionApi'
import { deriveSessionKey, isSessionKey, randomSessionKey, SESSION_PARAM } from '@/lib/sessionKey'
import { findSessionKeyForDesign } from '@/lib/sessionApi'
import { applyTheme, getTheme } from '@/lib/theme'
import { migrateLegacySessions } from '@/lib/migrateLegacySessions'
import { auditGeometry, type AuditIssue } from '@/canvas/geometryAudit'
import { placeUnpositionedChildren } from '@/design/freePlacement'
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
 *
 * 缺陷 5（对话随项目留存）：`?design={id}` 且 URL 未显式给会话时，先问服务端"这张稿件当初用的是
 * 哪条会话"再挂载——保存前聊天用的是随机会话 key（绑定记在 chat_sessions.design_id 上），
 * 不查就只会打开 `s-design-{id}` 这条空会话，表现为"重新打开项目，对话被清空"。
 */
export default function WorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const designParam = searchParams.get('design')
  const sessionParam = searchParams.get(SESSION_PARAM)
  const sessionRef = useRef<string | null>(null)
  if (sessionRef.current === null) {
    // 懒初始化：StrictMode 双渲染下随机值只生成一次，会话身份稳定
    sessionRef.current = randomSessionKey()
  }
  const explicitSession = isSessionKey(sessionParam)
  const designId = designParam && /^\d+$/.test(designParam) ? Number(designParam) : null
  /** 服务端登记的"本设计原本的会话"；查不到/查询失败保持 null → 退化 s-design-{id} */
  const [boundKey, setBoundKey] = useState<string | null>(null)
  /** 解析是否完成：未完成前不挂载（否则会先亮出空会话，再重挂一次） */
  const [lookupDone, setLookupDone] = useState(() => explicitSession || designId === null)
  useEffect(() => {
    if (explicitSession || designId === null) {
      setLookupDone(true)
      return
    }
    let cancelled = false
    setLookupDone(false)
    void findSessionKeyForDesign(designId).then((key) => {
      if (cancelled) return
      setBoundKey(key)
      setLookupDone(true)
    })
    return () => {
      cancelled = true
    }
  }, [designId, explicitSession])
  const sessionKey = deriveSessionKey(sessionParam, designParam, sessionRef.current, boundKey)
  useEffect(() => {
    if (!lookupDone) return
    if (searchParams.get(SESSION_PARAM) === sessionKey) return
    const next = new URLSearchParams(searchParams)
    next.set(SESSION_PARAM, sessionKey)
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, lookupDone])
  if (!lookupDone) {
    return (
      <div className="flex h-screen items-center justify-center" data-testid="workspace-session-resolving">
        <p className="text-sm text-muted-foreground">正在恢复本项目的对话…</p>
      </div>
    )
  }
  return <WorkspaceInner key={sessionKey} sessionKey={sessionKey} />
}

/** 工作台内部：组件面板 + 画布 + 右侧活动栏（P1：活动栏图标 + 展开面板） */
function WorkspaceInner({ sessionKey }: { sessionKey: string }) {
  /** 直连端点（草稿 / 显式 ?room= 用；未配置网关时也是唯一端点） */
  const wsDirectUrl = import.meta.env.VITE_WS_URL ?? 'ws://localhost:1234'
  /** §三.1：协作网关地址。**不设时行为与改造前完全一致**（全部直连，房间名本地派生） */
  const wsGatewayUrl = import.meta.env.VITE_WS_GATEWAY_URL || undefined
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const designParam = searchParams.get('design')
  const explicitRoom = searchParams.get('room')
  // 协作 room（P0-4 + 缺陷 4）：?room= > design-{id} > session-{sessionKey}（不再每标签随机）
  const roomRef = useRef<string | null>(null)
  if (roomRef.current === null) {
    roomRef.current = deriveCollabRoom(explicitRoom, designParam, sessionKey)
  }
  const room = roomRef.current
  /**
   * §三.1 + §四 传输决策（2026-09-16 收紧后）：
   *   ① 配了网关 → **所有**房间都过网关（草稿、显式 ?room= 也一样）；
   *   ② 其中"已保存稿件"必须等服务端签发房间：拿到之前**先不连**，
   *      不能"先连可猜的 design-{id}、拿到再换"，那等于把网关绕过去了；
   *   ③ 草稿/显式 ?room= 用本地房间名（`session-*` / `?room=` 原值），登录即可协作；
   *   ④ 没配网关 → 与改造前完全一致（直连）。
   */
  const gatewayOn = usesGateway(wsGatewayUrl)
  const signedRoomNeeded = needsSignedRoom(designParam, explicitRoom)
  const [signedRoom, setSignedRoom] = useState<string | null>(null)
  /**
   * 2026-09-17 修（主流程）：**只有过网关才需要签发房间**。
   *
   * 原来"没配网关"时也会先直连 `design-{id}`、拿到签发房间后再切过去 —— 同一页面先后连两个房间，
   * 本地副本先写进那个**临时房间**，切过去后两份内容合并：Playwright 抓 WS URL 实测房间序列
   * `design-7 → tgRdBs-…`，量到刷新后画布回退成 DB 版本（`style.left` 180px → 120px，队友未保存的
   * 编辑就丢了）。现在直连模式**一个房间连到底**（房间名仍是 `design-{id}`，与改造前一致）；
   * 走网关时才等服务端签发，并把 `collabExpected` 传给 store（签发前不写占位副本）。
   */
  const waitForSignedRoom = signedRoomNeeded && gatewayOn && !signedRoom
  const connectUrl = waitForSignedRoom ? undefined : gatewayOn ? wsGatewayUrl : wsDirectUrl
  const connectRoom = signedRoomNeeded && gatewayOn && signedRoom ? signedRoom : room
  // D5：presence 昵称（?user= 可区分多标签演示；默认与登录账号一致）
  const userName = searchParams.get('user') ?? 'demo'
  const { design, store } = useDesignStore(
    connectUrl,
    DEMO_DESIGNS[0],
    connectRoom,
    // 走网关且房间名还没签发 → 让 store 知道"协作在路上"，别把占位副本先写进文档
    waitForSignedRoom,
  )
  /** 转自由画布（P1-13）：测量需要画布的 DOM 与缩放状态，因此由画布暴露能力 */
  const canvasRef = useRef<DesignCanvasHandle>(null)
  /** T42：几何体检只在本页自己的画布子树里量（见 handleAudit 注释） */
  const pageRef = useRef<HTMLDivElement>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // P1 文件系统（缺陷 5/8/11）：打开保存的设计 / 模板起手 / 草稿 / 空白
  const [loaded, setLoaded] = useState(false)
  /**
   * 2026-09-17（B+）：**数据就绪**才算可读写 —— 本地模式 / 协作已 sync / 兜底已触发。
   * 为什么单独一个状态：修成"房间为准"之后，`sync` 之前文档可能是空的，
   * 这时自动保存/导出/选区若照常工作，就会把**空树**当成用户内容存下去（比原来的 bug 更糟）。
   */
  const [dataReady, setDataReady] = useState(() => store.dataReady)
  useEffect(() => store.onDataReady(() => setDataReady(true)), [store])
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
        // 2026-09-17（B+）：**房间为准** —— 有协作端点时这里不再直接写文档，
        // 而是等 provider 首个 sync：房间空才写、房间已有别人的内容则采用房间状态。
        // 2026-09-18：打开时补一次"孤儿节点"坐标（free 父级下没有 x/y 的子节点会压在一起，
        // 实测已有按钮 (276,192) / 新按钮 (268,184) 完全重叠）。有坐标的节点原样不动，
        // 所以这一步只在真的存在孤儿时才有改动——顺带自愈历史上已经存坏了的稿件。
        store.applyLoadedDesign(placeUnpositionedChildren(target))
        setSavedMeta(meta)
      } else {
        // 没给任何参数（裸 /workspace、?asset=… 等）：沿用"演示稿起手"的既有行为
        store.applyLoadedDesign(placeUnpositionedChildren(DEMO_DESIGNS[0]))
      }
      setLoaded(true)
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // T46a-3d：协作角色（owner/editor/viewer）。写入阻断由协作网关负责，这里只做"如实告知"。
  // §三.1：同一个请求把**签发房间**也拿回来（一次调用两样东西，避免重复打接口）。
  const [collabRole, setCollabRole] = useState<string | null>(null)
  const [collabRoomError, setCollabRoomError] = useState('')
  /** T46a-4：本稿所属工作区（工作台内"邀请协作"入口用） */
  const [collabWorkspaceId, setCollabWorkspaceId] = useState<number | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  useEffect(() => {
    if (!designParam || !loaded) return
    let cancelled = false
    api<{ role: string; room: string; workspace_id: number | null }>(`/api/designs/${designParam}/collab`)
      .then((r) => {
        if (cancelled) return
        setCollabRole(r.role)
        setCollabWorkspaceId(r.workspace_id ?? null)
        setCollabRoomError('')
        if (r.room) setSignedRoom(r.room)
      })
      .catch(() => {
        /* 拿不到角色（老数据/未启用网关）就不标角色，不阻塞画布 */
        if (cancelled || !gatewayOn) return
        // 走网关时拿不到房间就不连——兜底直连等于给"猜房间名"开后门
        setCollabRoomError('未能获取协作房间（服务端未签发），本次未建立协作连接。')
      })
    return () => {
      cancelled = true
    }
  }, [designParam, loaded, gatewayOn])

  // 网关 4403 → 明确告知（不静默重连，避免"看着在线其实被拒"）
  useEffect(() => {
    store.onForbidden = () => {
      setLockHint('无权进入该协作房间：请确认已用被邀请的账号登录，或让管理员重新邀请。')
      window.setTimeout(() => setLockHint(''), 8000)
    }
    return () => {
      store.onForbidden = undefined
    }
  }, [store])

  /**
   * 2026-09-16 撤销的并发口径（实测收窄版）：
   * - 属性步骤若已被队友改成别的值 → store 跳过并回调 `onUndoBlocked`，这里提示（不弹框）；
   * - 结构性步骤（新增/删除/换父级）若涉及的节点之后被队友改过 → 先 `window.confirm` 再撤。
   * `window.confirm` 是阻塞式的，所以按住 Ctrl+Z 不会叠出多个对话框。
   */
  useEffect(() => {
    store.onUndoBlocked = (reason) => {
      setLockHint(reason)
      window.setTimeout(() => setLockHint(''), 6000)
    }
    store.onUndoConfirm = (reason) => window.confirm(reason)
    return () => {
      store.onUndoBlocked = undefined
      store.onUndoConfirm = undefined
    }
  }, [store])

  // viewer 角色：进画布即提示"只读"（真实写入阻断在协作网关，这里负责让人知道自己是只读）
  useEffect(() => {
    if (collabRole !== 'viewer') return
    setLockHint('只读访客：可以查看实时协作，但你的画布改动不会被保存。')
    window.setTimeout(() => setLockHint(''), 8000)
  }, [collabRole])

  /**
   * 2026-09-16：把"我正在编辑什么"广播给队友（显示在对方光标标签里，如 `小张 · 按钮「提交」`）。
   * 只在**标签真的变了**时才写 awareness——否则每次文档更新都会推一条 presence。
   */
  const lastSelLabelRef = useRef('')
  useEffect(() => {
    const only = selectedIds.size === 1 ? findNode(design, [...selectedIds][0]) : null
    const text = typeof only?.props?.text === 'string' ? String(only.props.text).slice(0, 8) : ''
    const label = only ? `${only.componentType ?? only.type}${text ? `「${text}」` : ''}` : ''
    if (label === lastSelLabelRef.current) return
    lastSelLabelRef.current = label
    store.publishSelection(label)
  }, [store, selectedIds, design])

  /**
   * T46a-3e：只读访客的写入口一律关掉（拖拽 / 属性 / AI / 美化 / 保存）。
   * 三层防护：① 网关丢弃 viewer 的写消息（服务端）；② 写接口 403（服务端）；
   * ③ store 写入层拒绝 + UI 禁用（这里）——③ 的意义是"立刻可见"，而不是拖完才发现没动。
   */
  const readOnly = collabRole === 'viewer'
  useEffect(() => {
    store.setReadOnly(readOnly)
  }, [store, readOnly])

  /**
   * T43：从资产库一键插入——`/workspace?asset=<id>` 时，把图片写进"当前选中的图片组件"。
   * 没选中 / 选中的不是图片组件时，给出明确提示（不静默丢弃，也不猜用户想插到哪）。
   *
   * 2026-09-17 修：原来这个 effect 只在 `[loaded, searchParams]` 变化时跑，而它给出的提示恰恰是
   * "请先选中一个「图片」组件，再点资产库的「插入到画布」" —— 用户照做（选中图片组件）之后，
   * effect 不会再跑，插入**永远不会发生**（探针实测：选中后提示原样不动、节点 src 仍是空）。
   * 现在把"当前选中的节点"纳入依赖；插入成功后把 `?asset=` 从 URL 去掉，否则之后每改选一次
   * 节点都会把同一张图再插一遍（还会多推一个撤销步）。
   */
  const selectedKey = [...selectedIds].join(',')
  /** 提示只弹一次（依赖里加了选中项，避免每次改选都刷屏）；插入过的 asset 也记下来防重复 */
  const assetHintRef = useRef<string | null>(null)
  const insertedAssetRef = useRef<string | null>(null)
  useEffect(() => {
    const assetId = searchParams.get('asset')
    if (!assetId || !loaded || insertedAssetRef.current === assetId) return
    const selected = [...selectedIds]
    const targetId = selected.find((id) => {
      const node = findNode(design, id)
      return node?.type === 'component' && node.componentType === 'image'
    })
    if (!targetId) {
      if (assetHintRef.current !== assetId) {
        assetHintRef.current = assetId
        setLockHint('已从资产库带回图片：请先选中画布上的「图片」组件，图片会插进它。')
        window.setTimeout(() => setLockHint(''), 6000)
      }
      return
    }
    const src = `/api/images/${assetId}`
    insertedAssetRef.current = assetId
    store.pushSnapshot()
    store.updateNode(targetId, (node) => ({ ...node, props: { ...node.props, src } }))
    const next = new URLSearchParams(searchParams)
    next.delete('asset')
    setSearchParams(next, { replace: true })
    setLockHint('已把资产库图片插入选中的图片组件（可撤销）')
    window.setTimeout(() => setLockHint(''), 6000)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, dataReady, searchParams, selectedKey])

  // P1 草稿自动保存（缺陷 5/8 + 缺陷 4：按会话分片，300ms 防抖）
  /** 草稿写失败只提示一次（否则 300ms 防抖会让提示反复闪） */
  const draftWarnedRef = useRef(false)
  useEffect(() => {
    // B+：数据没就绪（协作还在 sync）时不落草稿——否则会把"尚未同步回来的空树"存成本地草稿
    if (!loaded || !dataReady) return
    const timer = window.setTimeout(() => {
      const ok = saveDraft(sessionKey, design, { savedId: savedMeta.id, savedName: savedMeta.name })
      // 2026-09-17：本地存储写失败（配额满 / 被禁用）以前是**静默**的 —— 用户以为草稿一直在，
      // 关掉标签页就什么都没了。这里提示一次（同一会话不重复刷屏），并指路服务端保存。
      if (!ok && !draftWarnedRef.current) {
        draftWarnedRef.current = true
        setLockHint('本地存储已满或不可用：草稿没能自动保存，请点右上角「💾 保存」存到服务器')
        window.setTimeout(() => setLockHint(''), 10000)
      }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [design, savedMeta, loaded, dataReady, sessionKey])

  // 缺陷 4：卸载（切会话/离开工作台）前立即落草稿，避免 300ms 防抖窗口内丢内容
  const latestDraftRef = useRef({ design, savedMeta, sessionKey, loaded, dataReady })
  latestDraftRef.current = { design, savedMeta, sessionKey, loaded, dataReady }
  useEffect(
    () => () => {
      const { design: d, savedMeta: m, sessionKey: k, loaded: l, dataReady: ready } = latestDraftRef.current
      // B+：同样只在数据就绪时落草稿（别把"还没同步回来的空树"存下去）
      if (l && ready) saveDraft(k, d, { savedId: m.id, savedName: m.name })
    },
    [],
  )

  // 保存到后端（缺陷 16/17）：未命名先弹命名框，已命名直接 PUT
  const handleSave = () => {
    if (saving) return
    // B+：协作内容还没同步回来时不许保存——否则会把空树/旧树写成新版本
    if (!dataReady) {
      setSaveError('协作内容还在同步，请稍候再保存')
      return
    }
    // T46a-3e：只读访客不能保存（后端 PUT 也会 403，这里先给出可读原因）
    if (readOnly) {
      setSaveError('只读访客：不能保存修改（需要 owner / editor 权限）。')
      return
    }
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
        // 2026-09-18：会话绑定跟保存**同一次请求**落库（后端同事务写入 chat_sessions.design_id）。
        // 此前是保存成功后再发一次 PATCH 且 `.catch(() => {})` 静默吞错——一次网络抖动就会让
        // "这张稿件当初聊的会话"永远找不到，用户重开项目看到的就是对话被清空。
        body: JSON.stringify({ name: name.trim(), design, session_key: sessionKey }),
      })
      setSavedMeta({ id: r.id, name: r.name })
      // B3-1：新建保存为正式设计后迁移协作房间（保留 ydoc/撤销栈，不整页刷新）。
      // §三.1：配了网关时**不在这里连可猜房间**——先清掉直连端点，等 /collab 签发房间后由传输 effect 连。
      if (gatewayOn) store.reconnectRoom(undefined, `design-${r.id}`)
      else store.reconnectRoom(wsDirectUrl, `design-${r.id}`)
      // 缺陷 4：URL 补 design 参数（刷新后 room 派生一致）+ 会话绑定该设计
      const next = new URLSearchParams(searchParams)
      next.set('design', String(r.id))
      next.set(SESSION_PARAM, sessionKey)
      setSearchParams(next, { replace: true })
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

  // 深色模式：只切换工作台 UI（shadcn dark class），不改变设计稿画布（v2.2 §5.1/§12）。
  // 2026-09-18：改用全局主题（lib/theme.ts）的**唯一一份存储**。此前工作台自己写 `design-dark`、
  // AppShell 写 `design-tool-theme`，两边都会去动 `<html class="dark">` —— 在首页开深色再进工作台，
  // 工作台按自己那份（默认浅色）把 dark class 摘掉，回到首页按钮还显示"浅色模式"但页面已经变亮，
  // 用户看到的就是"深色模式时有时无/切页就丢"。
  const [dark, setDark] = useState(() => getTheme() === 'dark')
  useEffect(() => {
    applyTheme(dark ? 'dark' : 'light')
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

  // 进入工作台：先跑一次性老数据迁移（失败下次重试），再确保本会话存在（幂等），最后拉列表。
  // T4 批1：随后读回服务端锁状态（刷新不丢锁——B 决策），并同步写入层锁。
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
      try {
        const lock = await sessionApi.getBeautifyLock(sessionKey)
        if (!cancelled) {
          setLayoutLocked(lock.locked)
          store.setBeautifyLock(lock.locked)
        }
      } catch {
        /* 锁状态读取失败：按未锁定处理（与刷新前旧行为一致），锁定在下次确认时重建 */
      }
      if (!cancelled) await refreshSessions()
    }
    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // 2026-09-17：文案要说实话——删**当前**会话会把画布切到新的空白草稿（原草稿仍在本地，
    // 可从首页「继续上次编辑」找回），此前统一写"画布内容不受影响"，与行为不符。
    const isCurrent = key === sessionKey
    const tail = isCurrent
      ? '当前会话的画布会切到新的空白草稿；原草稿仍留在本地，可回首页用「继续上次编辑」找回。'
      : '画布内容不受影响。'
    if (!window.confirm(`删除会话「${target?.title ?? key}」？消息与快照将删除且不可恢复。${tail}`)) return
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
    const { ok, list } = saveSnapshot(sessionKey, design, label)
    setSnapshots(list)
    // 2026-09-17：本地存储写失败不再静默（此前列表里显示"已保存"，刷新后却没有）
    setSessionError(
      ok ? '' : '快照保存失败（本地存储已满或不可用）：刷新后会丢失，请改用右上角「💾 保存」或清理浏览器存储。',
    )
  }

  /** 回退到会话快照（4b：二次确认 + 可撤销） */
  const handleRestoreSessionSnapshot = (id: string) => {
    const snap = snapshots.find((x) => x.id === id)
    if (!snap) return
    // 2026-09-17：版面已确认（锁定）阶段不允许整树回退——与「转自由画布」「智能优化」同一口径
    if (store.isBeautifyLocked) {
      setLockHint('版面已确认：不能回退到旧快照（会改变布局/尺寸），请先解除版面锁定')
      window.setTimeout(() => setLockHint(''), 5000)
      return
    }
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

  /** 版面确认：保留基础版快照 + 锁定版面（只放行样式效果）。
   * T4 批1：锁状态同步到服务端（闸门判定的来源），失败必须可见。 */
  const handleConfirmLayout = () => {
    if (!saveBaseSnapshot(beautifyScope, design)) {
      setBeautifyError('基础版快照保存失败（本地存储不可用或已满），暂不锁定版面。')
      return
    }
    setBaseSnapshot({ design: JSON.parse(JSON.stringify(design)) as DesignNode, at: Date.now() })
    store.setBeautifyLock(true)
    setLayoutLocked(true)
    setBeautifyError('')
    // T32：同步失败必须**回滚本地状态**——否则 UI 显示"已锁定/已解锁"，服务端却是另一个状态，
    // 用户后续操作会被闸门静默拒绝（"点了没反应"的根源）。
    sessionApi.setBeautifyLock(sessionKey, true).catch(() => {
      store.setBeautifyLock(false)
      setLayoutLocked(false)
      setBeautifyError('版面锁定未能同步到服务端（已回滚为未锁定）。请检查网络后重试。')
    })
  }

  const handleUnlockLayout = () => {
    store.setBeautifyLock(false)
    setLayoutLocked(false)
    setBeautifyError('')
    sessionApi.setBeautifyLock(sessionKey, false).catch(() => {
      store.setBeautifyLock(true)
      setLayoutLocked(true)
      setBeautifyError('解除版面锁定失败（已回滚为仍锁定）。请检查网络后重试。')
    })
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
      // 2026-09-17：改**差量落地**（原来 resetDesign 整树替换，与 ③ 里修掉的 AI 路径同一类问题）——
      // 服务端只改了这个节点的效果，整树替换会 ① 吞掉队友在这期间的并发改动；
      // ② 让所有人画布整体重挂；③ 清空发起者的操作级撤销栈（「↩ 撤销」直接变灰）。
      store.applyAiDiff(diffDesign(design, resp.design))
      sessionApi.recordToolCall(sessionKey, `apply-effects:${key}`, true).catch(() => {})
    } catch (err) {
      sessionApi.recordToolCall(sessionKey, `apply-effects:${key}`, false).catch(() => {})
      setBeautifyError(err instanceof Error ? `效果被拒绝：${err.message}` : '效果应用失败')
    } finally {
      setBeautifying(false)
    }
  }

  /** T4 批3：批量应用高级效果（同类节点 / 选中多个）。
   * 后端原子生效（任一 target 非法整批 422），成功后单次快照 + **差量落地**。 */
  const handleApplyEffectBatch = async (nodeIds: string[], key: string, value: string | number | null) => {
    if (nodeIds.length === 0) return
    setBeautifying(true)
    setBeautifyError('')
    try {
      const resp = await api<{
        design: DesignNode
        applied: string[]
        removed: string[]
        changes_size: boolean
        failed: Array<{ node_id: string; reason: string }>
      }>('/api/apply-effects/batch', {
        method: 'POST',
        body: JSON.stringify({ design, targets: nodeIds.map((id) => ({ node_id: id, effects: { [key]: value } })) }),
      })
      store.pushSnapshot()
      setUndoCount((c) => c + 1)
      // 同单人应用：差量落地（避免吞并发改动 / 画布重挂 / 清撤销栈）
      store.applyAiDiff(diffDesign(design, resp.design))
      // 部分失败可读反馈（原子语义下服务端整批拒绝走 catch；此处防未来部分语义静默吞掉）
      if (resp.failed?.length) {
        setBeautifyError(`以下节点未能应用效果：${resp.failed.map((f) => f.node_id).join('、')}`)
      }
      sessionApi.recordToolCall(sessionKey, `apply-effects-batch:${key}:${nodeIds.length}`, true).catch(() => {})
    } catch (err) {
      sessionApi.recordToolCall(sessionKey, `apply-effects-batch:${key}:${nodeIds.length}`, false).catch(() => {})
      setBeautifyError(err instanceof Error ? `批量应用被拒绝：${err.message}` : '批量应用失败')
    } finally {
      setBeautifying(false)
    }
  }

  // 画布背景网格点（P2-11，localStorage 记忆）
  const [showGrid, setShowGrid] = useState(() => localStorage.getItem('design-grid') !== '0')
  /** 「AI 生成后自动转自由画布」偏好（默认开；关掉退回 flex，见 lib/autoFreeze.ts） */
  const [autoFreeze, setAutoFreeze] = useState(() => readAutoFreeze())

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

  // T6：常驻「代码」面板——当前设计对应的 src/App.tsx（与导出对话框同一产物函数，
  // withComments 同导出默认 true；上传图片在代码里以原始 URL 呈现，导出对话框才做内联）
  const appCode = useMemo(() => designToReactApp(design, true), [design])

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
    if (readOnly) {
      setLockHint('只读访客：不能执行智能优化（需要 owner / editor 权限）')
      window.setTimeout(() => setLockHint(''), 4000)
      return
    }
    // 版面已确认（锁定）阶段只有效果可改：优化会改 gap/padding/对齐（都是布局字段），
    // 而落库走 resetDesign（整树替换、不过 _allowedWhileLocked），与 AI 路径的闸门口径不一致。
    if (store.isBeautifyLocked) {
      setLockHint('版面已确认：请先解除版面锁定再做布局优化')
      window.setTimeout(() => setLockHint(''), 4000)
      return
    }
    setOptimizing(true)
    try {
      store.pushSnapshot()
      setUndoCount((c) => c + 1)
      const resp = await api<{ design: DesignNode; report: OptimizeReport }>('/api/optimize-layout', {
        method: 'POST',
        body: JSON.stringify({ design }),
      })
      // 2026-09-17：同样改差量落地——优化只改布局样式，整树替换会吞并发改动 / 画布重挂 / 清撤销栈。
      store.applyAiDiff(diffDesign(design, resp.design))
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
  const convertingFreeRef = useRef(false)

  /** 冻结结果：`ok=false` 时由调用方决定提示（手动）或静默（AI 落地后自动）。 */
  type FreezeOutcome =
    | { ok: true; nodes: number; containers: number; hidden: number }
    | { ok: false; reason: 'no-canvas' | 'nothing' | 'unstable' | 'rejected'; detail?: string }

  /**
   * 冻结**整棵树**（2026-09-18 由"只冻根节点一层"扩到逐层）：一次 Ctrl+Z 可完整还原。
   *
   * 语义（P1-13）：保留当前视觉现状，只把节点变成可拖拽——**不是重新排布**。
   * 先等版面稳定（字体/图片/两帧 rAF）→ 逐层测量（测量全部发生在写入之前）→ 单事务提交。
   * 「🔓 转自由画布」与"AI 生成后自动冻结"共用这一条路径，两者行为因此永远一致。
   */
  const freezeWholeTree = async (): Promise<FreezeOutcome> => {
    const canvas = canvasRef.current
    if (!canvas) return { ok: false, reason: 'no-canvas' }
    // 2026-09-17：先等版面稳定再测量——"测早了 → 冻结写进的小尺寸把版面压错位"是验收反馈头号嫌疑。
    // 查询限定在本页子树（T42 的教训：全局 querySelector 会命中别的画布/预览层）。
    const stable = await waitForLayoutStable(
      pageRef.current?.querySelector<HTMLElement>('[data-testid="canvas-sheet"]') ?? null,
    )
    if (!stable.settled) {
      const who = stable.pendingImages
        ? `${stable.pendingImages} 张图片还没加载完`
        : stable.fontsPending
          ? '字体还没就绪'
          : '版面还在变化'
      return { ok: false, reason: 'unstable', detail: who }
    }
    const current = store.getDesign()
    const groups: Array<{
      parentId: string
      updates: Array<{ id: string; x: number; y: number; width: number; height: number }>
      containerSize?: { width: number; height: number }
    }> = []
    let nodes = 0
    let hidden = 0
    // 逐层测量：某一层完全量不到（整层隐藏等）就跳过它，不拖累其它层——但一层都没量到则整批取消
    for (const parent of collectFreezeTargets(current)) {
      const childIds = (parent.children ?? []).filter((c) => !c.hidden).map((c) => c.id)
      const { measurements, missing, container } = canvas.measureFreeze(parent.id, childIds)
      if (!measurements.length) continue
      const updates = freezeToFreeLayout(parent.children ?? [], measurements)
        .filter((c) => typeof c.x === 'number' && typeof c.y === 'number')
        .map((c) => ({
          id: c.id,
          x: c.x as number,
          y: c.y as number,
          width: Number(c.style?.width ?? 0),
          height: Number(c.style?.height ?? 0),
        }))
      if (!updates.length) continue
      groups.push({ parentId: parent.id, updates, containerSize: container })
      nodes += updates.length
      hidden += missing.length
    }
    if (!groups.length) return { ok: false, reason: 'nothing' }
    // 先快照（可"还原布局"），再单事务提交（一次 Ctrl+Z 完整还原）
    store.pushSnapshot()
    setUndoCount((c) => c + 1)
    const result = store.convertToFreeLayoutBatch(groups)
    if (!result.ok) {
      // store 仍拒绝（锁定/越权/节点在测量期间被删）：把快照与计数退回，不留"按了没反应"的撤销步
      store.popSnapshot()
      setUndoCount((c) => Math.max(0, c - 1))
      return { ok: false, reason: 'rejected' }
    }
    return { ok: true, nodes, containers: groups.length, hidden }
  }

  /**
   * AI 产物落地后**自动冻结一次**（2026-09-17）：让"生成即可拖"，不用再点「🔓 转自由画布」。
   *
   * 前提：偏好开着（默认开）+ 不是锁定/只读 + 根节点还不是 free。
   * 失败一律**静默保留 flex**（等图片显示出来用户仍可手动点按钮），不拿"可能偏小的尺寸"落库。
   */
  const autoFreezeAfterAi = async () => {
    if (!readAutoFreeze()) return
    const current = store.getDesign()
    // 与「转自由画布」按钮同一套守卫：锁定/只读下 store 必然拒绝，先推快照只会留下空撤销步
    if (!canAutoFreeze({ locked: store.isBeautifyLocked, readOnly: store.isReadOnly, layout: current.style?.layout })) return
    if (!current.children?.length) return
    await freezeWholeTree()
  }

  const handleConvertToFree = async () => {
    if (!design.children?.length) return
    if (convertingFreeRef.current) return // 等待测量期间重复点击：忽略（避免二次冻结覆盖）
    if (store.isBeautifyLocked) {
      setErrorMsg('版面已确认：请先解除版面锁定再转自由画布')
      return
    }
    convertingFreeRef.current = true
    try {
      const outcome = await freezeWholeTree()
      if (!outcome.ok) {
        if (outcome.reason === 'unstable') {
          setErrorMsg(`已取消转换：${outcome.detail}，此时测量会偏小并导致排版错乱。等画面稳定后重试即可。`)
        } else if (outcome.reason === 'nothing') {
          setErrorMsg('未能测量到任何节点，已取消转换')
        } else if (outcome.reason === 'rejected') {
          setErrorMsg('版面已锁定或存在越权改动，转换已取消')
        } else {
          setErrorMsg('画布未就绪，请重试')
        }
        return
      }
      setErrorMsg(
        outcome.hidden
          ? `已冻结 ${outcome.nodes} 个节点的位置与尺寸（含 ${outcome.containers} 个容器），现在可自由拖拽；${outcome.hidden} 个隐藏节点未冻结`
          : `已冻结 ${outcome.nodes} 个节点的位置与尺寸（含 ${outcome.containers} 个容器），现在可自由拖拽`,
      )
      setSelectedIds(new Set())
    } finally {
      convertingFreeRef.current = false
    }
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

  // T26：几何体检（纯只读）——结果面板 + 复用 highlightIds 高亮相关节点
  const [auditIssues, setAuditIssues] = useState<AuditIssue[] | null>(null)
  const handleAudit = () => {
    // T42：原来用 document.querySelector 全局找画布——一旦文档里还有别的 canvas-sheet
    // （预览层 / 缩略图 / 测试里上一个用例的残留树），量的就是别人的 DOM，结果时对时错。
    // 改成只在本页子树里找。
    const sheet = pageRef.current?.querySelector<HTMLElement>('[data-testid="canvas-sheet"]')
    if (!sheet) return
    // 2026-09-17：把**设计语义**一起传进去（节点 id → 类型），否则规则只能靠 DOM 形状猜组件类型，
    // 会把"渲染成裸 div 的 divider"报成空容器、把"svg 比盒子高 4px 的 icon"报成文字截断（都实测过）。
    const byId = new Map<string, DesignNode>()
    const walk = (node: DesignNode) => {
      byId.set(node.id, node)
      for (const child of node.children ?? []) walk(child)
    }
    walk(design)
    const issues = auditGeometry(sheet, {}, { nodeTypeOf: (id) => byId.get(id) })
    setAuditIssues(issues)
    setHighlightIds(new Set(issues.map((issue) => issue.nodeId)))
  }

  const handleIncrementalEdit = async (
    newDesign: DesignNode,
    changedIds: string[],
  ): Promise<{ ok: boolean; reason?: string; dropped?: string[] }> => {
    // T4 批1：AI 修改结果必须过服务端闸门（锁状态由服务端按会话判定，前端不声明）。
    // 始终调用——未锁定时服务端直接放行，行为与改造前一致。
    try {
      const resp = await api<{
        ok: boolean
        design: DesignNode
        changed_ids: string[]
        dropped: string[]
        reason?: string
      }>('/api/apply-locked-edit', {
        method: 'POST',
        body: JSON.stringify({ session_key: sessionKey, before: design, after: newDesign }),
      })
      if (!resp.ok) {
        const hint = `该修改会改变版面结构，已阻止：${resp.reason ?? '越权修改'}。如需改版面请先解除锁定`
        setLockHint(hint)
        window.setTimeout(() => setLockHint(''), 6000)
        return { ok: false, reason: resp.reason }
      }
      if (resp.dropped?.length) {
        setLockHint('AI 部分效果为非预置值，已忽略')
        window.setTimeout(() => setLockHint(''), 6000)
      }
      // 2026-09-17：**差量落地**（原来是整树 clear+重建：并发下会吞掉队友在这期间对别的
      // 节点的改动，并让所有人画布整体重挂）。根 id 变了这类（空白稿 empty → root）由
      // diffDesign 返回 `replace`，自动退化为整体替换。
      // 2026-09-18：落地前先补孤儿坐标——自动冻结之后父级都是 free，模型新增的节点不会带 x/y，
      // 直接落地会压在已有节点上（见 freePlacement.ts）。补位发生在差量计算之前，
      // 所以坐标跟着同一次 applyAiDiff 落库、撤销一步就能整体回退。
      const diff = diffDesign(design, placeUnpositionedChildren(resp.design))
      // ③ 并发前置条件（2026-09-17）：AI 是**基于快照**生成的。落地前核对"队友有没有动过
      // 同一个字段 / 同一处结构"——此前只做到"事后提示已覆盖"，也就是仍然把队友的改动擦掉。
      // 现在：结构被破坏 → 整批取消（不推快照、不动画布，让用户重发）；只有属性字段撞车 →
      // 跳过那些字段（保留队友的版本），其余照常落地。
      const plan = planAiLanding(design, store.getDesign(), diff)
      if (plan.blocked.length) {
        setLockHint(
          `本次 AI 修改和队友刚做的改动撞了（${plan.blocked.length} 处结构改动），已取消、画布未改动；请稍后重新发起，AI 会基于最新画布生成`,
        )
        window.setTimeout(() => setLockHint(''), 9000)
        return { ok: false, reason: '并发冲突：结构被队友改动' }
      }
      // 快照放在"确认能落地"之后：取消的分支不留空撤销步（同 autoFreezeAfterAi 的口径）
      store.pushSnapshot()
      setUndoCount((c) => c + 1)
      store.applyAiDiff(plan.diff)
      if (plan.skipped.length) {
        const n = plan.skipped.reduce((sum, s) => sum + s.fields.length, 0)
        setLockHint(`本次 AI 修改有 ${n} 处和队友的改动撞在一起，已保留队友的版本（其余已应用，可 Ctrl+Z 撤回）`)
        window.setTimeout(() => setLockHint(''), 9000)
      }
      setSelectedIds(new Set())
      // 增量修改后若仍是 flex（首次生成没冻成 free 的情况），同样补一次自动冻结
      void autoFreezeAfterAi()
      const changed = resp.changed_ids?.length ? resp.changed_ids : changedIds
      setHighlightIds(new Set(changed))
      window.setTimeout(() => setHighlightIds(new Set()), 5000)
      return { ok: true, dropped: resp.dropped }
    } catch {
      // 闸门确认失败（网络等）：无法判定锁状态，保守处理——画布保持原样
      setLockHint('AI 修改未能确认（网络异常），画布保持原样，请重试')
      window.setTimeout(() => setLockHint(''), 6000)
      return { ok: false, reason: '网络异常' }
    }
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
    <div className="flex h-screen flex-col" data-testid="workspace-page" ref={pageRef}>
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
            disabled={optimizing || readOnly || layoutLocked}
            title={
              readOnly
                ? '只读访客：不能修改画布'
                : layoutLocked
                  ? '版面已确认：请先解除版面锁定再做布局优化'
                  : undefined
            }
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
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            data-testid="geometry-audit"
            onClick={handleAudit}
          >
            🧭 几何体检
          </Button>
          {/* T46a-4：工作台内的邀请入口（不用再跑到设置页）；草稿没有工作区时不显示 */}
          {collabWorkspaceId !== null && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              data-testid="invite-collab"
              onClick={() => setInviteOpen(true)}
            >
              👥 邀请协作
            </Button>
          )}
          {design.style?.layout !== 'free' && design.children && design.children.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              data-testid="convert-free"
              disabled={layoutLocked || readOnly}
              title={
                readOnly
                  ? '只读访客：不能修改画布'
                  : layoutLocked
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
            title="撤销（Ctrl+Z）· 只影响你自己的操作"
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
              disabled={readOnly}
              onClick={handleUndo}
            >
              ↩ 撤销优化
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {readOnly && (
            <span
              className="rounded-full border border-amber-500/60 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600"
              data-testid="readonly-badge"
              title="只读访客：可查看实时协作，不能修改"
            >
              只读访客
            </span>
          )}
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
            disabled={saving || readOnly}
            title={readOnly ? '只读访客：不能保存修改' : undefined}
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
          {gatewayOn && signedRoomNeeded && !signedRoom && !collabRoomError && (
            <span className="text-[11px] text-muted-foreground" data-testid="collab-waiting">
              正在获取协作房间…
            </span>
          )}
          {collabRoomError && (
            <span className="text-[11px] text-amber-600" data-testid="collab-room-error">
              {collabRoomError}
            </span>
          )}
          <Link to="/" className="hover:text-foreground" data-testid="go-home">← 主页</Link>
          <Link to="/api-config" className="hover:text-foreground">API 配置</Link>
          <span data-testid="selection-count">{selectedIds.size > 0 ? `已选 ${selectedIds.size} 个节点` : ''}</span>
        </div>
      </header>
      {/* T46a-4：邀请协作风幕（复用设置页那块面板，固定到本稿的工作区） */}
      {inviteOpen && collabWorkspaceId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
          data-testid="invite-dialog"
          onClick={() => setInviteOpen(false)}
        >
          <div className="max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <MembersPanel fixedWorkspaceId={collabWorkspaceId} onClose={() => setInviteOpen(false)} />
          </div>
        </div>
      )}
      <main className="flex flex-1 overflow-hidden">
        {/* 左侧：组件库（可折叠，P2） */}
        <aside
          className="shrink-0 border-r bg-background transition-[width] duration-200"
          style={{ width: paletteCollapsed ? 44 : 192 }}
        >
          <ComponentPalette
            collapsed={paletteCollapsed}
            onToggle={() => setPaletteCollapsed((c) => !c)}
            onAdd={readOnly ? () => setLockHint('只读访客：不能添加组件（需要 owner / editor 权限）') : handleAdd}
          />
        </aside>

        {/* 中间：画布（AI 生成期间锁定） */}
        <div
          className="relative flex-1"
          onPointerDown={(e) => {
            /**
             * 2026-09-17 修（主流程）：**点在右键菜单/推荐浮层上时不要清空它们**。
             *
             * 原来这里无条件 `setCtxMenu(null)`：pointerdown 先冒泡到这里 → React 立刻卸载菜单 →
             * 浏览器随后才派发 `click`，而目标（菜单项）已经从 DOM 里没了 → **整个右键菜单点不动**
             * （推荐组件 / 智能优化 / 复制 / 删除 全是死的）。E2E `component-recommend.spec.ts` 抓到的：
             * 点「✨ 推荐组件」后浮层从未出现。
             * 菜单自己会在点完某项后关闭（各 onClick 里都 `setCtxMenu(null)`），所以这里只需跳过它自己。
             */
            const el = e.target as HTMLElement | null
            if (el?.closest('[data-testid="context-menu"], [data-testid="recommend-popover"]')) return
            setCtxMenu(null)
            setRecommendPop(null)
          }}
        >
          <CanvasWithSelection
            design={design}
            store={store}
            selectedIds={selectedIds}
            onSelectChange={setSelectedIds}
            onDropComponent={readOnly ? undefined : handleDropComponent}
            showGrid={showGrid}
            onCanvasContextMenu={(nodeId, x, y) => setCtxMenu({ x, y, nodeId })}
            highlightIds={highlightIds}
            canvasRef={canvasRef}
            readOnly={readOnly}
            onReadOnlyDragAttempt={
              readOnly
                ? () => {
                    setLockHint('只读访客：拖动/缩放不会生效（需要 owner / editor 权限）。')
                    window.setTimeout(() => setLockHint(''), 4000)
                  }
                : undefined
            }
          />
          {auditIssues !== null && (
            <div
              className="absolute left-1/2 top-3 z-40 w-[420px] -translate-x-1/2 rounded-lg border bg-background p-3 text-xs shadow-lg"
              data-testid="geometry-audit-panel"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium">
                  几何体检：{auditIssues.length === 0 ? '未发现问题 ✓' : `${auditIssues.length} 项`}
                </span>
                <button
                  className="text-muted-foreground hover:text-foreground"
                  data-testid="audit-close"
                  onClick={() => {
                    setAuditIssues(null)
                    setHighlightIds(new Set())
                  }}
                >
                  关闭
                </button>
              </div>
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {auditIssues.map((issue, index) => (
                  <li key={`${issue.kind}-${issue.nodeId}-${index}`}>
                    <button
                      className="w-full rounded px-1.5 py-1 text-left hover:bg-accent"
                      data-testid={`audit-issue-${index}`}
                      onClick={() => setHighlightIds(new Set([issue.nodeId]))}
                    >
                      <span className="mr-1 rounded bg-muted px-1">
                        {
                          {
                            overflow: '溢出',
                            overlap: '重叠',
                            'empty-frame': '空容器',
                            'truncated-text': '截断',
                            'low-contrast': '对比度',
                          }[issue.kind]
                        }
                      </span>
                      {/* 只报"对比度 2.97:1"用户不知道说的是哪个节点，必须点名（2026-09-18） */}
                      <span className="text-muted-foreground" data-testid={`audit-node-${index}`}>
                        {issue.nodeId}
                      </span>
                      <span className="ml-1">{issue.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
          {/* B+：协作内容还没同步回来（房间为准）——明确告诉用户"在等"，而不是看着空画布 */}
          {!dataReady && (
            <div
              className="absolute bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-lg border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow"
              data-testid="sync-pending-hint"
            >
              正在同步协作内容…
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
                      readOnly={readOnly}
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
                    <CanvasSettings
                      root={design}
                      readOnly={readOnly}
                      onUpdate={(updater) => store.updateNode(design.id, updater)}
                    />
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
                    readOnly={readOnly}
                    onGenerate={(generated) => {
                      // 生成落地同样补一次孤儿坐标（模板骨架是 flex，一般用不上；
                      // 但"在 free 画布上重新生成"时会用到，见 freePlacement.ts）
                      store.resetDesign(placeUnpositionedChildren(generated))
                      setSelectedIds(new Set())
                      // 生成即可拖：落地后自动冻结一次（偏好可关，见设置面板）
                      void autoFreezeAfterAi()
                    }}
                    design={design}
                    onIncrementalEdit={handleIncrementalEdit}
                    locked={layoutLocked}
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
                      store.resetDesign(placeUnpositionedChildren(explored))
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
                    readOnly={readOnly}
                    applying={beautifying}
                    error={beautifyError}
                    previewing={effectsPreview}
                    onConfirmLayout={handleConfirmLayout}
                    onUnlock={handleUnlockLayout}
                    onApplyEffect={(nodeId, key, value) => void handleApplyEffect(nodeId, key, value)}
                    selectedIds={selectedIds}
                    onApplyEffectBatch={(nodeIds, key, value) => void handleApplyEffectBatch(nodeIds, key, value)}
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
                    onRestore={
                      readOnly
                        ? () => setLockHint('只读访客：不能恢复历史版本（需要 owner / editor 权限）')
                        : store.isBeautifyLocked
                          ? () =>
                              setLockHint('版面已确认：不能恢复历史版本（会改变布局/尺寸），请先解除版面锁定')
                          : (restored: DesignNode) => {
                              store.resetDesign(restored)
                              setSelectedIds(new Set())
                            }
                    }
                    onVersionSaved={() => setSavedMeta((m) => ({ ...m }))}
                  />
                )}
                {activePanel === 'code' && <CodeViewer filename="src/App.tsx" code={appCode} className="h-full" />}
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
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium">AI 生成后自动转为可自由拖拽</div>
                        <div className="text-xs text-muted-foreground">
                          生成后自动冻结一次版面（保留当前视觉、子节点可任意摆放）；关掉则保持流式布局、拖动只重排顺序
                        </div>
                      </div>
                      <Switch
                        data-testid="settings-auto-freeze"
                        checked={autoFreeze}
                        onCheckedChange={(v) => {
                          const on = Boolean(v)
                          setAutoFreeze(on)
                          writeAutoFreeze(on)
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
  readOnly,
  onReadOnlyDragAttempt,
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
  readOnly?: boolean
  onReadOnlyDragAttempt?: () => void
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
      readOnly={readOnly}
      onReadOnlyDragAttempt={onReadOnlyDragAttempt}
    />
  )
}
