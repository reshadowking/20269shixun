import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import DesignThumbnail from '@/components/chat/DesignThumbnail'
import { optionPositioning, compareOptions } from '@/design/exploreSummary'
import type { DesignNode } from '@/design/types'
import { api } from '@/lib/api'
import { GUARD_HINT, isDesignRequest } from '@/lib/designGuard'
import { diffDesign } from '@/design/diff'
import { isNewDesignIntent } from '@/lib/editIntent'
import {
  loadExploreArchive,
  saveExploreArchive,
  type ExploreArchive,
  type ExploreOption,
} from '@/lib/exploreArchive'
import { createSessionScope } from '@/lib/sessionScope'
import { sessionApi, type AgentState } from '@/lib/sessionApi'
import {
  detectQuickCommands,
  getFollowupMode,
  mergeAnswers,
  stripCommandWords,
  type FollowupQuestion,
} from '@/lib/followup'

/**
 * AI 聊天面板（v2.2 §4.1：自然语言生成设计稿；生成期间画布由上层锁定）。
 * 追问模式（Q1-Q5）：发送前先调 /api/generate/questions 判断是否需要追问，
 * 需要则展示追问卡片（选项 + 永远在的"跳过追问，直接生成"），回答后合并进 prompt 再生成。
 * 快捷指令（Q3）："直接生成/不用问"跳过追问；"问详细一点/简单点"只本次切换模式。
 * 缺陷 1：探索的两份方案带预览与关键差异；选定后留档（另一方案仍可查、刷新可还原）。
 */

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  /** 归属会话（缺陷 4：写入盖章、读取校验，防止跨会话串写） */
  sessionId?: string
  /** 仅本地占位（欢迎语），不落库 */
  ephemeral?: boolean
}

/** B2-2/D1：单条合规拉回明细（与后端 ComplianceFix 对齐） */
export interface ComplianceFixItem {
  node_id: string
  field: string // color / background
  original: string
  corrected: string
}

/** D3：方案探索结果（与 /api/generate/explore 响应对齐） */
export type { ExploreOption }
interface ExploreResult {
  options: ExploreOption[]
  degraded: boolean
}

/**
 * 方案来源徽标（缺陷 1）：模型产物 / 演示模板稿 / 降级回退必须显式区分，不得混同。
 * 优先级：降级（模型不可用回退）> 演示模板稿（未配置模型 Key）> AI 生成。
 */
function SourceBadge({ fallback, mock, testId }: { fallback?: boolean; mock?: boolean; testId: string }) {
  if (fallback) {
    return (
      <span
        className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700"
        data-testid={testId}
        data-source="fallback"
      >
        已降级 · 预置模板
      </span>
    )
  }
  if (mock) {
    return (
      <span
        className="shrink-0 rounded-full border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700"
        data-testid={testId}
        data-source="demo"
      >
        演示模板稿 · 未配置模型
      </span>
    )
  }
  return (
    <span
      className="shrink-0 rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground"
      data-testid={testId}
      data-source="model"
    >
      AI 生成
    </span>
  )
}

interface GenerateResponse {
  design: DesignNode
  template: string
  compliance: number
  violations: number
  fallback: boolean
  /** 演示模式产出（未配置模型 Key：展示的是预置模板稿，须与模型产物区分） */
  mock?: boolean
  error?: string
  violations_detail?: ComplianceFixItem[]
  /** T8 收尾：本轮降级明细（["icon@节点id"]）——用于向用户明示"近似组件表达" */
  degraded?: string[]
}

/** D3：从设计树抽取少量可见文本作方案摘要（最多 4 段，截断 40 字） */
export function extractPreviewTexts(design: DesignNode): string {
  const out: string[] = []
  const walk = (n: DesignNode): void => {
    if (out.length >= 4) return
    if (n.type === 'text') {
      const t = n.props?.text
      if (typeof t === 'string' && t.trim()) out.push(t.trim())
    } else if (n.type === 'component') {
      const p = n.props ?? {}
      for (const key of ['text', 'title', 'label'] as const) {
        const v = p[key]
        if (typeof v === 'string' && v.trim() && out.length < 4) out.push(v.trim())
      }
    }
    for (const c of n.children ?? []) walk(c)
  }
  walk(design)
  const joined = out.join(' · ')
  return joined.length > 40 ? `${joined.slice(0, 40)}…` : joined
}

interface PendingFollowup {
  prompt: string
  questions: FollowupQuestion[]
  index: number
  answers: Record<string, string>
}

const MAX_HISTORY = 50

/** 服务器历史与本地新消息都为空（无用例可渲染） */
function mergesEmpty(list: { text: string }[]): boolean {
  return list.length === 0
}

const WELCOME_TEXT = '你好！我是 AI 设计助手。输入你的需求，我帮你生成设计稿。\n例如：「设计一个电商优惠券领取页，红色调，圆角风格」\n快捷指令：「直接生成」（跳过追问）、「问详细一点」（本次详细追问）、「简单点」（本次精简追问）'

/** 欢迎语：ephemeral（不落库），仅在无真实消息时占位，保持既有消息下标语义不变 */
const WELCOME_MESSAGE: ChatMessage = { role: 'assistant', text: WELCOME_TEXT, ephemeral: true }

/** 改造前的历史里可能存着欢迎语占位；加载时剔除，避免"面板欢迎语 + 历史占位"两条（兼容已迁移数据） */
function isWelcomePlaceholder(text: string): boolean {
  return text.trimStart().startsWith('你好！我是 AI 设计助手')
}

/** T4 批1：闸门落地结果（上层过 /api/apply-locked-edit 后回传；void 兼容旧调用方） */
export interface IncrementalEditOutcome {
  ok: boolean
  reason?: string
  dropped?: string[]
}

interface AIChatPanelProps {
  onGenerate: (design: DesignNode) => void
  /** 生成期间通知上层锁定画布（v2.2 §8.8） */
  onGeneratingChange?: (generating: boolean) => void
  /** P0-1 增量编辑：当前画布树（传入时修改类指令走增量生成） */
  design?: DesignNode
  /** P0-1 增量编辑成功：应用新树 + 被修改节点 id（上层负责快照/高亮/闸门）。
   * T4 批1：返回闸门落地结果——被版面锁拒绝时面板展示拒绝原因而非"已应用"。 */
  onIncrementalEdit?: (
    newDesign: DesignNode,
    changedIds: string[],
  ) => IncrementalEditOutcome | Promise<IncrementalEditOutcome> | void
  /** T4 批2：当前是否处于版面锁定阶段（WorkspacePage 从服务端读回的锁状态）。
   * 仅随增量编辑请求告知后端以调整提示词措辞——不是安全开关，闸门仍由服务端判定。 */
  locked?: boolean
  /** P0-1 撤销：回到上一版（快照） */
  onUndo?: () => void
  canUndo?: boolean
  /** 缺陷 4：当前画布会话 id（消息 / Agent 状态 / 工具调用记录都按它存取；替代原 historyScope） */
  sessionKey: string
  /** D1：还原单条合规修正（把节点字段改回 original）——上层负责 Yjs 事务（单撤销步） */
  onComplianceRestore?: (fix: ComplianceFixItem) => void
  /** D3：使用某个探索方案（上层 pushSnapshot + resetDesign，可撤销回原稿） */
  onUseExploreDesign?: (design: DesignNode) => void
}

export default function AIChatPanel({ onGenerate, onGeneratingChange, design, onIncrementalEdit, onUndo, canUndo, sessionKey, onComplianceRestore, onUseExploreDesign, locked }: AIChatPanelProps) {
  const [input, setInput] = useState('')
  /** 会话作用域：本项目会话数据的唯一读写入口（盖章写入 + 过滤读取，跨会话访问抛错） */
  const scope = useMemo(() => createSessionScope(sessionKey), [sessionKey])
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE])
  /** 消息是否已从服务端加载完成——未完成前不写库，避免把上一会话的内容写进新会话 */
  const [sessionReady, setSessionReady] = useState(false)
  /** 会话同步失败提示（降级为"仅本地可见"，不阻塞对话） */
  const [sessionError, setSessionError] = useState('')
  /** 已落库消息条数（增量追加用；切会话时归零） */
  const persistedRef = useRef(0)
  /** 已落库的会话 key：与当前 sessionKey 不一致时禁止写入（防串写的第二道闸） */
  const persistedScopeRef = useRef(sessionKey)
  const [error, setError] = useState('')
  const [generating, setGenerating] = useState(false)
  const [lastPrompt, setLastPrompt] = useState('')
  const [pending, setPending] = useState<PendingFollowup | null>(null)
  /** 参数填充失败（模型超时/限流）：不静默降级，由用户选择重试或使用预置模板 */
  const [fallbackResult, setFallbackResult] = useState<GenerateResponse | null>(null)
  /** D1：最近一次成功生成的合规逐项明细（违规色被拉回列表，可逐项还原/全部接受） */
  const [complianceReport, setComplianceReport] = useState<ComplianceFixItem[] | null>(null)
  /** D3：方案探索结果（2 份方案 + 降级标记）与请求中状态 */
  const [exploreResult, setExploreResult] = useState<ExploreResult | null>(null)
  const [exploring, setExploring] = useState(false)
  /** 缺陷 1：已选定方案的留档（含两套详情，刷新后可还原"我选过哪个方案"） */
  const [archive, setArchive] = useState<ExploreArchive | null>(() => loadExploreArchive(sessionKey))
  /** 缺陷 1：已选档里展开"另一方案"详情 / 重新选择（回到二选一状态） */
  const [viewOther, setViewOther] = useState(false)
  const [rechoosing, setRechoosing] = useState(false)

  // 切换 scope（换设计）时重挂留档，避免看到别的会话的选择记录
  useEffect(() => {
    setArchive(loadExploreArchive(sessionKey))
    setViewOther(false)
    setRechoosing(false)
  }, [sessionKey])

  // 缺陷 4：会话数据以服务端为权威来源——挂载/切换会话时只加载本会话的消息与 Agent 状态
  const prevSessionRef = useRef(sessionKey)
  useEffect(() => {
    let cancelled = false
    // 只在"真的换了会话"时重置本地会话态；挂载首跑不重置（避免吞掉用户刚落下的消息）
    const switched = prevSessionRef.current !== sessionKey
    prevSessionRef.current = sessionKey
    if (switched) {
      setMessages([WELCOME_MESSAGE])
      setPending(null)
      setFallbackResult(null)
      setComplianceReport(null)
      setExploreResult(null)
      setViewOther(false)
      setRechoosing(false)
      setLastPrompt('')
    }
    setSessionReady(false)
    setSessionError('')
    persistedRef.current = 0
    persistedScopeRef.current = sessionKey

    sessionApi
      .messages(sessionKey, MAX_HISTORY)
      .then((r) => {
        if (cancelled) return
        const incoming: ChatMessage[] = r.messages
          .filter((m) => !(m.role === 'assistant' && isWelcomePlaceholder(m.text)))
          .map((m) => ({ role: m.role, text: m.text, sessionId: sessionKey }))
        const { messages: own, dropped } = scope.filter(incoming)
        if (dropped > 0) setSessionError(`已忽略 ${dropped} 条非本会话消息（跨会话读取被拒绝）`)
        // 合并而非覆盖：加载期间用户可能已发出新消息，直接替换会把它们吞掉；
        // 欢迎语保持在首位（与改造前一致），避免按索引 key 的节点错位
        setMessages((prev) => {
          const keepsWelcome = prev.some((m) => m.ephemeral)
          const localNew = prev.filter((m) => !m.ephemeral)
          const merged = [...own, ...localNew]
          if (mergesEmpty(merged)) return keepsWelcome ? [WELCOME_MESSAGE] : []
          return keepsWelcome ? [WELCOME_MESSAGE, ...merged] : merged
        })
        persistedRef.current = own.length
        setSessionReady(true)
      })
      .catch((err) => {
        if (cancelled) return
        setSessionError(`会话同步失败：${err instanceof Error ? err.message : String(err)}（当前仅本地可见）`)
        setSessionReady(true)
      })

    sessionApi
      .get(sessionKey)
      .then((detail) => {
        if (cancelled) return
        const last = (detail.agent_state as AgentState)?.lastPrompt
        if (typeof last === 'string') setLastPrompt(last)
      })
      .catch(() => {
        /* Agent 状态拉取失败不阻塞对话 */
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey])

  // 缺陷 4：增量落库——只追加"尚未落库"的消息；scope 未切换完成前一律不写（防串写）
  useEffect(() => {
    if (!sessionReady) return
    if (persistedScopeRef.current !== sessionKey) return
    const persistable = messages.filter((m) => !m.ephemeral)
    if (persistable.length <= persistedRef.current) return
    const pending = persistable.slice(persistedRef.current)
    persistedRef.current = persistable.length
    const stamped = scope.stamp(pending)
    sessionApi
      .append(
        sessionKey,
        stamped.map(({ role, text }) => ({ role, text })),
      )
      .catch((err) => {
        setSessionError(`消息未同步到会话：${err instanceof Error ? err.message : String(err)}`)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, sessionKey, sessionReady])

  // 缺陷 4：Agent 状态（上次需求）随会话持久化——换画布后「重试上次需求」不会串到别的会话
  useEffect(() => {
    if (!sessionReady || !lastPrompt || persistedScopeRef.current !== sessionKey) return
    const timer = window.setTimeout(() => {
      sessionApi.append(sessionKey, [], { lastPrompt }).catch(() => {
        /* 状态同步失败不阻塞对话 */
      })
    }, 400)
    return () => window.clearTimeout(timer)
  }, [lastPrompt, sessionKey, sessionReady])

  /** 工具调用记账（缺陷 4）：失败不影响主流程，不含任何用户文本 */
  const recordToolCall = (kind: string, ok: boolean) => {
    sessionApi.recordToolCall(sessionKey, kind, ok).catch(() => {
      /* 记账失败忽略 */
    })
  }

  const QUICK_PROMPTS = [
    '设计一个电商优惠券领取页，红色调，圆角风格',
    '设计一个简洁的登录页面',
    '设计一个金融数据仪表板',
    '设计一个电商运动鞋促销页，4 个商品卡片',
  ]

  const setBusy = (busy: boolean) => {
    setGenerating(busy)
    onGeneratingChange?.(busy)
  }

  const runGenerate = async (prompt: string, editDesign?: DesignNode) => {
    setError('')
    setBusy(true)
    const isEdit = editDesign !== undefined
    try {
      const body: Record<string, unknown> = { prompt }
      // T24：带上会话 id——后端据此取最近 2 轮历史（含上一轮指令原文）
      body.session_key = sessionKey
      if (isEdit) {
        body.design = editDesign
        // T4 批2：告知后端当前处于版面锁定阶段（仅影响提示词措辞）。安全判定不在
        // 客户端——闸门按服务端 design_locks 查表，谎报 locked 只会得到被拒结果。
        body.locked = locked === true
      }
      const resp = await api<GenerateResponse>('/api/generate', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      recordToolCall(isEdit ? 'incremental-edit' : 'generate', !resp.fallback)
      if (resp.fallback) {
        if (isEdit) {
          // 增量修改失败：画布保持原样（后端兜底返回原树），提示重试
          // T24：结构/落地类失败时给出"怎么重做"的出口（否则用户只会反复重试同一句）
          const rebuildHint = /未保留原有结构|无法落地/.test(resp.error ?? '')
            ? '\n如果是想整体重做，请以「重新设计…」开头。'
            : ''
          setMessages((m) => [
            ...m,
            {
              role: 'assistant',
              text: `⚠️ 修改失败（画布保持原样）\n原因：${resp.error ?? '未知'}。\n可点击下方「↻ 重试上次需求」重新尝试。${rebuildHint}`,
            },
          ])
          return
        }
        // 不静默降级：告知失败原因，让用户选择重试或使用预置模板
        setFallbackResult(resp)
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            text: `⚠️ AI 生成失败（模板：${resp.template === 'free' ? '自由生成' : resp.template}）\n原因：${resp.error ?? '未知'}。\n可点击下方「重试生成」，或「使用预置模板」继续编辑。`,
          },
        ])
        return
      }
      // D1：成功响应携带合规明细时展示逐项报告（生成与增量均适用）
      setComplianceReport(resp.violations_detail && resp.violations_detail.length > 0 ? resp.violations_detail : null)
      // T24：有稿时不再前置拦截"无编辑动词"的输入（"太丑了""再来一版"这类对话式延续），
      // 交由模型按 INCREMENTAL_SYSTEM 的兜底指令判定；模型原样返回（零改动）时如实说明，
      // 不冒充"已应用修改 ✓"，也不产生一次无意义的撤销步。
      const changedForEdit = isEdit && editDesign ? diffDesign(editDesign, resp.design) : []
      if (isEdit && editDesign && changedForEdit.length === 0) {
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            text: '这次没有需要改动的地方：没有识别出可执行的界面改动。\n如果这是无关问题，我只处理 UI / 界面设计相关需求；如果想整体重做，请以「重新设计…」开头。',
          },
        ])
        return
      }
      if (isEdit && editDesign && onIncrementalEdit) {
        const changed = changedForEdit
        // T4 批1：上层把 AI 结果送服务端闸门（锁状态由服务端判定）后再落地
        const outcome = await onIncrementalEdit(resp.design, changed)
        if (outcome && outcome.ok === false) {
          setMessages((m) => [
            ...m,
            {
              role: 'assistant',
              text: `⛔ 该修改已被版面锁拒绝（画布保持原样）\n原因：${outcome.reason ?? '越权修改'}。如需改版面请先解除版面锁定，再重试本次修改。`,
            },
          ])
          return
        }
        const droppedNote = outcome?.dropped?.length ? '\n部分效果为非预置值，已忽略。' : ''
        // T8 收尾（缺口清单 §4.8）：降级不再静默——明示"近似组件表达"
        const degradedNote = resp.degraded?.length
          ? `\n⚠️ 有 ${resp.degraded.length} 项能力暂不支持，已用近似组件表达。`
          : ''
        const echo = prompt.length > 20 ? `${prompt.slice(0, 20)}…` : prompt
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            text: `按你说的「${echo}」，已应用修改 ✓（仅改动 ${changed.length > 0 ? changed.length : '指定'} 处，其余保持不变）${droppedNote}${degradedNote}\n被修改的节点已高亮提示；输入「撤销」可回到修改前。`,
          },
        ])
        return
      }
      onGenerate(resp.design)
      const freeNote =
        resp.template === 'free'
          ? '\n当前为自由生成模式，建议使用顶部「✨智能优化布局」统一间距与对齐。'
          : ''
      // 演示模式必须显式标注：未配置模型 Key 时给出的是预置模板稿，不得与模型产物混同
      const sourceNote = resp.mock
        ? '\n⚠️ 演示模式：未配置模型 Key，本稿为预置模板（非模型生成）。到「API 配置」填入 Key 后可调用模型。'
        : ''
      const degradedNote = resp.degraded?.length
        ? `\n⚠️ 有 ${resp.degraded.length} 项能力暂不支持，已用近似组件表达。`
        : ''
      // T19：合规文案降调——把检查器"自动对齐了几处颜色"说清楚，而不是甩一个"规范兼容率 23.6%"
      const alignmentNote = resp.violations > 0 ? `✓ 已按设计规范自动对齐 ${resp.violations} 处颜色` : '✓'
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: `已生成设计稿（模板：${resp.template === 'free' ? '自由生成' : resp.template}）${alignmentNote}${sourceNote}${freeNote}${degradedNote}\n可在右侧属性面板继续编辑，或输入新需求重新生成。`,
        },
      ])
    } catch (err) {
      recordToolCall(isEdit ? 'incremental-edit' : 'generate', false)
      setError(err instanceof Error ? err.message : '生成失败，请稍后重试')
      setMessages((m) => [...m, { role: 'assistant', text: '生成失败：' + (err instanceof Error ? err.message : '未知错误') }])
    } finally {
      setBusy(false)
    }
  }

  /** 失败后重试（P0：失败不静默） */
  const handleFallbackRetry = () => {
    if (!lastPrompt) return
    setFallbackResult(null)
    runGenerate(stripCommandWords(lastPrompt))
  }

  /** 失败后仍想用模板稿：显式确认后才上画布 */
  const handleUseTemplate = () => {
    if (!fallbackResult) return
    onGenerate(fallbackResult.design)
    setMessages((m) => [
      ...m,
      {
        role: 'assistant',
        text: `已使用预置模板（未调用模型）。可在右侧属性面板继续编辑，或「↻ 重试上次需求」再生成一次。`,
      },
    ])
    setFallbackResult(null)
  }

  /** D1：还原单条合规修正（节点字段改回 original，Yjs 单事务=可撤销）；该项从报告移除 */
  const handleRestoreFix = (fix: ComplianceFixItem) => {
    onComplianceRestore?.(fix)
    setComplianceReport((list) => {
      if (!list) return list
      const rest = list.filter((f) => f !== fix)
      return rest.length > 0 ? rest : null
    })
  }

  /** D3：探索 2 份方案（基于最近一次需求；无需求时提示先描述） */
  const handleExplore = async () => {
    const prompt = (lastPrompt || input).trim()
    if (!prompt) {
      setMessages((m) => [...m, { role: 'assistant', text: '请先在上方描述你的设计需求（或先生成一次），再使用「探索 2 个方案」。' }])
      return
    }
    setExploring(true)
    setExploreResult(null)
    setViewOther(false)
    setRechoosing(false)
    try {
      const resp = await api<ExploreResult>('/api/generate/explore', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      })
      recordToolCall('explore', true)
      setExploreResult(resp)
    } catch (err) {
      recordToolCall('explore', false)
      setMessages((m) => [...m, { role: 'assistant', text: `方案探索失败：${err instanceof Error ? err.message : String(err)}` }])
    } finally {
      setExploring(false)
    }
  }

  /**
   * 缺陷 1：采用/改用某份方案（上层快照后可撤销回原稿）。
   * 已选定过方案时再选会覆盖当前画布 → 二次确认；选定后写入留档，刷新仍能还原"我选过哪个方案"。
   * 全程不请求后端、不产生任何模型调用。
   */
  const applyExploreOption = (index: number) => {
    const source = exploreResult ?? archive
    const opt = source?.options[index]
    if (!source || !opt) return
    const overwrites = archive !== null
    if (overwrites && !window.confirm(`改用「${opt.label}」会覆盖当前画布内容（可撤销），确定吗？`)) return
    onUseExploreDesign?.(opt.design)
    const next: ExploreArchive = {
      options: source.options,
      degraded: source.degraded,
      chosenIndex: index,
    }
    setArchive(next)
    saveExploreArchive(sessionKey, next)
    setExploreResult(null)
    setViewOther(false)
    setRechoosing(false)
    setMessages((m) => [...m, { role: 'assistant', text: `已加载「${opt.label}」（模板：${opt.template}，兼容率 ${opt.compliance}%）。可点击「↩ 撤销」回到加载前。` }])
  }

  /** 关闭本次探索面板（已选定的留档保留） */
  const handleExploreClose = () => {
    setExploreResult(null)
    setViewOther(false)
    setRechoosing(false)
  }

  const handleSend = async (promptOverride?: string) => {
    const raw = (promptOverride ?? input).trim()
    if (!raw || generating || pending) return
    if (!promptOverride) {
      setMessages((m) => [...m, { role: 'user', text: raw }])
      setInput('')
    }
    setLastPrompt(raw)
    // P0-1：撤销指令 → 回到上一版（快照）
    if (/^(撤销|撤消|回退|回到上一版)/.test(raw.trim())) {
      if (onUndo) {
        onUndo()
        setMessages((m) => [...m, { role: 'assistant', text: '已撤销，回到上一版。' }])
      } else {
        setMessages((m) => [...m, { role: 'assistant', text: '没有可撤销的修改。' }])
      }
      return
    }
    // 缺陷 9 + T10：角色边界分级——增量修改路径（有设计稿且命中编辑动词）不再调守卫：
    // "用户在有设计稿时提要求"本来就该直达模型（§4.9 实测「加高级功能」被误拦）。
    // 首轮生成保持原有强度——「今天天气怎么样」这类无编辑动词的话仍被拦下。
    // T24：有设计稿时按"延续"处理——只有显式"设计/重新设计…"才走重新生成；
    // 这样"太丑了""再来一版"这类对话式输入不再被角色守卫拦下（无稿时的守卫不变）。
    const incremental = Boolean(design) && !isNewDesignIntent(raw)
    if (!incremental && !isDesignRequest(raw)) {
      setMessages((m) => [...m, { role: 'assistant', text: GUARD_HINT }])
      return
    }
    const prompt = stripCommandWords(raw)
    const quick = detectQuickCommands(raw)
    // P0-1：修改类指令且画布有设计 → 增量编辑（跳过追问，携带当前树）
    if (incremental) {
      await runGenerate(prompt, design)
      return
    }
    // Q3：快捷指令"直接生成/不用问"→ 本次跳过追问，直接生成
    if (quick.skipFollowup) {
      await runGenerate(prompt)
      return
    }
    // 追问判断（Q1/Q4/Q5）：失败不阻塞主流程，直接生成
    const mode = quick.modeOverride ?? getFollowupMode()
    setBusy(true)
    try {
      const resp = await api<{ questions: FollowupQuestion[] }>('/api/generate/questions', {
        method: 'POST',
        body: JSON.stringify({ prompt, mode }),
      })
      recordToolCall('questions', true)
      if (resp.questions.length > 0) {
        setPending({ prompt, questions: resp.questions, index: 0, answers: {} })
        return
      }
      await runGenerate(prompt)
    } catch {
      recordToolCall('questions', false)
      await runGenerate(prompt)
    } finally {
      setBusy(false)
    }
  }

  /** 点选项：答完所有问题后合并答案并生成；"随便选一个"用该问题默认值 */
  const answerPending = (option: string) => {
    if (!pending) return
    const { prompt, questions, index, answers } = pending
    const q = questions[index]
    const value = option === '随便选一个' ? q.default : option
    const next = { ...pending, answers: { ...answers, [q.key]: value }, index: index + 1 }
    if (next.index >= questions.length) {
      setPending(null)
      runGenerate(mergeAnswers(prompt, next.answers))
    } else {
      setPending(next)
    }
  }

  /** Q2：跳过追问，用默认值继续生成，不再追问 */
  const skipPending = () => {
    if (!pending) return
    const { prompt, questions, answers } = pending
    const defaults = Object.fromEntries(questions.map((q) => [q.key, q.default]))
    setPending(null)
    runGenerate(mergeAnswers(prompt, { ...answers, ...defaults }))
  }

  const currentQuestion = pending ? pending.questions[pending.index] : null

  /** 缺陷 1：留档里的当前方案与其它方案（查看/重新选择都读留档，不触发任何重新生成） */
  const archivedChosen = archive ? archive.options[archive.chosenIndex] : null
  const archivedOthers = archive
    ? archive.options
        .map((opt, index) => ({ opt, index }))
        .filter(({ index }) => index !== archive.chosenIndex)
    : []

  return (
    <div className="flex h-full flex-col" data-testid="ai-chat-panel">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 1 && (
          <div className="flex flex-wrap gap-1.5 pb-1" data-testid="chat-quick-prompts">
            {QUICK_PROMPTS.map((p) => (
              <button
                key={p}
                className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                data-testid={`chat-quick-${p.slice(0, 6)}`}
                onClick={() => setInput(p)}
              >
                {p.slice(0, 14)}…
              </button>
            ))}
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
              msg.role === 'user'
                ? 'ml-auto bg-primary text-primary-foreground'
                : 'bg-muted text-foreground'
            }`}
            data-testid={`chat-msg-${msg.role}-${i}`}
          >
            {msg.text}
          </div>
        ))}
        {generating && (
          <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground" data-testid="chat-generating">
            AI 正在生成设计稿，请稍候…
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        {sessionError && (
          <p className="text-[11px] text-amber-600" data-testid="session-sync-error">
            {sessionError}
          </p>
        )}
      </div>
      {pending && currentQuestion && (
        <div className="space-y-2 border-t p-3" data-testid="followup-card">
          <div className="text-sm font-medium" data-testid="followup-question">
            {currentQuestion.question}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {currentQuestion.options.map((opt) => (
              <button
                key={opt}
                className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                data-testid={`followup-option-${opt}`}
                onClick={() => answerPending(opt)}
              >
                {opt === '随便选一个' ? `🎲 ${opt}` : opt}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            data-testid="followup-skip"
            onClick={skipPending}
          >
            跳过追问，直接生成
          </Button>
        </div>
      )}
      {messages.length > 1 && (
        <div className="border-t px-3 pt-1">
          <button
            className="w-full text-center text-[11px] text-muted-foreground hover:text-foreground"
            data-testid="chat-clear-history"
            onClick={() => {
              // 缺陷 4b：清空会话需二次确认；只清当前 sessionId 的消息与 Agent 状态
              if (!window.confirm('清空当前会话的消息与 Agent 状态？画布与快照保留，其他会话不受影响。')) return
              setMessages([WELCOME_MESSAGE])
              setPending(null)
              setFallbackResult(null)
              setComplianceReport(null)
              setExploreResult(null)
              setLastPrompt('')
              persistedRef.current = 0
              sessionApi.clear(sessionKey).catch((err) => {
                setSessionError(`清空会话失败：${err instanceof Error ? err.message : String(err)}`)
              })
            }}
          >
            清空会话
          </button>
        </div>
      )}
      {canUndo && (
        <div className="border-t p-3">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            data-testid="chat-undo"
            onClick={() => {
              onUndo?.()
              setMessages((m) => [...m, { role: 'assistant', text: '已撤销，回到上一版。' }])
            }}
          >
            ↩ 撤销修改（回到上一版）
          </Button>
        </div>
      )}
      <div className="border-t p-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs"
          data-testid="explore-options"
          disabled={generating || exploring}
          onClick={handleExplore}
        >
          {exploring ? '探索中…（并行生成 2 份方案）' : '✨ 探索 2 个方案'}
        </Button>
      </div>
      {exploreResult && (
        <div className="space-y-2 border-t p-3" data-testid="explore-result">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">方案探索（{exploreResult.options.length} 份）</span>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              data-testid="explore-close"
              onClick={handleExploreClose}
            >
              ✕
            </button>
          </div>
          {exploreResult.degraded && (
            <div className="text-[11px] text-amber-600" data-testid="explore-degraded-notice">
              部分方案已降级为预置模板（模型暂不可用），已在每份方案上标出来源。
            </div>
          )}
          {exploreResult.options.map((opt, i) => (
            <div key={i} className="rounded-md border bg-muted/40 p-2 text-xs" data-testid={`explore-option-${i}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium text-foreground">{opt.label}</div>
                <SourceBadge fallback={opt.fallback} mock={opt.mock} testId={`explore-source-${i}`} />
              </div>
              <DesignThumbnail design={opt.design} testId={`explore-thumb-${i}`} />
              <div className="mt-0.5 text-muted-foreground">
                模板：{opt.template} ｜ 兼容率 {opt.compliance}%
              </div>
              <div className="mt-0.5 text-muted-foreground" data-testid={`explore-positioning-${i}`}>
                {optionPositioning(opt)}
              </div>
              <div className="mt-0.5 line-clamp-2 text-muted-foreground">{extractPreviewTexts(opt.design)}</div>
              {opt.degraded_kinds?.length ? (
                <div className="mt-0.5 text-[11px] text-amber-600" data-testid={`explore-degraded-${i}`}>
                  ⚠️ 有 {opt.degraded_kinds.length} 项能力暂不支持，已用近似组件表达。
                </div>
              ) : null}
              <Button
                size="sm"
                className="mt-1.5 h-6 w-full text-[11px]"
                data-testid={`explore-use-${i}`}
                onClick={() => applyExploreOption(i)}
              >
                使用此方案
              </Button>
            </div>
          ))}
          {exploreResult.options.length >= 2 && (
            <ul className="space-y-0.5 rounded-md border bg-background p-2" data-testid="explore-diff">
              <li className="text-[11px] font-medium text-muted-foreground">关键差异</li>
              {compareOptions(exploreResult.options[0], exploreResult.options[1]).map((line) => (
                <li key={line} className="text-[11px] text-muted-foreground">
                  · {line}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {archive && archivedChosen && (
        <div className="border-t p-3" data-testid="explore-archive">
          <div className="rounded-md border bg-muted/40 p-2 text-xs">
            <div className="flex items-start justify-between gap-2">
              <span className="text-muted-foreground">已选定方案</span>
              <SourceBadge fallback={archivedChosen.fallback} mock={archivedChosen.mock} testId="explore-archive-source" />
            </div>
            <div className="mt-0.5 font-medium text-foreground" data-testid="explore-archive-chosen">
              {archivedChosen.label}
            </div>
            <div className="mt-1 flex gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-6 flex-1 px-1 text-[11px]"
                data-testid="explore-view-other"
                onClick={() => {
                  setViewOther((v) => !v)
                  setRechoosing(false)
                }}
              >
                {viewOther ? '收起另一方案' : `查看另一方案（${archivedOthers.length}）`}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 flex-1 px-1 text-[11px]"
                data-testid="explore-rechoose"
                onClick={() => {
                  setRechoosing((v) => !v)
                  setViewOther(false)
                }}
              >
                {rechoosing ? '取消重新选择' : '重新选择方案'}
              </Button>
            </div>
            {viewOther && (
              <div className="mt-2 space-y-2" data-testid="explore-other-panel">
                {archivedOthers.map(({ opt, index }) => (
                  <div key={index} className="rounded-md border bg-background p-2" data-testid={`explore-other-${index}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium text-foreground">{opt.label}</div>
                      <SourceBadge fallback={opt.fallback} mock={opt.mock} testId={`explore-other-source-${index}`} />
                    </div>
                    <DesignThumbnail design={opt.design} testId={`explore-other-thumb-${index}`} />
                    <div className="mt-0.5 text-muted-foreground">
                      模板：{opt.template} ｜ 兼容率 {opt.compliance}%
                    </div>
                    <div className="mt-0.5 text-muted-foreground">{optionPositioning(opt)}</div>
                    <div className="mt-0.5 line-clamp-2 text-muted-foreground">{extractPreviewTexts(opt.design)}</div>
                    <Button
                      size="sm"
                      className="mt-1.5 h-6 w-full text-[11px]"
                      data-testid={`explore-other-use-${index}`}
                      onClick={() => applyExploreOption(index)}
                    >
                      改用此方案
                    </Button>
                  </div>
                ))}
                {archive.options.length >= 2 && (
                  <ul className="space-y-0.5 rounded-md border bg-background p-2" data-testid="explore-other-diff">
                    <li className="text-[11px] font-medium text-muted-foreground">关键差异</li>
                    {compareOptions(archive.options[0], archive.options[1]).map((line) => (
                      <li key={line} className="text-[11px] text-muted-foreground">
                        · {line}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {rechoosing && (
              <div className="mt-2 space-y-2" data-testid="explore-rechoose-panel">
                <div className="text-[11px] text-muted-foreground">
                  重新选择会覆盖当前画布内容（可撤销），选择时需要二次确认。
                </div>
                {archive.options.map((opt, i) => (
                  <div key={i} className="rounded-md border bg-background p-2" data-testid={`explore-rechoose-${i}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium text-foreground">{opt.label}</div>
                      <SourceBadge fallback={opt.fallback} mock={opt.mock} testId={`explore-rechoose-source-${i}`} />
                    </div>
                    <DesignThumbnail design={opt.design} width={140} height={84} testId={`explore-rechoose-thumb-${i}`} />
                    <div className="mt-0.5 text-muted-foreground">
                      模板：{opt.template} ｜ 兼容率 {opt.compliance}%
                    </div>
                    <Button
                      size="sm"
                      variant={i === archive.chosenIndex ? 'secondary' : 'default'}
                      className="mt-1.5 h-6 w-full text-[11px]"
                      data-testid={`explore-rechoose-use-${i}`}
                      onClick={() => applyExploreOption(i)}
                    >
                      {i === archive.chosenIndex ? '当前方案（重新应用）' : '改用此方案'}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {complianceReport && complianceReport.length > 0 && (
        <div className="space-y-2 border-t p-3" data-testid="compliance-report">
          <div className="text-xs font-medium text-muted-foreground">
            规范检查：{complianceReport.length} 处颜色已自动拉回设计令牌（可逐项还原）
          </div>
          {complianceReport.map((fix, i) => (
            <div
              key={`${fix.node_id}-${fix.field}-${i}`}
              className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-2 py-1.5 text-xs"
              data-testid={`compliance-fix-${i}`}
            >
              <span className="min-w-0 flex-1 truncate" title={`${fix.node_id}.${fix.field}`}>
                <span className="text-muted-foreground">[{fix.node_id}] {fix.field}</span>{' '}
                <span className="text-destructive line-through">{fix.original}</span>
                {' → '}
                <span className="font-medium text-foreground">{fix.corrected}</span>
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-6 shrink-0 px-2 text-[11px]"
                data-testid={`compliance-restore-${i}`}
                onClick={() => handleRestoreFix(fix)}
              >
                还原此项
              </Button>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            data-testid="compliance-accept-all"
            onClick={() => setComplianceReport(null)}
          >
            全部接受（保持修正）
          </Button>
        </div>
      )}
      {fallbackResult && (
        <div className="space-y-2 border-t p-3" data-testid="fallback-actions">
          <Button
            size="sm"
            className="w-full text-xs"
            data-testid="fallback-retry"
            disabled={generating}
            onClick={handleFallbackRetry}
          >
            ↻ 重试生成
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            data-testid="fallback-use-template"
            onClick={handleUseTemplate}
          >
            使用预置模板（兼容率 {fallbackResult.compliance}%）
          </Button>
        </div>
      )}
      <div className="border-t p-3">
        <Textarea
          data-testid="chat-input"
          className="min-h-16 resize-none text-sm"
          placeholder="描述你想要的设计稿，例如：登录页、电商优惠券页、数据仪表板…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
        />
        <Button
          className="mt-2 w-full"
          data-testid="chat-send"
          disabled={generating || !input.trim()}
          onClick={() => handleSend()}
        >
          {generating ? '生成中…' : '生成设计稿'}
        </Button>
        {lastPrompt && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full text-xs"
            data-testid="chat-retry"
            disabled={generating}
            onClick={() => handleSend(lastPrompt)}
          >
            ↻ 重试上次需求（{lastPrompt.slice(0, 12)}…）
          </Button>
        )}
      </div>
    </div>
  )
}
