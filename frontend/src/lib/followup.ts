/**
 * 追问模式（开发清单 Q1-Q5）：
 * - Q1：4 档模式（智能/精简/详细/关闭），localStorage 持久化，切换立即生效
 * - Q3：快捷指令（"直接生成"/"不用问"/"问详细一点"/"简单点"），只对本次生效，不改设置
 * - 答案合并：追问回答以"（补充：…）"并入 prompt，再走 AI 生成管线
 */

export type FollowupMode = 'smart' | 'concise' | 'detailed' | 'off'

export const FOLLOWUP_MODES: { value: FollowupMode; label: string; desc: string }[] = [
  { value: 'smart', label: '智能（默认）', desc: '按需追问：信息不全才问' },
  { value: 'concise', label: '精简', desc: '只问最必要的问题' },
  { value: 'detailed', label: '详细', desc: '问得更全：风格、内容重点也会确认' },
  { value: 'off', label: '关闭', desc: '默认不追问（缺页面类型时仍会问一次）' },
]

export interface FollowupQuestion {
  key: 'page_type' | 'style' | 'focus' | string
  question: string
  options: string[]
  default: string
}

const MODE_KEY = 'design-followup-mode'

import { readStorage, writeStorage } from './storage'

export function getFollowupMode(): FollowupMode {
  const v = readStorage(MODE_KEY)
  return v === 'concise' || v === 'detailed' || v === 'off' ? v : 'smart'
}

export function setFollowupMode(mode: FollowupMode) {
  writeStorage(MODE_KEY, mode)
}

/** Q3 快捷指令检测：返回本次的覆盖行为（优先级：跳过追问 > 详细 > 精简） */
export function detectQuickCommands(prompt: string): { skipFollowup?: boolean; modeOverride?: FollowupMode } {
  if (/直接生成|不用问|不用追问|别问了/.test(prompt)) return { skipFollowup: true }
  if (/问详细一点|问细一点|详细点/.test(prompt)) return { modeOverride: 'detailed' }
  if (/简单点|简单一点/.test(prompt)) return { modeOverride: 'concise' }
  return {}
}

/** 从 prompt 中剥离指令词（避免"问详细一点"这类命令污染生成输入） */
const COMMAND_PATTERNS = [/问详细一点|问细一点|详细点/g, /简单点|简单一点/g, /直接生成|不用问|不用追问|别问了/g]

export function stripCommandWords(prompt: string): string {
  let out = prompt
  for (const re of COMMAND_PATTERNS) out = out.replace(re, '')
  return out.replace(/^[，,、\s]+|[，,、\s]+$/g, '').trim()
}

export const QUESTION_LABELS: Record<string, string> = {
  page_type: '页面类型',
  style: '风格',
  focus: '内容重点',
}

/** 把追问答案合并进 prompt：例如 "做一个页面（补充：页面类型：登录页；风格：简洁现代）" */
export function mergeAnswers(prompt: string, answers: Record<string, string>): string {
  const parts = Object.entries(answers).map(([key, value]) => `${QUESTION_LABELS[key] ?? key}：${value}`)
  return parts.length ? `${prompt}（补充：${parts.join('；')}）` : prompt
}
