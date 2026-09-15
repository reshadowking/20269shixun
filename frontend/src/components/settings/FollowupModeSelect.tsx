/**
 * 追问模式下拉（Q1）：智能（默认）/ 精简 / 详细 / 关闭，切换立即生效（localStorage 持久化）。
 * 设置面板与 API 配置页共用。
 *
 * T29 修复：本组件是**受控** select，但此前没有本地 state——切换只写 localStorage，
 * 组件不重渲染，React 又把值按旧值重置回去，表现为"切换后不显示、要等页面重渲染才显示"。
 * 现在用内部 state 承接，切换即刻回显（行为仍是纯前端，不发任何请求）。
 */
import { useState } from 'react'

import { FOLLOWUP_MODES, getFollowupMode, setFollowupMode, type FollowupMode } from '@/lib/followup'

interface FollowupModeSelectProps {
  value?: FollowupMode
  onChange?: (mode: FollowupMode) => void
}

export default function FollowupModeSelect({ value, onChange }: FollowupModeSelectProps) {
  const [inner, setInner] = useState<FollowupMode>(() => value ?? getFollowupMode())
  const current = value ?? inner
  return (
    <div className="flex flex-col gap-1">
      <select
        data-testid="followup-mode-select"
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
        value={current}
        onChange={(e) => {
          const mode = e.target.value as FollowupMode
          setInner(mode)
          setFollowupMode(mode)
          onChange?.(mode)
        }}
      >
        {FOLLOWUP_MODES.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <p className="text-[11px] text-muted-foreground">
        {FOLLOWUP_MODES.find((m) => m.value === current)?.desc}（
        <span className="text-primary">切换立即生效</span>）
      </p>
    </div>
  )
}
