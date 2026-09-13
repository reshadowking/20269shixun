import { useState } from 'react'

import type { ExportElement } from '@/components/canvas/types'
import { escapeHtml } from '@/design/escape'
import { styleToCss } from '@/design/styleToCss'
import { CONTROL_DEFAULT_STYLE, INPUT_LABEL_COLOR } from '@/components/canvas/styleTokens'
import type { DesignNode } from '@/design/types'

/** ① 画布渲染：下拉选择（缺陷 14 已修复——可交互：点击展开选项、选中更新显示；阻断冒泡不影响画布拖拽） */
export function CanvasSelect({ props, style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  const label = typeof props.label === 'string' ? props.label : ''
  const placeholder = typeof props.placeholder === 'string' ? props.placeholder : '请选择'
  const options = Array.isArray(props.options) ? props.options.map((o) => String(o)) : []
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <div
      className="flex flex-col gap-1.5"
      style={style as object}
      data-testid="canvas-select"
      onPointerDown={(e) => e.stopPropagation()} // 阻断画布拖拽/选中冒泡
      onClick={(e) => e.stopPropagation()}
    >
      {label && <label className="text-sm font-medium" style={{ color: INPUT_LABEL_COLOR }}>{label}</label>}
      <div className="relative">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring"
          style={{ ...CONTROL_DEFAULT_STYLE, color: selected ? 'var(--foreground)' : undefined }}
          data-testid="canvas-select-trigger"
          onClick={() => setOpen((v) => !v)}
        >
          <span className={selected ? '' : 'text-muted-foreground'}>{selected ?? placeholder}</span>
          <span className={`text-xs opacity-60 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
        </button>
        {open && (
          <div
            className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border border-input bg-background py-1 shadow-lg"
            data-testid="canvas-select-list"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {options.length === 0 && <div className="px-3 py-1.5 text-xs text-muted-foreground">暂无选项</div>}
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-accent ${selected === opt ? 'bg-accent/60 font-medium' : ''}`}
                data-testid={`canvas-select-option-${opt}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setSelected(opt)
                  setOpen(false)
                }}
              >
                {escapeHtml(opt)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** ② props 类型 */
export interface SelectProps {
  label?: string
  placeholder?: string
  options?: string[]
}

/** ③ 导出模板 */
// 已废弃（B5，B1-2 全量迁移后）：导出统一走下方 buildExport（React/HTML 引擎消费）；本字符串模板函数不再被注册表引用，待二期删除。
export const exportSelectTemplate = (props: Record<string, unknown>): string => {
  const label = typeof props.label === 'string' ? props.label : ''
  const placeholder = escapeHtml(typeof props.placeholder === 'string' ? props.placeholder : '请选择')
  const options = Array.isArray(props.options) ? (props.options as string[]) : []
  return `        <div className="flex flex-col gap-1.5">
${label ? `          <label className="text-sm font-medium">${escapeHtml(label)}</label>` : ''}
          <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="">${placeholder}</option>
${options.map((o) => `            <option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('\n')}
          </select>
        </div>`
}

/** ④ 属性面板配置 */
export const selectSchema = [
  { key: 'label', label: '标签文本', control: 'text' as const },
  { key: 'placeholder', label: '占位符', control: 'text' as const },
  { key: 'options', label: '选项（逗号分隔）', control: 'text' as const },
]

/** B1：导出语义描述——select 为根（标记直接上移），options 为 option children（双通道同构） */
export const buildSelectExport = (node: DesignNode): ExportElement => {
  const props = node.props ?? {}
  const options = Array.isArray(props.options) ? props.options.map((o) => String(o)) : []
  // 默认观感与 input 同口径（CONTROL_DEFAULT_STYLE）；展开/选中态是画布交互，
  // 导出为原生 <select> 由浏览器接管下拉交互——有意为之。
  return {
    tag: 'select',
    attrs: {},
    style: { ...CONTROL_DEFAULT_STYLE, ...styleToCss(node.style) },
    children: options.map((o) => ({ tag: 'option', attrs: {}, style: {}, text: o })),
  }
}
