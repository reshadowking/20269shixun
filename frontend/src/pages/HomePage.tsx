/**
 * 启动页 / 主页面（缺陷 5/6/8）：进入先看到这里——
 * ① 继续上次编辑（localStorage 草稿）② 最近保存的设计 ③ 新建空白画布 ④ 8 个模板起手。
 * 缺陷 2：「最近的设计」默认最多 8 条，更多时按需分页加载（后端 limit/offset）+ 可收起。
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronUp, Clock, FilePlus2, FolderOpen, LayoutTemplate, LogOut, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import DesignThumbnail from '@/components/chat/DesignThumbnail'
import WorkspaceBadges from '@/components/collab/WorkspaceBadges'
import type { DesignNode } from '@/design/types'
import { api, clearAuth, getUsername } from '@/lib/api'
import { loadLatestDraft } from '@/lib/designSession'
import { randomSessionKey } from '@/lib/sessionKey'
import { DEMO_DESIGNS } from '@/design/demoData'

/** 最近设计默认展示条数（缺陷 2 验收口径） */
export const RECENT_DESIGN_LIMIT = 8
/** 「查看更多」的取数分片：一次请求最多拉取 100 条，剩余量大时循环取完 */
const RECENT_FETCH_CHUNK = 100

interface DesignMeta {
  id: number
  name: string
  updated_at: string | null
  node_count: number
  width: number
  height: number
  /** 验收补（T46a）：所属工作区名与我在其中的角色 */
  workspace_name?: string | null
  my_role?: string | null
  /** 谁共享给我的（我自己建的稿件为空） */
  owner_name?: string | null
  is_mine?: boolean
  /** T36：with_preview=true 时后端附带的设计树（渲染缩略图用） */
  design?: DesignNode
}

interface TemplateMeta {
  key: string
  name: string
}

export default function HomePage() {
  const navigate = useNavigate()
  const [designs, setDesigns] = useState<DesignMeta[]>([])
  const [total, setTotal] = useState(0)
  /** 列表状态：loading 首次加载中 / ready 就绪 / error 加载失败（不冒充空数据） */
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [expanded, setExpanded] = useState(false)
  const [moreLoading, setMoreLoading] = useState(false)
  const [moreError, setMoreError] = useState('')
  const [templates, setTemplates] = useState<TemplateMeta[]>([])
  const [hasDraft, setHasDraft] = useState(false)
  /** 最近草稿归属的会话（缺陷 4：草稿按会话分片，"继续上次编辑"回到对应会话） */
  const [draftSession, setDraftSession] = useState<string | null>(null)
  const [username] = useState(() => getUsername() ?? 'demo')

  /** 首屏只取前 8 条（缺陷 2：后端分页，缺省 limit/offset 的全量行为仍兼容旧调用方） */
  const loadFirstPage = useCallback(async () => {
    setListState('loading')
    setMoreError('')
    try {
      const r = await api<{ designs: DesignMeta[]; total?: number }>(
        `/api/designs?limit=${RECENT_DESIGN_LIMIT}&offset=0&with_preview=true`,
      )
      const list = r.designs ?? []
      setDesigns(list)
      setTotal(typeof r.total === 'number' ? r.total : list.length)
      setExpanded(false)
      setListState('ready')
    } catch {
      setListState('error')
    }
  }, [])

  useEffect(() => {
    const latest = loadLatestDraft()
    setHasDraft(latest !== null)
    setDraftSession(latest?.sessionKey ?? null)
    void loadFirstPage()
    api<{ templates: TemplateMeta[] }>('/api/generate/templates')
      .then((r) => setTemplates(r.templates))
      .catch(() => setTemplates([]))
  }, [loadFirstPage])

  const openWorkspace = (query: string) => navigate(`/workspace${query}`)

  /** 查看更多：按需拉取剩余记录并展开（已加载过的数据不重复请求） */
  const handleLoadMore = async () => {
    setMoreError('')
    setExpanded(true)
    if (designs.length >= total) return
    setMoreLoading(true)
    try {
      const acc = [...designs]
      let known = total
      while (acc.length < known) {
        const r = await api<{ designs: DesignMeta[]; total?: number }>(
          `/api/designs?limit=${RECENT_FETCH_CHUNK}&offset=${acc.length}&with_preview=true`,
        )
        const page = r.designs ?? []
        if (page.length === 0) break
        acc.push(...page)
        known = typeof r.total === 'number' ? r.total : known
      }
      setDesigns(acc)
      setTotal(known)
    } catch (err) {
      setMoreError(err instanceof Error ? err.message : '网络或服务器错误')
    } finally {
      setMoreLoading(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!window.confirm('删除该设计？历史版本将一并删除。')) return
    try {
      await api(`/api/designs/${id}`, { method: 'DELETE' })
      const nextTotal = Math.max(0, total - 1)
      const remaining = designs.filter((d) => d.id !== id)
      setTotal(nextTotal)
      // 删除后已加载条数不足首屏（折叠态删掉 8 条中的 1 条）：重取首屏补齐，
      // 否则会出现"还有记录却无入口可看"的空档
      if (remaining.length < Math.min(RECENT_DESIGN_LIMIT, nextTotal)) {
        await loadFirstPage()
        return
      }
      setDesigns(remaining)
    } catch {
      /* 忽略 */
    }
  }

  const fmtTime = (iso: string | null): string => {
    if (!iso) return ''
    const d = new Date(iso)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60_000) return '刚刚'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
    return `${d.getMonth() + 1}月${d.getDate()}日`
  }

  const visibleDesigns = expanded ? designs : designs.slice(0, RECENT_DESIGN_LIMIT)
  const hasMore = total > RECENT_DESIGN_LIMIT

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/60 via-background to-background">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/85 px-6 backdrop-blur">
        {/* T36：品牌区已由全局侧边栏承担（避免双标题）；此栏保留用户/退出操作与 testid 不变 */}
        <div className="text-sm text-muted-foreground">让 AI 从一句话开始，产出可编辑、可交付的设计稿</div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span data-testid="home-user" className="font-medium text-foreground/80">{username}</span>
          <Link to="/settings" className="transition hover:text-foreground">设置</Link>
          <button
            className="flex items-center gap-1 transition hover:text-foreground"
            data-testid="home-logout"
            onClick={() => {
              clearAuth()
              navigate('/login')
            }}
          >
            <LogOut className="h-3.5 w-3.5" /> 退出
          </button>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-10">
        {/* 首屏主张（T36：按样张 v2 提升为 Hero——渐变大标题 + 留白节奏，不承载交互） */}
        <section className="pt-2">
          <h1 className="bg-gradient-to-r from-foreground via-primary/80 to-secondary bg-clip-text text-[34px] font-semibold leading-tight tracking-tight text-transparent">
            用一句话，生成可运行的界面
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            描述需求即可得到可编辑的高保真设计稿；支持协作、规范校验与一键导出 React 工程。
          </p>
        </section>

        {/* 继续上次编辑 */}
        {hasDraft && (
          <section>
            <button
              className="flex w-full items-center gap-4 rounded-2xl border border-border bg-card p-5 text-left transition hover:-translate-y-0.5 hover:border-primary/40"
              data-testid="home-resume"
              onClick={() =>
                openWorkspace(draftSession ? `?session=${draftSession}&from=draft` : '?from=draft')
              }
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/15 text-primary">
                <Clock className="h-6 w-6" />
              </span>
              <span>
                <span className="block text-[15px] font-semibold">继续上次编辑</span>
                <span className="text-xs text-muted-foreground">
                  {draftSession ? `回到会话 ${draftSession}` : '从上次的草稿继续，不会丢失'}
                </span>
              </span>
              <span className="ml-auto text-xs text-muted-foreground">按上次状态接着改 →</span>
            </button>
          </section>
        )}

        {/* 新建 */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
              <FilePlus2 className="h-3.5 w-3.5" />
            </span>
            新建
            <span className="text-xs font-normal text-muted-foreground">空白起步，或一键体验完整功能</span>
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <button
              className="group flex items-center gap-4 rounded-2xl border border-border bg-card p-5 text-left transition hover:-translate-y-0.5 hover:border-primary/40"
              data-testid="home-new-blank"
              onClick={() => {
                // 空白画布（缺陷 4）：新建唯一 sessionId + 全新空会话（不继承任何历史）
                openWorkspace(`?session=${randomSessionKey()}&from=blank`)
              }}
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/15 text-primary transition group-hover:scale-105">
                <FilePlus2 className="h-6 w-6" />
              </span>
              <span>
                <span className="block text-[15px] font-semibold">空白画布</span>
                <span className="text-xs text-muted-foreground">自由布局，从零开始</span>
              </span>
            </button>
            <button
              className="group flex items-center gap-4 rounded-2xl border border-border bg-card p-5 text-left transition hover:-translate-y-0.5 hover:border-primary/40"
              data-testid="home-new-demo"
              onClick={() => openWorkspace(`?from=demo&demo=${DEMO_DESIGNS[0].id}`)}
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition group-hover:scale-105">
                <FolderOpen className="h-6 w-6" />
              </span>
              <span>
                <span className="block text-[15px] font-semibold">示例优惠券页</span>
                <span className="text-xs text-muted-foreground">快速体验完整功能</span>
              </span>
            </button>
          </div>
        </section>

        {/* 模板起手 */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-secondary/10 text-secondary">
              <LayoutTemplate className="h-3.5 w-3.5" />
            </span>
            从模板开始
            <span className="text-xs font-normal text-muted-foreground">选骨架，AI 填充内容</span>
          </h2>
          <div className="grid grid-cols-4 gap-3">
            {templates.map((t) => (
              <button
                key={t.key}
                className="overflow-hidden rounded-xl border border-border bg-card text-left transition hover:-translate-y-0.5 hover:border-primary/40"
                data-testid={`home-template-${t.key}`}
                onClick={() => openWorkspace(`?template=${t.key}`)}
              >
                {/* T36：模板卡加迷你预览（纯装饰骨架，不依赖外部图片） */}
                <span className="block h-[68px] bg-muted/40 p-3">
                  <span className="mb-1.5 block h-1.5 w-2/5 rounded-full bg-foreground/15" />
                  <span className="mb-1.5 block h-1.5 w-3/5 rounded-full bg-foreground/10" />
                  <span className="block h-3 w-10 rounded-full bg-primary/70" />
                </span>
                <span className="block border-t border-border px-3 py-2 text-xs text-muted-foreground">{t.name}</span>
              </button>
            ))}
          </div>
        </section>

        {/* 最近设计（缺陷 2：默认最多 8 条，更多时按需加载 + 可收起） */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <FolderOpen className="h-3.5 w-3.5" />
            </span>
            最近的设计
            {total > 0 && <span className="text-xs font-normal text-muted-foreground">共 {total} 个</span>}
          </h2>
          {listState === 'loading' && designs.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-background p-8 text-center text-sm text-muted-foreground" data-testid="home-designs-loading">
              正在加载最近的设计…
            </p>
          ) : listState === 'error' && designs.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-background p-8 text-center" data-testid="home-designs-error">
              <p className="text-sm text-destructive">最近的设计加载失败，请检查网络或后端服务。</p>
              <Button size="sm" variant="outline" data-testid="home-designs-retry" onClick={() => void loadFirstPage()}>
                重试
              </Button>
            </div>
          ) : designs.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-background p-8 text-center text-sm text-muted-foreground" data-testid="home-empty">
              还没有保存的设计。在工作台点「保存」即可出现在这里。
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="home-designs">
                {visibleDesigns.map((d) => (
                  <div
                    key={d.id}
                    className="group relative overflow-hidden rounded-xl border border-border bg-card transition hover:-translate-y-0.5 hover:border-primary/40"
                  >
                    <button
                      className="w-full text-left"
                      data-testid={`home-design-${d.id}`}
                      onClick={() => openWorkspace(`?design=${d.id}`)}
                    >
                      {/* T36：缩略预览（后端 with_preview 返回设计树；未返回时退化为等高占位，不空白塌陷） */}
                      <div className="h-[122px] overflow-hidden bg-muted/40 px-3 py-3" data-testid={`home-design-thumb-${d.id}`}>
                        {d.design ? (
                          <DesignThumbnail design={d.design} />
                        ) : (
                          <div className="h-full w-full rounded-lg border border-dashed border-border" />
                        )}
                      </div>
                      <div className="border-t border-border px-3 py-2">
                        <div className="truncate text-[13px] font-medium">{d.name}</div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {d.node_count} 个节点 · {fmtTime(d.updated_at)}
                        </div>
                        {/* 验收补：工作区 + 我的角色（别人共享给我的稿件在这里才认得出来） */}
                        <WorkspaceBadges
                          workspaceName={d.workspace_name}
                          role={d.my_role}
                          sharedBy={d.is_mine === false ? d.owner_name : null}
                          testIdPrefix={`home-design-${d.id}`}
                        />
                      </div>
                    </button>
                    {/* 只读访客不给删除入口（后端也会 403，不给假希望） */}
                    {d.my_role !== 'viewer' && (
                      <button
                        className="absolute right-2 top-2 rounded p-1 text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                        data-testid={`home-design-delete-${d.id}`}
                        title="删除"
                        onClick={() => handleDelete(d.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {(hasMore || moreError) && (
                <div className="flex flex-col items-center gap-2">
                  {moreError && (
                    <p className="text-xs text-destructive" data-testid="home-designs-more-error">
                      加载失败：{moreError}。已展示 {designs.length} 条，可重试。
                    </p>
                  )}
                  {hasMore &&
                    (expanded && designs.length > RECENT_DESIGN_LIMIT ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        data-testid="home-collapse"
                        onClick={() => setExpanded(false)}
                      >
                        <ChevronUp className="mr-1 h-3.5 w-3.5" /> 收起
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        data-testid="home-load-more"
                        disabled={moreLoading}
                        onClick={() => void handleLoadMore()}
                      >
                        <ChevronDown className="mr-1 h-3.5 w-3.5" />
                        {moreLoading ? '加载中…' : `查看更多（共 ${total} 条）`}
                      </Button>
                    ))}
                </div>
              )}
            </div>
          )}
        </section>

        <footer className="border-t pt-4 text-center text-xs text-muted-foreground">
          <Button size="sm" variant="link" data-testid="home-goto-workspace" onClick={() => openWorkspace('')}>
            直接进入工作台
          </Button>
        </footer>
      </main>
    </div>
  )
}
