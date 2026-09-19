import { useRef, useState } from 'react'

import { componentRegistry } from '@/components/canvas/registry'
import type { PropField } from '@/components/canvas/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { displayLabel } from '@/design/labels'
import { DESIGN_TOKEN_NAMES, isCssColorKeyword } from '@/design/styleToCss'
import { isAllowedColor, nearestToken } from '@/design/tokens.generated'
import type { DesignNode } from '@/design/types'
import ComponentRecommend, { type RecommendItem } from '@/components/props/ComponentRecommend'

/** D2：本地图片上传控件（上传成功把 /api/images URL 写入字段） */
function ImageUploadControl({ value, onChange }: { value: string; onChange: (v: unknown) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const upload = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    setErr('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const token = localStorage.getItem('design-tool-token') ?? ''
      const resp = await fetch('/api/images', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      if (!resp.ok) throw new Error(`上传失败（${resp.status}）`)
      const data = (await resp.json()) as { url: string }
      onChange(data.url)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          data-testid="upload-image-btn"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? '上传中…' : '上传本地图片'}
        </Button>
        {value && (
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" data-testid="prop-src-value">
            {value}
          </span>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        data-testid="image-file-input"
        onChange={(e) => {
          void upload(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {err && <p className="text-[11px] text-destructive">{err}</p>}
    </div>
  )
}

/**
 * T9.1 #21：JSON 字段控件（items/links/columns/rows/data 等数组 props）。
 * 修复前用 textarea + `String(value)`：显示 `[object Object]`，手改后把字符串写回 props
 * （字符串进树后会被增量生成路径的 repair 删除）。本控件：
 * - 显示 JSON.stringify（树值变化——撤销/协作/切换选中——自动同步回文本）；
 * - 文本经 JSON.parse 校验成功且为数组才写回（非法/非数组不落树，显示可见错误提示）；
 * - 清空 → 写回空数组（当前全部 json 控件消费方均为数组字段，见各组件 schema）。
 * 类型写错的合法 JSON（如给数组字段写对象）由各组件容错渲染 + 后端 repair 兜底。
 */
function JsonControl({ fieldKey, value, onChange }: { fieldKey: string; value: unknown; onChange: (v: unknown) => void }) {
  const stringify = (v: unknown) => (v === undefined || v === null ? '' : JSON.stringify(v, null, 2))
  const [text, setText] = useState(() => stringify(value))
  const [error, setError] = useState('')
  const [lastValue, setLastValue] = useState(value)

  // 树值变化（撤销/协作/切换选中）→ 渲染期同步文本缓冲（React 官方 "adjusting state when
  // props change" 模式，避免 effect 级联渲染）；若文本与树值语义等价（刚由本控件写回），
  // 保持原文本不打断输入。
  if (value !== lastValue) {
    setLastValue(value)
    setText((current) => {
      if (current === stringify(value)) return current
      try {
        if (JSON.stringify(JSON.parse(current)) === JSON.stringify(value ?? null)) return current
      } catch {
        // 文本当前非法：外部值变化视为新真相，覆盖
      }
      return stringify(value)
    })
    setError('')
  }

  const handleChange = (next: string) => {
    setText(next)
    if (next.trim() === '') {
      setError('')
      onChange([])
      return
    }
    try {
      const parsed: unknown = JSON.parse(next)
      // T13 #25：当前全部 json 控件消费方均为数组字段（items/links/columns/rows/data）——
      // 非数组（对象/标量）不落树；将来出现对象字段时需为本控件增加类型参数
      if (!Array.isArray(parsed)) {
        setError('必须是 JSON 数组（如 [{"label":"标签一"}]）')
        return
      }
      onChange(parsed)
      setError('')
    } catch {
      setError('JSON 无效，未写入（其余字段不受影响）')
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Textarea
        data-testid={`prop-${fieldKey}`}
        className="min-h-16 font-mono text-xs"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
      />
      {error && (
        <p className="text-[11px] text-destructive" data-testid={`json-error-${fieldKey}`}>
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * 属性面板（v2.2 §3.5：文本/颜色/字号/间距/布局 + 组件 schema 控件）。
 * 修改通过 store.updateNode 走 Yjs transaction；
 * 手动改色给"建议令牌色"提醒但不强制（v2.2 §4.6）。
 * 容器/组件选中时顶部提供"✨推荐组件"（E3-3）。
 */
interface PropertyPanelProps {
  node: DesignNode
  onUpdate: (updater: (n: DesignNode) => DesignNode) => void
  onDelete: () => void
  /** 图层层级（v2.2 §3.5 编辑能力：节点可调层次，避免被覆盖） */
  onMoveLayer: (dir: 'top' | 'up' | 'down' | 'bottom') => void
  /** 容器切换到自由布局时初始化子节点位置（否则全部叠在原点） */
  onSwitchToFree?: () => void
  /** E3-3：当前设计树（推荐接口上下文）+ 推荐项落位回调 */
  design?: DesignNode
  onAddRecommend?: (targetId: string, item: RecommendItem) => void
  /** 缺陷 3：版面已确认（美化阶段）——只放行颜色/背景/圆角等样式类字段，布局/文本/尺寸锁定 */
  locked?: boolean
  /** T46a-3e：只读访客——属性面板整块只读（连 locked 允许的效果字段也不放行） */
  readOnly?: boolean
}

/** 锁定（版面已确认）阶段仍可编辑的样式字段：颜色、背景、圆角（样式类属性） */
const LOCKED_ALLOWED_STYLE_KEYS = ['color', 'background', 'radius']

const STYLE_FIELDS: PropField[] = [
  { key: 'layout', label: '布局', control: 'select', options: ['row', 'column', 'grid', 'free'] },
  { key: 'fontSize', label: '字号', control: 'number', min: 8, max: 96 },
  { key: 'fontWeight', label: '字重', control: 'select', options: ['400', '500', '600', '700', '800'] },
  { key: 'gap', label: '间距', control: 'number', min: 0, max: 100 },
  { key: 'width', label: '宽度', control: 'number', min: 8, max: 1200 },
  { key: 'radius', label: '圆角', control: 'number', min: 0, max: 64 },
  { key: 'color', label: '文字颜色', control: 'color' },
  { key: 'background', label: '背景颜色', control: 'color' },
  { key: 'backgroundImage', label: '背景图 URL', control: 'text' },
]

const THEME = 'default' as const

export default function PropertyPanel({ node, onUpdate, onDelete, onMoveLayer, onSwitchToFree, design, onAddRecommend, locked = false, readOnly = false }: PropertyPanelProps) {
  const def = node.componentType ? componentRegistry[node.componentType] : undefined

  const canRecommend = !readOnly && design && onAddRecommend && (node.type === 'frame' || node.type === 'group' || node.type === 'component')

  const setProp = (key: string, value: unknown) => {
    onUpdate((n) => ({ ...n, props: { ...(n.props ?? {}), [key]: value } }))
  }

  const setStyle = (key: string, value: unknown) => {
    if (key === 'layout' && value === 'free') {
      // 容器切到自由布局：先更新布局，再让上层初始化子节点位置
      onUpdate((n) => ({ ...n, style: { ...(n.style ?? {}), [key]: value } }))
      onSwitchToFree?.()
      return
    }
    onUpdate((n) => ({ ...n, style: { ...(n.style ?? {}), [key]: value } }))
  }

  const renderControl = (field: PropField, value: unknown, onChange: (v: unknown) => void) => {
    const stringVal = value === undefined || value === null ? '' : String(value)
    switch (field.control) {
      case 'text':
        return (
          <Input
            data-testid={`prop-${field.key}`}
            value={stringVal}
            onChange={(e) => onChange(e.target.value)}
          />
        )
      case 'textarea':
        return (
          <Textarea
            data-testid={`prop-${field.key}`}
            className="min-h-16 text-xs"
            value={stringVal}
            onChange={(e) => onChange(e.target.value)}
          />
        )
      case 'number':
        return (
          <Input
            data-testid={`prop-${field.key}`}
            type="number"
            min={field.min}
            max={field.max}
            value={stringVal}
            onChange={(e) => {
              // 2026-09-17 修：`Number('') === 0`，而输入框清空（全选删除准备重打）时
              // `e.target.value` 就是空串 → 旧实现把宽度/字号/间距直接写成 0（节点塌掉、
              // 文字消失）。空串视为"还没输完"，不落树；等用户输入数字再写。
              if (e.target.value.trim() === '') return
              const v = Number(e.target.value)
              if (!Number.isNaN(v)) onChange(v)
            }}
          />
        )
      case 'select':
        return (
          <select
            data-testid={`prop-${field.key}`}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={stringVal}
            onChange={(e) => onChange(e.target.value)}
          >
            {field.options?.map((o) => (
              <option key={o} value={o}>{displayLabel(o)}</option>
            ))}
          </select>
        )
      case 'switch':
        return (
          <Switch
            data-testid={`prop-${field.key}`}
            checked={Boolean(value)}
            onCheckedChange={onChange}
          />
        )
      case 'upload':
        return <ImageUploadControl value={stringVal} onChange={onChange} />
      case 'json':
        return <JsonControl fieldKey={field.key} value={value} onChange={onChange} />
      case 'color':
        return (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <input
                data-testid={`prop-${field.key}-picker`}
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(stringVal) ? stringVal : '#0052D9'}
                onChange={(e) => onChange(e.target.value)}
                className="h-8 w-10 cursor-pointer rounded border"
              />
              <Input
                data-testid={`prop-${field.key}`}
                className="h-8 text-xs"
                value={stringVal}
                placeholder="令牌名或 #hex"
                list={`token-names-${field.key}`}
                onChange={(e) => onChange(e.target.value)}
              />
              {/* T52 批2：令牌名自动补全——拼错的令牌名在 resolveColor 已显式失败，入口再给一层提示 */}
              <datalist id={`token-names-${field.key}`}>
                {DESIGN_TOKEN_NAMES.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            {/* 豁免 CSS 关键词：它们可渲染（resolveColor 放行），只是不属于规范令牌体系——
                不算拼错，不该弹"非令牌色"提示（提示管规范策略，resolveColor 管可渲染性） */}
            {stringVal && !isAllowedColor(THEME, stringVal) && !isCssColorKeyword(stringVal) && (
              <p className="text-[11px] text-amber-600" data-testid={`hint-${field.key}`}>
                非令牌色，建议使用「{displayLabel(nearestToken(THEME, stringVal))}」
              </p>
            )}
          </div>
        )
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4" data-testid="property-panel">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">属性</div>
      <div className="text-sm font-medium">
        {node.componentType ? `${def?.label ?? node.componentType} · ${node.id.slice(0, 12)}` : `${node.type} · ${node.id.slice(0, 12)}`}
      </div>

      {/* E3-3：容器/组件智能推荐（属性面板顶部） */}
      {canRecommend && (
        <ComponentRecommend
          design={design!}
          containerId={node.id}
          onAdd={(targetId, item) => onAddRecommend!(targetId, item)}
        />
      )}

      {/* 组件专属 props（锁定阶段属"文本内容"，禁用） */}
      {readOnly && (
        <p className="rounded-md bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground" data-testid="prop-readonly-note">
          只读访客：属性与图层不可修改（需要 owner / editor 权限）。
        </p>
      )}
      {!readOnly && locked && def && def.schema.length > 0 && (
        <p className="rounded-md bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground" data-testid="prop-locked-note">
          版面已确认：组件参数（文本内容）已锁定，仅颜色 / 背景 / 圆角等样式可改。
        </p>
      )}
      {!locked && !readOnly && def && def.schema.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="text-xs text-muted-foreground">组件参数</div>
          {def.schema.map((field) => (
            <div key={field.key} className="flex flex-col gap-1">
              <Label className="text-xs">{field.label}</Label>
              {renderControl(field, node.props?.[field.key], (v) => setProp(field.key, v))}
            </div>
          ))}
        </div>
      )}

      {/* 通用样式 */}
      {!readOnly && (
        <div className="flex flex-col gap-3">
          <div className="text-xs text-muted-foreground">样式（建议使用令牌色）</div>
          {(locked ? STYLE_FIELDS.filter((f) => LOCKED_ALLOWED_STYLE_KEYS.includes(f.key)) : STYLE_FIELDS).map((field) => (
            <div key={field.key} className="flex flex-col gap-1">
              <Label className="text-xs">{field.label}</Label>
              {renderControl(field, node.style?.[field.key], (v) => setStyle(field.key, v))}
            </div>
          ))}
        </div>
      )}

      {/* 图层层级（解决节点互相覆盖）：锁定阶段属"模块顺序"，禁用 */}
      <div className="flex flex-col gap-2">
        <div className="text-xs text-muted-foreground">图层层级</div>
        <div className="grid grid-cols-4 gap-1">
          <Button size="sm" variant="outline" className="h-7 px-1 text-xs" data-testid="layer-top" disabled={locked || readOnly} onClick={() => onMoveLayer('top')}>置顶</Button>
          <Button size="sm" variant="outline" className="h-7 px-1 text-xs" data-testid="layer-up" disabled={locked || readOnly} onClick={() => onMoveLayer('up')}>上移</Button>
          <Button size="sm" variant="outline" className="h-7 px-1 text-xs" data-testid="layer-down" disabled={locked || readOnly} onClick={() => onMoveLayer('down')}>下移</Button>
          <Button size="sm" variant="outline" className="h-7 px-1 text-xs" data-testid="layer-bottom" disabled={locked || readOnly} onClick={() => onMoveLayer('bottom')}>置底</Button>
        </div>
      </div>

      <Button variant="destructive" size="sm" data-testid="prop-delete" disabled={locked || readOnly} onClick={onDelete}>
        删除节点
      </Button>
    </div>
  )
}
