/**
 * 增量修改意图检测（P0-1）：判断用户指令是"修改现有设计"还是"新设计"。
 * 修改类指令（把/将/改成/调/变等）→ 走增量编辑（携带当前画布树，只改指定部分）。
 */
const NEW_DESIGN_PREFIX =
  /^(设计|做|生成|创建|制作|新建|新做|重新设计|重新做|重新制作|帮我设计|帮我做|帮我生成|帮我制作|自由生成|做一个|做个|来个|来一个|再来一个|换一个页面)/
const EDIT_VERBS = /把|将|改成|变为|换成|调|改|加|减|放大|缩小|删除|移动|变大|变小|颜色|间距|圆角|变/
/** T28：整页级需求的信号词（配合长度阈值判断"这其实是要重做一个页面"） */
const FULL_PAGE_HINTS = /页面|整页|整个界面|顶部|底部|右下角|左下角|悬浮|滚动|响应式|导航栏/
const FULL_PAGE_MIN_CHARS = 200

/**
 * T24：显式"新设计"意图。
 *
 * 有设计稿时只有这类输入才走"重新生成"（否则"太丑了""再来一版"这种对话式延续会被守卫拦下
 * 或误判为新需求）；无设计稿时的角色守卫判定不变（见 designGuard.isDesignRequest）。
 */
export function isNewDesignIntent(prompt: string): boolean {
  return NEW_DESIGN_PREFIX.test(prompt.trim())
}

export function isEditIntent(prompt: string): boolean {
  const p = prompt.trim()
  if (isNewDesignIntent(p)) return false
  return EDIT_VERBS.test(p)
}

/**
 * T28：这段需求看起来是"重做一个页面"吗？
 *
 * 用于"有设计稿 + 非显式新设计前缀"的场景：长文且提到整页要素时先确认是重做还是继续改——
 * 否则整页需求会被当增量，模型用一条超大 insert 变相整树重写（实测两次 JSON 语法崩在同一处）。
 */
export function isFullPageRequest(prompt: string): boolean {
  const p = prompt.trim()
  return p.length >= FULL_PAGE_MIN_CHARS && FULL_PAGE_HINTS.test(p)
}
