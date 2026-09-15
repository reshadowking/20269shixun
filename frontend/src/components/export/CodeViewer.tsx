/**
 * 代码查看器（导出对话框「代码产物展示」）。
 *
 * 设计约定：
 * - 不引入语法高亮依赖（项目铁律），用等宽字体 + 行号表达"这是代码产物"；
 * - 行号列 select-none，避免用户全选复制时把行号一起带走；
 * - 复制失败（非安全上下文 / 权限被拒）必须给出可见降级提示，不允许静默失败；
 * - 颜色全部走主题变量，保证暗色模式可用。
 */
import { useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'

import { Button } from '@/components/ui/button'

interface CodeViewerProps {
  filename: string
  code: string
  /** 展示高度类名（不同场景可覆盖） */
  className?: string
}

export default function CodeViewer({ filename, code, className }: CodeViewerProps) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')

  // 代码可能上千行：split 结果缓存，避免切 Tab / 重渲染时重复计算
  const lines = useMemo(() => code.split('\n'), [code])

  const handleCopy = async () => {
    setCopyError('')
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyError('复制失败：浏览器拒绝了剪贴板权限，请手动全选复制')
    }
  }

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-lg border bg-muted/30 ${className ?? ''}`}
      data-testid="code-viewer"
    >
      <div className="flex items-center justify-between border-b bg-muted/60 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-xs font-medium" data-testid="code-filename">
            {filename}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{lines.length} 行</span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 shrink-0 px-2 text-[11px]"
          data-testid="code-copy"
          onClick={() => void handleCopy()}
        >
          {copied ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
          {copied ? '已复制' : '复制代码'}
        </Button>
      </div>

      {copyError && (
        <p className="border-b bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700" data-testid="code-copy-error">
          {copyError}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <pre className="flex min-w-full text-[11px] leading-[1.65]">
          <code
            aria-hidden="true"
            className="select-none border-r bg-muted/40 px-2 py-2 text-right font-mono text-muted-foreground/60"
          >
            {lines.map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </code>
          <code className="block flex-1 whitespace-pre px-3 py-2 font-mono text-foreground" data-testid="code-body">
            {code}
          </code>
        </pre>
      </div>
    </div>
  )
}
