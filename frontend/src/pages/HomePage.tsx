/**
 * 启动页 / 主页面（缺陷 5/6/8）：进入先看到这里——
 * ① 继续上次编辑（localStorage 草稿）② 最近保存的设计 ③ 新建空白画布 ④ 8 个模板起手。
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Clock, FilePlus2, FolderOpen, LayoutTemplate, LogOut, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { api, clearAuth, getUsername } from '@/lib/api'
import { loadDraft } from '@/lib/designSession'
import { BLANK_DESIGN, DEMO_DESIGNS } from '@/design/demoData'

interface DesignMeta {
  id: number
  name: string
  updated_at: string | null
  node_count: number
  width: number
  height: number
}

interface TemplateMeta {
  key: string
  name: string
}

export default function HomePage() {
  const navigate = useNavigate()
  const [designs, setDesigns] = useState<DesignMeta[]>([])
  const [templates, setTemplates] = useState<TemplateMeta[]>([])
  const [hasDraft, setHasDraft] = useState(false)
  const [username] = useState(() => getUsername() ?? 'demo')

  useEffect(() => {
    setHasDraft(loadDraft() !== null)
    api<{ designs: DesignMeta[] }>('/api/designs')
      .then((r) => setDesigns(r.designs))
      .catch(() => setDesigns([]))
    api<{ templates: TemplateMeta[] }>('/api/generate/templates')
      .then((r) => setTemplates(r.templates))
      .catch(() => setTemplates([]))
  }, [])

  const openWorkspace = (query: string) => navigate(`/workspace${query}`)

  const handleDelete = async (id: number) => {
    if (!window.confirm('删除该设计？历史版本将一并删除。')) return
    try {
      await api(`/api/designs/${id}`, { method: 'DELETE' })
      setDesigns((list) => list.filter((d) => d.id !== id))
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

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="flex h-14 items-center justify-between border-b bg-background px-6">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold">AI 原生设计工作台</span>
          <span className="text-xs text-muted-foreground">v0.2</span>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span data-testid="home-user">{username}</span>
          <Link to="/api-config" className="hover:text-foreground">API 配置</Link>
          <button
            className="flex items-center gap-1 hover:text-foreground"
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

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-8">
        {/* 继续上次编辑 */}
        {hasDraft && (
          <section>
            <button
              className="flex w-full items-center gap-3 rounded-xl border bg-background p-5 text-left shadow-sm transition hover:border-primary"
              data-testid="home-resume"
              onClick={() => openWorkspace('?from=draft')}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Clock className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-sm font-medium">继续上次编辑</span>
                <span className="text-xs text-muted-foreground">从上次的草稿继续，不会丢失</span>
              </span>
            </button>
          </section>
        )}

        {/* 新建 */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <FilePlus2 className="h-4 w-4" /> 新建
          </h2>
          <div className="grid grid-cols-3 gap-3">
            <button
              className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-background p-6 transition hover:border-primary"
              data-testid="home-new-blank"
              onClick={() => {
                // 空白画布：直接进工作台并写入草稿起点
                localStorage.setItem(
                  'design-draft',
                  JSON.stringify({ design: BLANK_DESIGN, meta: { updatedAt: Date.now() } }),
                )
                openWorkspace('?from=blank')
              }}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FilePlus2 className="h-6 w-6" />
              </span>
              <span className="text-sm font-medium">空白画布</span>
              <span className="text-xs text-muted-foreground">自由布局，从零开始</span>
            </button>
            <button
              className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-background p-6 transition hover:border-primary"
              data-testid="home-new-demo"
              onClick={() => openWorkspace(`?from=demo&demo=${DEMO_DESIGNS[0].id}`)}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <FolderOpen className="h-6 w-6" />
              </span>
              <span className="text-sm font-medium">示例优惠券页</span>
              <span className="text-xs text-muted-foreground">快速体验完整功能</span>
            </button>
          </div>
        </section>

        {/* 模板起手 */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <LayoutTemplate className="h-4 w-4" /> 从模板开始（AI 填充内容）
          </h2>
          <div className="grid grid-cols-4 gap-3">
            {templates.map((t) => (
              <button
                key={t.key}
                className="rounded-xl border bg-background px-3 py-4 text-center text-sm transition hover:border-primary"
                data-testid={`home-template-${t.key}`}
                onClick={() => openWorkspace(`?template=${t.key}`)}
              >
                {t.name}
              </button>
            ))}
          </div>
        </section>

        {/* 最近设计 */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <FolderOpen className="h-4 w-4" /> 最近的设计
          </h2>
          {designs.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-background p-8 text-center text-sm text-muted-foreground" data-testid="home-empty">
              还没有保存的设计。在工作台点「保存」即可出现在这里。
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="home-designs">
              {designs.map((d) => (
                <div key={d.id} className="group relative rounded-xl border bg-background p-4 shadow-sm transition hover:border-primary">
                  <button
                    className="w-full text-left"
                    data-testid={`home-design-${d.id}`}
                    onClick={() => openWorkspace(`?design=${d.id}`)}
                  >
                    <div className="text-sm font-medium">{d.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {d.node_count} 个节点 · {d.width > 0 ? `${Math.round(d.width)}×${Math.round(d.height)}` : '自适应'}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground/70">{fmtTime(d.updated_at)}</div>
                  </button>
                  <button
                    className="absolute right-2 top-2 rounded p-1 text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    data-testid={`home-design-delete-${d.id}`}
                    title="删除"
                    onClick={() => handleDelete(d.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
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
