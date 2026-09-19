import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { DesignNode } from '@/design/types'

/**
 * 画布尺寸设置（P4）：手动输入宽高 + 预设尺寸，实时作用于根节点 style。
 * 展示在属性面板的空态（未选中节点时）。
 */

const PRESETS: Array<{ label: string; width: number; height: number }> = [
  { label: '桌面 1440', width: 1440, height: 900 },
  { label: '平板 768', width: 768, height: 1024 },
  { label: '手机 375', width: 375, height: 667 },
  { label: '默认 800', width: 800, height: 600 },
]

const MIN_SIZE = 320

interface CanvasSettingsProps {
  root: DesignNode
  onUpdate: (updater: (n: DesignNode) => DesignNode) => void
  /** T46a-3e：只读访客——尺寸不可改（写入层也会拦，这里不给"看着能改"的假象） */
  readOnly?: boolean
}

export default function CanvasSettings({ root, onUpdate, readOnly = false }: CanvasSettingsProps) {
  const rootWidth = typeof root.style?.width === 'number' ? root.style.width : 800
  const rootHeight = typeof root.style?.height === 'number' ? root.style.height : 600
  const [widthInput, setWidthInput] = useState(String(rootWidth))
  const [heightInput, setHeightInput] = useState(String(rootHeight))

  /**
   * 验收发现的既有瑕疵：以前只在**挂载时**取一次 root 尺寸，而本组件会先于设计稿加载挂载
   * （此时 root 还是示例稿/空白稿，宽度是 720），于是输入框长期显示 720、画布却是 800×600。
   * 现在跟随根节点同步（外部改尺寸、撤销、AI 重生成都会反映到输入框）。
   */
  useEffect(() => {
    setWidthInput(String(rootWidth))
  }, [rootWidth])
  useEffect(() => {
    setHeightInput(String(rootHeight))
  }, [rootHeight])

  const applySize = (width: number, height: number) => {
    const w = Math.max(MIN_SIZE, Math.round(width))
    const h = Math.max(MIN_SIZE, Math.round(height))
    setWidthInput(String(w))
    setHeightInput(String(h))
    onUpdate((n) => ({ ...n, style: { ...(n.style ?? {}), width: w, height: h } }))
  }

  return (
    <div className="flex flex-col gap-3 p-4" data-testid="canvas-settings">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">画布设置</div>
      <div className="text-sm font-medium">画布尺寸</div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">宽度 (px)</Label>
          <Input
            data-testid="canvas-width"
            type="number"
            disabled={readOnly}
            min={MIN_SIZE}
            value={widthInput}
            onChange={(e) => {
              setWidthInput(e.target.value)
              const v = Number(e.target.value)
              if (!Number.isNaN(v) && v >= MIN_SIZE) applySize(v, Number(heightInput) || 600)
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">高度 (px)</Label>
          <Input
            data-testid="canvas-height"
            type="number"
            disabled={readOnly}
            min={MIN_SIZE}
            value={heightInput}
            onChange={(e) => {
              setHeightInput(e.target.value)
              const v = Number(e.target.value)
              if (!Number.isNaN(v) && v >= MIN_SIZE) applySize(Number(widthInput) || 800, v)
            }}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="text-xs text-muted-foreground">预设尺寸</div>
        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              data-testid={`canvas-preset-${p.width}`}
              disabled={readOnly}
              onClick={() => applySize(p.width, p.height)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>
      {readOnly && (
        <p className="text-[11px] text-amber-600" data-testid="canvas-settings-readonly">
          只读访客：画布尺寸不能修改（需要 owner / editor 权限）。
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">最小尺寸 {MIN_SIZE}×{MIN_SIZE}px；修改实时生效并随设计稿保存。</p>
    </div>
  )
}
