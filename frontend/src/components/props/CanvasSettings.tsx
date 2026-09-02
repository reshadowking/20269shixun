import { useState } from 'react'

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
}

export default function CanvasSettings({ root, onUpdate }: CanvasSettingsProps) {
  const [widthInput, setWidthInput] = useState(String(typeof root.style?.width === 'number' ? root.style.width : 800))
  const [heightInput, setHeightInput] = useState(String(typeof root.style?.height === 'number' ? root.style.height : 600))

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
              onClick={() => applySize(p.width, p.height)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">最小尺寸 {MIN_SIZE}×{MIN_SIZE}px；修改实时生效并随设计稿保存。</p>
    </div>
  )
}
