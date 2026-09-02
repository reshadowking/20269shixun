/**
 * 增量修改意图检测（P0-1）：判断用户指令是"修改现有设计"还是"新设计"。
 * 修改类指令（把/将/改成/调/变等）→ 走增量编辑（携带当前画布树，只改指定部分）。
 */
const NEW_DESIGN_PREFIX = /^(设计|做|生成|创建|帮我设计|帮我做|帮我生成|自由生成|做一个|来个|来一个|重新设计)/
const EDIT_VERBS = /把|将|改成|变为|换成|调|改|加|减|放大|缩小|删除|移动|变大|变小|颜色|间距|圆角|变/

export function isEditIntent(prompt: string): boolean {
  const p = prompt.trim()
  if (NEW_DESIGN_PREFIX.test(p)) return false
  return EDIT_VERBS.test(p)
}
