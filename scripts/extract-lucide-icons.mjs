#!/usr/bin/env node
/**
 * T9 方案①：从 lucide-react 抽取图标几何数据，生成 shared/icon-library.json（单一来源）。
 *
 * 为什么有这个脚本：导出产物是零依赖 + 内联样式的，不能引 lucide-react 运行时，
 * 所以把 lucide 的【图标数据】（而非库）抽成共享 JSON——画布与导出各自内联 <svg>。
 * 图标数据属派生数据：升级 lucide-react 版本后重跑本脚本即可再生成（path 禁止手编）。
 *
 * 用法：node scripts/extract-lucide-icons.mjs
 * 前置：frontend/node_modules/lucide-react 已安装（图标数据来自
 *       dist/esm/icons/<file>.mjs 的 __iconNode 数组；lucide-react v1.38.0，ISC 许可）。
 *
 * 转换规则（几何等价）：lucide 图标元素统一转为单一 path d（多子路径按顺序拼接）：
 *   path 原样；circle/rect/line/polyline/polygon → 圆弧/直线段路径。
 * 输出契约（backend/tests/test_icon_library.py + 前端 icon.test.tsx 护栏）：
 *   icons[].{name,label,path}，name 唯一，help-circle 同时作为未知 name 的兜底占位。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ICONS_DIR = resolve(ROOT, 'frontend/node_modules/lucide-react/dist/esm/icons')
const OUT = resolve(ROOT, 'shared/icon-library.json')

/** [白名单 name, lucide 图标文件名, 中文 label]——name 是 icon 组件 props.name 的取值用名 */
const ICONS = [
  ['star', 'star', '星标'],
  ['heart', 'heart', '喜欢'],
  ['check', 'check', '勾选'],
  ['search', 'search', '搜索'],
  ['user', 'user', '用户'],
  ['home', 'home', '首页'],
  ['settings', 'settings', '设置'],
  ['bell', 'bell', '通知铃'],
  ['mail', 'mail', '邮件'],
  ['phone', 'phone', '电话'],
  ['calendar', 'calendar', '日历'],
  ['clock', 'clock', '时钟'],
  ['download', 'download', '下载'],
  ['upload', 'upload', '上传'],
  ['edit', 'edit', '编辑'],
  ['trash', 'trash', '删除'],
  ['plus', 'plus', '加号'],
  ['minus', 'minus', '减号'],
  ['chevron-right', 'chevron-right', '右展开'],
  ['arrow-right', 'arrow-right', '右箭头'],
  ['info', 'info', '信息'],
  ['alert', 'circle-alert', '警告'],
  ['lock', 'lock', '锁定'],
  ['globe', 'globe', '全球'],
  // 兜底占位：模型给了白名单外的 name 时渲染它（不计入"可用图标"语义之外的消费方）
  ['help-circle', 'help-circle', '帮助'],
]

const fmt = (n) => String(Number(Number(n).toFixed(4)))

/** circle → 两段圆弧的完整路径（顺时针），与 <circle> 几何等价 */
function circleToD({ cx, cy, r }) {
  const [x, y, rr] = [Number(cx), Number(cy), Number(r)]
  return (
    `M${fmt(x - rr)} ${fmt(y)}` +
    `a${fmt(rr)} ${fmt(rr)} 0 1 0 ${fmt(2 * rr)} 0` +
    `a${fmt(rr)} ${fmt(rr)} 0 1 0 ${fmt(-2 * rr)} 0`
  )
}

/** rect（含圆角 rx）→ 顺时针路径 */
function rectToD({ x, y, width, height, rx = 0 }) {
  const [X, Y, W, H, R] = [Number(x), Number(y), Number(width), Number(height), Number(rx)]
  if (!R) return `M${fmt(X)} ${fmt(Y)}h${fmt(W)}v${fmt(H)}h${fmt(-W)}z`
  return (
    `M${fmt(X + R)} ${fmt(Y)}` +
    `h${fmt(W - 2 * R)}` +
    `a${fmt(R)} ${fmt(R)} 0 0 1 ${fmt(R)} ${fmt(R)}` +
    `v${fmt(H - 2 * R)}` +
    `a${fmt(R)} ${fmt(R)} 0 0 1 ${fmt(-R)} ${fmt(R)}` +
    `h${fmt(-(W - 2 * R))}` +
    `a${fmt(R)} ${fmt(R)} 0 0 1 ${fmt(-R)} ${fmt(-R)}` +
    `v${fmt(-(H - 2 * R))}` +
    `a${fmt(R)} ${fmt(R)} 0 0 1 ${fmt(R)} ${fmt(-R)}` +
    'z'
  )
}

function pairsToD(points, close) {
  const nums = String(points).trim().split(/[\s,]+/).map(Number)
  if (nums.length % 2 !== 0 || nums.length < 4) throw new Error(`polyline/polygon 点数异常: ${points}`)
  let d = `M${fmt(nums[0])} ${fmt(nums[1])}`
  for (let i = 2; i < nums.length; i += 2) d += `L${fmt(nums[i])} ${fmt(nums[i + 1])}`
  return close ? `${d}z` : d
}

/** 单个 lucide 元素 → path d 片段；带未知属性（除 key）时报错，防止静默丢失视觉细节 */
function elementToD([tag, attrs]) {
  const { key: _key, ...rest } = attrs
  switch (tag) {
    case 'path': {
      if ('d' in rest && Object.keys(rest).length === 1) return rest.d
      break
    }
    case 'circle': {
      if (Object.keys(rest).length === 3) return circleToD(rest)
      break
    }
    case 'rect': {
      const { x, y, width, height, rx } = rest
      const extra = Object.keys(rest).filter((k) => !['x', 'y', 'width', 'height', 'rx', 'ry'].includes(k))
      if (extra.length === 0 && (rx === undefined || rx === rest.ry || rest.ry === undefined)) {
        return rectToD({ x, y, width, height, rx: rx ?? 0 })
      }
      break
    }
    case 'line': {
      const { x1, y1, x2, y2 } = rest
      if (Object.keys(rest).length === 4) return `M${fmt(x1)} ${fmt(y1)}L${fmt(x2)} ${fmt(y2)}`
      break
    }
    case 'polyline':
      if (Object.keys(rest).length === 1) return pairsToD(rest.points, false)
      break
    case 'polygon':
      if (Object.keys(rest).length === 1) return pairsToD(rest.points, true)
      break
    default:
      break
  }
  throw new Error(`未支持的图标元素 <${tag} attrs=${JSON.stringify(rest)}>（请扩充转换规则）`)
}

/** 从 .mjs 源码里切出 __iconNode 数组字面量并求值（纯数据，无代码执行面）；
 * 部分图标文件是别名（如 home.mjs 转发 house.mjs），跟随 re-export 链取真实数据。 */
function loadIconNode(file, depth = 0) {
  if (depth > 4) throw new Error(`re-export 链过深: ${file}`)
  const p = resolve(ICONS_DIR, `${file}.mjs`)
  if (!existsSync(p)) throw new Error(`图标文件不存在: ${file}`)
  const src = readFileSync(p, 'utf-8')
  // 数组字面量可能是单行或多行；d 串不含 "]"，非贪婪到首个 "];" 即数组结尾
  const m = src.match(/const __iconNode = (\[[\s\S]*?\]);/)
  if (m) return new Function(`return ${m[1]}`)()
  const alias = src.match(/export \{ default \} from '\.\/([\w-]+)\.mjs'/)
  if (alias) return loadIconNode(alias[1], depth + 1)
  throw new Error(`${file}.mjs: 未找到 __iconNode，也非别名转发`)
}

const icons = ICONS.map(([name, file, label]) => {
  const node = loadIconNode(file)
  const d = node.map(elementToD).join(' ')
  return { name, label, path: d }
})

const names = icons.map((i) => i.name)
if (new Set(names).size !== names.length) throw new Error('name 重复')
if (!names.includes('help-circle')) throw new Error('缺兜底占位 help-circle')

const doc = {
  _comment:
    '图标库单一来源（T9 方案①：lucide 图标数据内联——不引图标库运行时、不用 emoji）。' +
    '前端（画布渲染/导出/属性面板下拉选项）与后端（生成提示词注入/未知 name 校验日志）两端共读本文件，禁止在任一端手抄清单。' +
    '数据来源：lucide（lucide-react v1.38.0，ISC 许可，https://lucide.dev）——24×24 viewBox、stroke-width=2、round 线帽/拐角、fill=none 的线性图标；' +
    'circle/rect/line/polyline/polygon 已几何等价转换为单一 path d。' +
    '维护规则：新增/升级图标先在 scripts/extract-lucide-icons.mjs 的 ICONS 表加行（或升级 lucide-react 后整体重跑），' +
    '然后 node scripts/extract-lucide-icons.mjs 重新生成本文件；path 禁止手工编辑。' +
    'icons 中的 help-circle 同时作为未知 name 的兜底占位（画布与导出查不到名字时渲染它）。',
  icons,
}

writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n', 'utf-8')
console.log(`OK 写出 ${OUT}（${icons.length} 个图标）`)
