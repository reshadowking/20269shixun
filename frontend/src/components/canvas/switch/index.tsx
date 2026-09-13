import type { ExportElement } from '@/components/canvas/types'
import { resolveColor, styleToCss } from '@/design/styleToCss'
import { DISABLED_STYLE } from '@/components/canvas/styleTokens'
import type { DesignNode } from '@/design/types'

/**
 * T9 方案②：switch（开关）——选中态写在 props.checked（不引组件内部 useState）。
 * CanvasSelect 的既有教训：内部 useState 让选中值不进树 → 撤销/协作/保存/导出全丢；
 * 本组件点击切换走 onPropsChange → DesignCanvas 的 store.updateNode 写 props.checked，
 * 撤销、协作、保存、导出全部同步。属性面板的 checked 开关与画布点击共用同一字段。
 *
 * ⚠️ 版面锁定（§4.4）：锁定态下 updateNode 的数据层守卫拒绝任何 props 变更——点击开关
 * 不生效属预期（锁定 = 冻结文案与布局），且会触发 subscribeBlocked 的可见提示，不静默。
 */

/** 轨道/滑块几何（画布与导出同源常量，parity 断言取值） */
const TRACK_W = 40
const TRACK_H = 22
const KNOB = 18
const PAD = 2

/** ① 画布渲染：轨道 + 滑块；checked → 主色底滑块右移，未选中 → border 令牌底滑块左移。 */
export function CanvasSwitch({ props, style, onPropsChange }: { props: Record<string, unknown>; style?: React.CSSProperties; onPropsChange?: (key: string, value: unknown) => void }) {
  const checked = Boolean(props.checked)
  const disabled = Boolean(props.disabled)
  const label = typeof props.label === 'string' ? props.label : ''
  return (
    <div className="flex items-center gap-2" style={style as object} data-testid="canvas-switch">
      <div
        role="switch"
        aria-checked={checked}
        data-testid="canvas-switch-track"
        className="relative shrink-0"
        // stopPropagation：切换是组件内交互，不冒泡成画布拖拽/选中（与 select 同口径）
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          if (!disabled) onPropsChange?.('checked', !checked)
        }}
        style={{
          width: TRACK_W,
          height: TRACK_H,
          borderRadius: TRACK_H / 2,
          background: checked ? resolveColor('primary') : resolveColor('border'),
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'background 0.2s',
          // disabled 为静态状态走内联（jsdom 可测、导出同步）；点击禁用是交互态，同函数内短路
          ...(disabled ? DISABLED_STYLE : {}),
        }}
      >
        <span
          className="absolute rounded-full"
          style={{
            top: PAD,
            left: checked ? TRACK_W - KNOB - PAD : PAD,
            width: KNOB,
            height: KNOB,
            background: '#FFFFFF',
            transition: 'left 0.2s',
          }}
        />
      </div>
      {label && <span style={{ color: resolveColor('text-primary'), fontSize: 14 }}>{label}</span>}
    </div>
  )
}

/** ② props 类型（checked 为本轮唯一新增字段：schema + lib + PROPS_BOOL_FIELDS 三处同步） */
export interface SwitchProps {
  label?: string
  checked?: boolean
  disabled?: boolean
}

/** ③ 导出语义描述：按 checked 渲染对应【静态形态】（选中/未选中都要能导出，属性面板
 * 改了 checked 产物跟着变）；「点击切换」这一交互不导出——与 button 的 hover 同口径。 */
export const buildSwitchExport = (node: DesignNode): ExportElement => {
  const props = node.props ?? {}
  const checked = Boolean(props.checked)
  const disabled = Boolean(props.disabled)
  const label = typeof props.label === 'string' ? props.label : ''
  return {
    tag: 'div',
    attrs: {},
    style: { display: 'flex', alignItems: 'center', gap: 8, ...styleToCss(node.style) },
    children: [
      {
        tag: 'span',
        attrs: { role: 'switch', 'aria-checked': checked ? 'true' : 'false' },
        style: {
          display: 'inline-block',
          position: 'relative',
          width: TRACK_W,
          height: TRACK_H,
          borderRadius: TRACK_H / 2,
          background: checked ? resolveColor('primary') : resolveColor('border'),
          ...(disabled ? DISABLED_STYLE : {}),
        },
        children: [
          {
            tag: 'span',
            attrs: {},
            style: { position: 'absolute', top: PAD, left: checked ? TRACK_W - KNOB - PAD : PAD, width: KNOB, height: KNOB, borderRadius: '50%', background: '#FFFFFF' },
          },
        ],
      },
      ...(label
        ? [{ tag: 'span', attrs: {}, style: { color: resolveColor('text-primary'), fontSize: 14 }, text: label }]
        : []),
    ],
  }
}

/** ④ 属性面板配置：与画布点击共用 props.checked（不得各存一份） */
export const switchSchema = [
  { key: 'label', label: '标签文本', control: 'text' as const },
  { key: 'checked', label: '开启', control: 'switch' as const },
  { key: 'disabled', label: '禁用', control: 'switch' as const },
]
