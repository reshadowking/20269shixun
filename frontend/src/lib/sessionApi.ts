/**
 * 会话 API 客户端（缺陷 4）：服务端为会话数据的唯一权威来源。
 * 所有调用都带 Bearer token（复用 lib/api）；接口失败时调用方降级为"仅本地可见"并提示。
 */
import { api } from '@/lib/api'

export interface SessionMeta {
  session_id: string
  title: string
  design_id: number | null
  created_at: string | null
  updated_at: string | null
  created?: boolean
}

export interface SessionMessage {
  id?: number
  role: 'user' | 'assistant'
  text: string
  sessionId?: string
  created_at?: string | null
}

export interface AgentState {
  lastPrompt?: string
  [key: string]: unknown
}

export interface ToolCallRecord {
  id: number
  kind: string
  source: string
  ok: boolean
  created_at: string | null
}

/** 在途 ensure 去重（P0-2）：StrictMode 双挂载/多处调用只发一次请求，避免并发创建撞唯一约束 */
const ensureInflight = new Map<string, Promise<SessionMeta>>()

export const sessionApi = {
  ensure(sessionKey: string, designId?: number | null): Promise<SessionMeta> {
    const cached = ensureInflight.get(sessionKey)
    if (cached) return cached
    const pending = api<SessionMeta>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ session_key: sessionKey, design_id: designId ?? undefined }),
    }).finally(() => ensureInflight.delete(sessionKey))
    ensureInflight.set(sessionKey, pending)
    return pending
  },
  list(limit = 20): Promise<{ sessions: SessionMeta[]; total: number }> {
    return api(`/api/sessions?limit=${limit}&offset=0`)
  },
  get(sessionKey: string): Promise<SessionMeta & { agent_state: AgentState }> {
    return api(`/api/sessions/${encodeURIComponent(sessionKey)}`)
  },
  rename(sessionKey: string, title: string): Promise<SessionMeta> {
    return api(`/api/sessions/${encodeURIComponent(sessionKey)}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    })
  },
  /** 绑定会话 → 已保存设计（首次保存为正式设计后调用） */
  bindDesign(sessionKey: string, designId: number): Promise<SessionMeta> {
    return api(`/api/sessions/${encodeURIComponent(sessionKey)}`, {
      method: 'PATCH',
      body: JSON.stringify({ design_id: designId }),
    })
  },
  remove(sessionKey: string): Promise<{ ok: boolean }> {
    return api(`/api/sessions/${encodeURIComponent(sessionKey)}`, { method: 'DELETE' })
  },
  messages(sessionKey: string, limit = 50): Promise<{ messages: SessionMessage[] }> {
    return api(`/api/sessions/${encodeURIComponent(sessionKey)}/messages?limit=${limit}`)
  },
  /** 追加消息（可同时写 Agent 状态）；session_id 声明用于服务端跨会话校验 */
  append(sessionKey: string, messages: SessionMessage[], agentState?: AgentState): Promise<SessionMeta & { pruned: number }> {
    return api(`/api/sessions/${encodeURIComponent(sessionKey)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionKey,
        messages: messages.map((m) => ({ role: m.role, text: m.text })),
        agent_state: agentState,
      }),
    })
  },
  clear(sessionKey: string): Promise<{ ok: boolean }> {
    return api(`/api/sessions/${encodeURIComponent(sessionKey)}/clear`, { method: 'POST' })
  },
  recordToolCall(sessionKey: string, kind: string, ok = true, source = 'app'): Promise<{ ok: boolean }> {
    return api(`/api/sessions/${encodeURIComponent(sessionKey)}/tool-calls`, {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionKey, kind, ok, source }),
    })
  },
  toolCalls(sessionKey: string, limit = 50): Promise<{ tool_calls: ToolCallRecord[] }> {
    return api(`/api/sessions/${encodeURIComponent(sessionKey)}/tool-calls?limit=${limit}`)
  },
  /** Agent 可见上下文窗口（服务端保证只含本会话） */
  context(sessionKey: string, maxTurns = 10): Promise<{ session_id: string; messages: Array<SessionMessage & { session_id: string }> }> {
    return api(`/api/sessions/${encodeURIComponent(sessionKey)}/context?max_turns=${maxTurns}`)
  },
}
