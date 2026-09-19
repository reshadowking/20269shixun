/**
 * 变更清单卡片（T49 交付 2）：可折叠、逐条列出、悬停高亮画布节点、每条可单独撤回。
 *
 * 交互照 `compliance-report`（合规卡片）的范式：逐条 + 单条"还原"按钮 + 旧值删除线/新值加粗。
 * 它缺的三样在这里补上：**折叠**（改得多时不占满聊天界面）、**悬停高亮**（知道是哪一条）、
 * **不可撤回时说明原因**（不让单条按钮触发全局撤销）。
 *
 * `items` 由调用方**在消息创建时构建一次并冻结**：撤回只改 `revertedIds`，
 * 绝不重建列表——否则 `change-revert-${i}` 的索引会错行。
 */
import { useState } from 'react'

import type { ChangeItem } from '@/design/changeList'

interface ChangeListCardProps {
  items: ChangeItem[]
  /** 单条撤回（`revertBlocked` 的条目不会调用它） */
  onRevert: (item: ChangeItem) => void
  /** 悬停/聚焦某条 → 高亮画布对应节点；`removed` 条目不高亮（节点已不存在） */
  onHighlight?: (ids: string[]) => void
  /** 已撤回的条目（置灰显示，不整块消失——列表跳动会让人找不到刚点的那条） */
  revertedIds?: string[]
  /** T51 批2：提交反馈。返回 true = 已落库；false = 失败（调用方必须保留选择让用户重试） */
  onFeedback?: (payload: { rating: number; category: string }) => Promise<boolean> | boolean
}

/** 条目多于这个数就默认折叠：改得多时别把聊天界面占满 */
const COLLAPSE_THRESHOLD = 3

/** 反馈类别（与后端 FEEDBACK_CATEGORIES 一致；值是枚举，文案是前端展示）。**单选**：归因要清晰 */
const FEEDBACK_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'structure', label: '结构不对' },
  { value: 'style', label: '样式不对' },
  { value: 'aesthetic', label: '审美不对' },
  { value: 'not_applied', label: '改了没生效' },
  { value: 'worse', label: '越改越差' },
]

type FeedbackState = 'idle' | 'sending' | 'sent' | 'failed'

export default function ChangeListCard({
  items,
  onRevert,
  onHighlight,
  revertedIds = [],
  onFeedback,
}: ChangeListCardProps) {
  const [expanded, setExpanded] = useState(items.length <= COLLAPSE_THRESHOLD)
  const reverted = new Set(revertedIds)

  // T51 批2：反馈区状态。rating 选了才出原因选择；失败保留全部选择（**绝不静默**）
  const [rating, setRating] = useState<number | null>(null)
  const [category, setCategory] = useState('')
  const [feedbackState, setFeedbackState] = useState<FeedbackState>('idle')

  const focus = (item: ChangeItem) => {
    // 删除项：节点已不存在，传 id 会高亮到错误的东西（或什么都高亮不到）
    if (item.kind === 'removed') return
    onHighlight?.([item.id])
  }
  const blur = () => onHighlight?.([])

  const visible = expanded ? items : items.slice(0, 2)

  const submitFeedback = async () => {
    if (rating === null || feedbackState === 'sending') return
    setFeedbackState('sending')
    const ok = onFeedback ? await onFeedback({ rating, category }) : false
    setFeedbackState(ok ? 'sent' : 'failed')
  }

  return (
    <div className="mt-1 rounded-lg border bg-background p-2 text-xs" data-testid="change-list">
      <button
        className="flex w-full items-center justify-between text-left font-medium"
        data-testid="change-list-toggle"
        onClick={() => setExpanded((v) => !v)}
      >
        <span>改动 {items.length} 条{expanded ? '' : '（点击展开）'}</span>
        <span aria-hidden>{expanded ? '▾' : '▸'}</span>
      </button>

      <ul className="mt-1 space-y-1">
        {visible.map((item, i) => {
          const index = items.indexOf(item)
          const done = reverted.has(item.id)
          const ineffectiveFields = item.fields.filter((f) => f.ineffective)
          return (
            <li
              key={`${item.id}-${item.kind}-${i}`}
              className={`flex items-start justify-between gap-2 rounded px-1 py-0.5 ${
                done ? 'text-muted-foreground line-through' : ''
              }`}
              data-testid={`change-item-${index}`}
              onMouseEnter={() => focus(item)}
              onMouseLeave={blur}
              onFocus={() => focus(item)}
              onBlur={blur}
            >
              <span className="min-w-0 flex-1 break-words">
                {item.title}：{item.summary}
                {ineffectiveFields.length > 0 && (
                  <span className="block text-amber-600">
                    {ineffectiveFields.map((f) => f.ineffective).join('；')}
                  </span>
                )}
              </span>
              {done ? (
                <span className="shrink-0 text-muted-foreground">已撤回</span>
              ) : item.revertBlocked ? (
                <span className="shrink-0 text-amber-600" data-testid={`change-blocked-${index}`}>
                  {item.revertBlocked}
                </span>
              ) : (
                <button
                  className="shrink-0 rounded border px-1.5 py-0.5 hover:bg-accent"
                  data-testid={`change-revert-${index}`}
                  onClick={() => onRevert(item)}
                >
                  撤回此项
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {!expanded && items.length > visible.length && (
        <button className="mt-1 text-muted-foreground underline" onClick={() => setExpanded(true)}>
          展开其余 {items.length - visible.length} 条
        </button>
      )}

      {/* T51 批2：反馈闭环的最小 UI。失败**不置灰**——保留选择让用户重试，否则数据会脏 */}
      {onFeedback && feedbackState !== 'sent' && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t pt-2" data-testid="feedback-bar">
          <span className="text-muted-foreground">这次改动有用吗？</span>
          <button
            className={`rounded border px-1.5 py-0.5 ${rating === 1 ? 'border-primary bg-primary/10' : 'hover:bg-accent'}`}
            data-testid="feedback-up"
            onClick={() => setRating(1)}
          >
            👍
          </button>
          <button
            className={`rounded border px-1.5 py-0.5 ${rating === -1 ? 'border-destructive bg-destructive/10' : 'hover:bg-accent'}`}
            data-testid="feedback-down"
            onClick={() => setRating(-1)}
          >
            👎
          </button>
          {rating !== null && (
            <select
              className="h-7 rounded-md border border-input bg-background px-1 text-xs"
              data-testid="feedback-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">原因（可不选）</option>
              {FEEDBACK_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
          <button
            className="rounded border px-1.5 py-0.5 hover:bg-accent disabled:opacity-50"
            data-testid="feedback-submit"
            disabled={feedbackState === 'sending'}
            onClick={() => void submitFeedback()}
          >
            {feedbackState === 'sending' ? '提交中…' : '提交反馈'}
          </button>
          {feedbackState === 'failed' && (
            <span className="text-red-600" data-testid="feedback-failed">
              提交失败，可重试
            </span>
          )}
        </div>
      )}
      {feedbackState === 'sent' && (
        <div className="mt-2 border-t pt-2 text-muted-foreground" data-testid="feedback-done">
          已记录，谢谢反馈——它会告诉我们哪类问题最多。
        </div>
      )}
    </div>
  )
}
