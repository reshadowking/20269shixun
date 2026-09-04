import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { DesignNode } from '@/design/types'
import { api } from '@/lib/api'
import { GUARD_HINT, isDesignRequest } from '@/lib/designGuard'
import { diffDesign } from '@/design/diff'
import { isEditIntent } from '@/lib/editIntent'
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
 */

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

interface GenerateResponse {
  design: DesignNode
  template: string
  compliance: number
  violations: number
  fallback: boolean
  error?: string
}

interface PendingFollowup {
  prompt: string
  questions: FollowupQuestion[]
  index: number
  answers: Record<string, string>
}

/** 会话持久化 key（缺陷 10：切面板/刷新不丢历史）。 */
const CHAT_STORAGE_KEY = 'design-chat-history'
const MAX_HISTORY = 50

/** 按设计隔离的聊天存储 key（P0-4）：有 scope（打开已存设计）按 design-{id} 分 key；
 * 无 scope（空白/模板/草稿/新建未保存路径）退回全局 key，向后兼容既有 localStorage 数据。
 * 边界：未保存路径多标签并发互踩不在本期消除范围（记录于 docs/缺陷与差距清单.md P0-4）。 */
export function chatStorageKey(scope: string | undefined): string {
  return scope ? `${CHAT_STORAGE_KEY}-${scope}` : CHAT_STORAGE_KEY
}

function loadHistory(key: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (
        Array.isArray(parsed) &&
        parsed.every((m) => m && typeof m === 'object' && typeof (m as ChatMessage).role === 'string' && typeof (m as ChatMessage).text === 'string')
      ) {
        return parsed as ChatMessage[]
      }
    }
  } catch {
    /* 损坏数据忽略，回退默认欢迎语 */
  }
  return []
}

interface AIChatPanelProps {
  onGenerate: (design: DesignNode) => void
  /** 生成期间通知上层锁定画布（v2.2 §8.8） */
  onGeneratingChange?: (generating: boolean) => void
  /** P0-1 增量编辑：当前画布树（传入时修改类指令走增量生成） */
  design?: DesignNode
  /** P0-1 增量编辑成功：应用新树 + 被修改节点 id（上层负责快照/高亮） */
  onIncrementalEdit?: (newDesign: DesignNode, changedIds: string[]) => void
  /** P0-1 撤销：回到上一版（快照） */
  onUndo?: () => void
  canUndo?: boolean
  /** P0-4 聊天历史隔离 scope：打开已存设计时传 design id，按设计分 key；缺省保持全局 key */
  historyScope?: string
}

export default function AIChatPanel({ onGenerate, onGeneratingChange, design, onIncrementalEdit, onUndo, canUndo, historyScope }: AIChatPanelProps) {
  const [input, setInput] = useState('')
  const storageKey = chatStorageKey(historyScope)
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const history = loadHistory(storageKey)
    if (history.length > 0) return history
    return [
      {
        role: 'assistant',
        text: '你好！我是 AI 设计助手。输入你的需求，我帮你生成设计稿。\n例如：「设计一个电商优惠券领取页，红色调，圆角风格」\n快捷指令：「直接生成」（跳过追问）、「问详细一点」（本次详细追问）、「简单点」（本次精简追问）',
      },
    ]
  })
  const [error, setError] = useState('')
  const [generating, setGenerating] = useState(false)
  const [lastPrompt, setLastPrompt] = useState('')
  const [pending, setPending] = useState<PendingFollowup | null>(null)
  /** 参数填充失败（模型超时/限流）：不静默降级，由用户选择重试或使用预置模板 */
  const [fallbackResult, setFallbackResult] = useState<GenerateResponse | null>(null)

  // 会话持久化（缺陷 10）：切走面板/刷新后恢复历史
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(messages.slice(-MAX_HISTORY)))
  }, [messages, storageKey])

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
      if (isEdit) body.design = editDesign
      const resp = await api<GenerateResponse>('/api/generate', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (resp.fallback) {
        if (isEdit) {
          // 增量修改失败：画布保持原样（后端兜底返回原树），提示重试
          setMessages((m) => [
            ...m,
            {
              role: 'assistant',
              text: `⚠️ 修改失败（画布保持原样）\n原因：${resp.error ?? '未知'}。\n可点击下方「↻ 重试上次需求」重新尝试。`,
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
      if (isEdit && editDesign && onIncrementalEdit) {
        const changed = diffDesign(editDesign, resp.design)
        onIncrementalEdit(resp.design, changed)
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            text: `已应用修改 ✓（仅改动 ${changed.length > 0 ? changed.length : '指定'} 处，其余保持不变）\n被修改的节点已高亮提示；输入「撤销」可回到修改前。`,
          },
        ])
        return
      }
      onGenerate(resp.design)
      const freeNote =
        resp.template === 'free'
          ? '\n当前为自由生成模式，建议使用顶部「✨智能优化布局」统一间距与对齐。'
          : ''
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: `已生成设计稿（模板：${resp.template === 'free' ? '自由生成' : resp.template}）✓ 规范兼容率 ${resp.compliance}%${freeNote}\n可在右侧属性面板继续编辑，或输入新需求重新生成。`,
        },
      ])
    } catch (err) {
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
        text: `已使用预置模板（规范兼容率 ${fallbackResult.compliance}%，未调用模型）。可在右侧属性面板继续编辑，或「↻ 重试上次需求」再生成一次。`,
      },
    ])
    setFallbackResult(null)
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
    // 缺陷 9：角色边界——无关请求不发请求，礼貌提示
    if (!isDesignRequest(raw)) {
      setMessages((m) => [...m, { role: 'assistant', text: GUARD_HINT }])
      return
    }
    const prompt = stripCommandWords(raw)
    const quick = detectQuickCommands(raw)
    // P0-1：修改类指令且画布有设计 → 增量编辑（跳过追问，携带当前树）
    if (design && isEditIntent(raw)) {
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
      if (resp.questions.length > 0) {
        setPending({ prompt, questions: resp.questions, index: 0, answers: {} })
        return
      }
      await runGenerate(prompt)
    } catch {
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
              setMessages([
                {
                  role: 'assistant',
                  text: '你好！我是 AI 设计助手。输入你的需求，我帮你生成设计稿。',
                },
              ])
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
