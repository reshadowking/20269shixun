/**
 * 导出代码对话框（P0-2）：选项 → 预览（iframe 静态 HTML）→ 下载 ZIP（后端打包）。
 */
import { useState } from 'react'
import { CheckCircle2, Download, Eye, Loader2, X, XCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { DesignNode } from '@/design/types'
import { designToHtml } from '@/export/designToHtml'
import { designToReactApp } from '@/export/designToReact'
import { buildEngineFiles } from '@/export/engineTemplate'

interface ExportDialogProps {
  design: DesignNode
  onClose: () => void
}

export default function ExportDialog({ design, onClose }: ExportDialogProps) {
  const [withComments, setWithComments] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [preview, setPreview] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    setError('')
    try {
      const appCode = designToReactApp(design, withComments)
      const files = buildEngineFiles(appCode, withComments)
      const resp = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('design-tool-token') ?? ''}` },
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="export-dialog" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-xl border bg-background p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">导出代码</h2>
          <button className="rounded p-1 hover:bg-accent" data-testid="export-close" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <div className="text-sm font-medium">框架</div>
            <div className="text-xs text-muted-foreground">React 19 + TypeScript + Vite（内联样式，零 UI 库依赖）</div>
          </div>
          <span className="rounded bg-muted px-2 py-1 text-xs">React（当前唯一）</span>
        </div>

        <div className="mt-3 flex items-center justify-between rounded-lg border p-4">
          <div>
            <div className="text-sm font-medium">包含注释</div>
            <div className="text-xs text-muted-foreground">在 App.tsx 中生成说明注释</div>
          </div>
          <Switch data-testid="export-comments" checked={withComments} onCheckedChange={(v) => setWithComments(Boolean(v))} />
        </div>

        {/* 预览 */}
        {preview && (
          <div className="mt-4 overflow-hidden rounded-lg border" data-testid="export-preview">
            <div className="flex items-center justify-between bg-muted px-3 py-1.5 text-xs text-muted-foreground">
              <span>静态 HTML 预览</span>
              <button className="hover:text-foreground" onClick={() => setPreview(false)}>收起 ✕</button>
            </div>
            <iframe title="设计稿预览" className="h-72 w-full bg-white" sandbox="allow-scripts" srcDoc={designToHtml(design)} />
          </div>
        )}

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700" data-testid="export-error">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {done && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-700" data-testid="export-success">
            <CheckCircle2 className="h-4 w-4" />
            导出成功 ✓ ZIP 已下载。解压后运行 <code className="rounded bg-emerald-100 px-1">npm install && npm run dev</code> 即可预览。
          </div>
        )}

        <div className="mt-4 flex items-center gap-2 border-t pt-4">
          <Button size="sm" variant="outline" data-testid="export-preview-btn" onClick={() => setPreview((v) => !v)}>
            <Eye className="mr-1 h-3.5 w-3.5" />
            {preview ? '收起预览' : '在浏览器预览'}
          </Button>
          <Button size="sm" data-testid="export-download" disabled={exporting} onClick={handleExport}>
            {exporting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
            {exporting ? '导出中…' : done ? '重新导出' : '导出 ZIP'}
          </Button>
        </div>
      </div>
    </div>
  )
}
