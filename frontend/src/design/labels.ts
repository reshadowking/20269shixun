/**
 * 属性值的中文展示映射（值本身保持英文/令牌名不变，只改显示）。
 * 例如 variant=primary 显示"主要"，令牌 primary 显示"主色"。
 */

export const OPTION_LABELS: Record<string, string> = {
  // 布局
  row: '行（横排）', column: '列（竖排）', grid: '网格', free: '自由',
  // 按钮/组件样式
  default: '默认', primary: '主要', secondary: '次要', outline: '描边',
  ghost: '幽灵', destructive: '危险', link: '链接',
  // 尺寸
  sm: '小', lg: '大',
  // 输入类型
  text: '文本', password: '密码', email: '邮箱', number: '数字',
  // 图表
  line: '折线图', bar: '柱状图', pie: '饼图',
  // 图片填充
  cover: '覆盖', contain: '包含', fill: '拉伸',
  // 标题级别
  '1': '一级标题', '2': '二级标题', '3': '三级标题',
  '4': '四级标题', '5': '五级标题', '6': '六级标题',
}

export const TOKEN_LABELS: Record<string, string> = {
  primary: '主色', secondary: '次色', danger: '危险色', success: '成功色',
  background: '背景色', 'text-primary': '主文字色', 'text-secondary': '次文字色',
  'text-light': '浅文字色', border: '边框色',
}

/** 取中文显示名；未知值原样返回 */
export function displayLabel(value: string): string {
  return OPTION_LABELS[value] ?? TOKEN_LABELS[value] ?? value
}
