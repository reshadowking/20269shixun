/**
 * 导出代码对话框（P0-2 + 代码产物展示）。
 *
 * 单一同源原则：界面展示的代码 === 下载 ZIP 里的代码。
 * appCode 与 files 都来自同一次 useMemo 结果，禁止在 UI 里另写一份示例代码。
 *
 * 三个 Tab：
 * - React 代码（默认）：补上需求要求的「代码产物展示」
 * - 文件树：列出 buildEngineFiles() 的实际键，点击查看该文件
 * - 浏览器预览：iframe 静态 HTML（仅预览用，产物是 React 工程）
 */
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Code2, Download, Eye, FileCode2, FolderTree, Loader2, X, XCircle } from 'lucide-react'

import CodeViewer from '@/components/export/CodeViewer'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { DesignNode } from '@/design/types'
import { designToHtml } from '@/export/designToHtml'
import { designToReactApp } from '@/export/designToReact'
import { buildEngineFiles } from '@/export/engineTemplate'
import { collectImageSrcs, loadInlineAssets, type AssetMap } from '@/export/inlineAssets'

interface ExportDialogProps {
  design: DesignNode
  onClose: () => void
}

type TabKey = 'code' | 'files' | 'preview'

/** 稳定的空映射：避免在渲染中新建对象使 useMemo 依赖每次变化（react-hooks/exhaustive-deps） */
const NO_ASSETS: AssetMap = {}

const TABS: Array<{ key: TabKey; label: string; icon: typeof Code2; testId: string }> = [
  { key: 'code', label: 'React 代码', icon: Code2, testId: 'export-tab-code' },
  { key: 'files', label: '文件树', icon: FolderTree, testId: 'export-tab-files' },
  { key: 'preview', label: '浏览器预览', icon: Eye, testId: 'export-tab-preview' },
]

export default function ExportDialog({ design, onClose }: ExportDialogProps) {
  const [withComments, setWithComments] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [tab, setTab] = useState<TabKey>('code')
  /** 文件树里当前查看的文件（默认业务代码 App.tsx） */
  const [activeFile, setActiveFile] = useState('src/App.tsx')
  /**
   * 图片内联映射（ADR-008）：导出前把 `/api/images/{id}` 读成 dataURL，
   * 让导出的工程与 preview.html 自包含（否则脱离平台后图片 404）。
   *
   * 实现注意：`loading` 与 `assets` 由「已加载的 key 是否等于当前 key」**派生**，
   * 不在 effect 里同步 setState（避免 react(set-state-in-effect) 告警）。
   */
  const imageSrcs = useMemo(() => collectImageSrcs(design), [design])
  const [assetLoad, setAssetLoad] = useState<{ key: string; assets: AssetMap; failed: number } | null>(null)
  const assetKey = imageSrcs.join('|')
  const assetsLoading = imageSrcs.length > 0 && assetLoad?.key !== assetKey
  const assets = assetsLoading ? NO_ASSETS : (assetLoad?.assets ?? NO_ASSETS)
  const assetsFailed = assetsLoading ? 0 : (assetLoad?.failed ?? 0)

  useEffect(() => {
    if (imageSrcs.length === 0) return
    let cancelled = false
    loadInlineAssets(imageSrcs)
      .then((r) => {
        if (cancelled) return
        setAssetLoad({ key: imageSrcs.join('|'), assets: r.assets, failed: r.failed.length })
      })
    return () => {
      cancelled = true
    }
  }, [imageSrcs])

  // 单一同源：展示与下载共用同一份产物
  const appCode = useMemo(
    () => designToReactApp(design, withComments, assets),
    [design, withComments, assets],
  )
  const previewHtml = useMemo(() => designToHtml(design, assets), [design, assets])
  const files = useMemo(
    () => buildEngineFiles(appCode, withComments, previewHtml),
    [appCode, withComments, previewHtml],
  )
  const filePaths = useMemo(() => Object.keys(files), [files])
  const shownCode = files[activeFile] ?? appCode

  const handleExport = async () => {
    setExporting(true)
    setError('')
    try {
      const resp = await fetch('/api/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('design-tool-token') ?? ''}`,
        },
        body: JSON.stringify({ files, project_name: 'ai-design-export' }),
      })
      if (!resp.ok) {
        let detail = `导出失败（${resp.status}）`
        try {
          const body = await resp.json()
          if (body.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
        } catch {
          /* 忽略 */
        }
        throw new Error(detail)
      }
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'ai-design-export.zip'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败，请重试')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[2px]"
      data-testid="export-dialog"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-4xl flex-col rounded-2xl border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-start justify-between border-b px-6 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <FileCode2 className="h-4 w-4 text-primary" />
              导出代码
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              产物为可运行的 React 19 + TypeScript 工程；下方展示的代码即 ZIP 内的代码
            </p>
          </div>
          <button
            className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            data-testid="export-close"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 选项 */}
        <div className="flex flex-wrap items-center gap-3 border-b bg-muted/30 px-6 py-3">
          <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
            React 19 + TypeScript + Vite
          </span>
          <span className="text-[11px] text-muted-foreground">内联样式 · 零 UI 库依赖</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">包含注释</span>
            <Switch
              data-testid="export-comments"
              checked={withComments}
              onCheckedChange={(v) => setWithComments(Boolean(v))}
            />
          </div>
        </div>

        {/* Tab 栏 */}
        <div className="flex items-center gap-1 border-b px-4 pt-2" role="tablist">
          {TABS.map(({ key, label, icon: Icon, testId }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              data-testid={testId}
              data-active={tab === key}
              className={`flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-xs font-medium transition ${
                tab === key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setTab(key)}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* 内容 */}
        <div className="min-h-0 px-6 py-4">
          {tab === 'code' && (
            <div data-testid="export-code-panel">
              <CodeViewer filename="src/App.tsx" code={appCode} className="h-80" />
            </div>
          )}

          {tab === 'files' && (
            <div className="flex h-80 gap-3" data-testid="export-files-panel">
              <div className="w-52 shrink-0 overflow-auto rounded-lg border bg-muted/30 p-2">
                {filePaths.map((p) => (
                  <button
                    key={p}
                    data-testid={`export-file-${p}`}
                    className={`block w-full truncate rounded px-2 py-1.5 text-left font-mono text-[11px] transition ${
                      p === activeFile
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    }`}
                    title={p}
                    onClick={() => setActiveFile(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <CodeViewer filename={activeFile} code={shownCode} className="min-w-0 flex-1" />
            </div>
          )}

          {tab === 'preview' && (
            <div className="overflow-hidden rounded-lg border" data-testid="export-preview">
              <div className="flex items-center justify-between bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground">
                <span>浏览器预览（仅预览用，导出物为 React 工程）</span>
                <span className="text-[11px]">也可以双击 ZIP 内的 preview.html 离线查看</span>
              </div>
              <iframe title="设计稿预览" className="h-72 w-full bg-white" sandbox="allow-scripts" srcDoc={previewHtml} />
            </div>
          )}
        </div>

        {/* 状态区 */}
        {error && (
          <div
            className="mx-6 mb-3 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700"
            data-testid="export-error"
          >
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {done && (
          <div
            className="mx-6 mb-3 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-700"
            data-testid="export-success"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              导出成功 ✓ ZIP 已下载。双击 <code className="rounded bg-emerald-100 px-1">preview.html</code> 可直接查看效果；
              接入开发运行 <code className="rounded bg-emerald-100 px-1">npm install &amp;&amp; npm run dev</code>，业务代码在{' '}
              <code className="rounded bg-emerald-100 px-1">src/App.tsx</code>。
            </span>
          </div>
        )}
        {assetsFailed > 0 && (
          <div
            className="mx-6 mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-700"
            data-testid="export-assets-warning"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              有 {assetsFailed} 张图片未能内联（可能已被删除或服务不可用），导出工程里这些图片仍指向原地址。其余图片已正常内联。
            </span>
          </div>
        )}

        {/* 底部操作 */}
        <div className="flex items-center gap-2 border-t px-6 py-4">
          <Button
            size="sm"
            variant="outline"
            data-testid="export-preview-btn"
            onClick={() => setTab(tab === 'preview' ? 'code' : 'preview')}
          >
            <Eye className="mr-1 h-3.5 w-3.5" />
            {tab === 'preview' ? '收起预览' : '在浏览器预览'}
          </Button>
          <span className="ml-auto text-[11px] text-muted-foreground" data-testid="export-file-count">
            {assetsLoading
              ? '正在内联图片…'
              : `共 ${filePaths.length} 个文件 · 含 preview.html 离线预览页`}
          </span>
          <Button
            size="sm"
            data-testid="export-download"
            disabled={exporting || assetsLoading}
            onClick={() => void handleExport()}
          >
            {exporting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
            {exporting ? '导出中…' : done ? '重新导出' : '导出 ZIP'}
          </Button>
        </div>
      </div>
    </div>
  )
}
