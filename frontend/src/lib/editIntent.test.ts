/**
 * 增量修改意图检测测试（P0-1）。
 */
import { describe, expect, it } from 'vitest'

import { isEditIntent, isFullPageRequest, isNewDesignIntent } from './editIntent'

describe('T28 新设计前缀与整页需求识别', () => {
  it('「制作/新建/换一个页面」等说法算新设计（此前会走增量，导致整页塞进 ops）', () => {
    expect(isNewDesignIntent('制作一个深色主题的任务清单应用')).toBe(true)
    expect(isNewDesignIntent('新建一个登录页')).toBe(true)
    expect(isNewDesignIntent('换一个页面风格')).toBe(true)
  })

  it('长文 + 整页要素 → 判为整页需求（用来先确认重做还是继续改）', () => {
    const longPage = `制作一个深色主题的网页任务清单应用。${'页面顶部放置大标题，输入框在下方。'.repeat(12)}右下角固定悬浮一个圆形加号按钮，列表区域支持滚动。`
    expect(isFullPageRequest(longPage)).toBe(true)
    expect(isFullPageRequest('把按钮改成橙色')).toBe(false) // 短指令
    expect(isFullPageRequest('把标题字号调大一点，顺便把间距统一一下，整体更紧凑一些，别太松散'.repeat(6))).toBe(false) // 长但无整页要素
  })
})

describe('isNewDesignIntent（T24：有稿时区分"延续"与"重做"）', () => {
  it('显式新设计意图', () => {
    expect(isNewDesignIntent('设计一个登录页')).toBe(true)
    expect(isNewDesignIntent('重新设计一个仪表板')).toBe(true)
    expect(isNewDesignIntent('自由生成一个设置页')).toBe(true)
    expect(isNewDesignIntent('  做一个电商优惠券页  ')).toBe(true)
  })

  it('对话式延续不算新设计（否则会被守卫拦下或误判为重做）', () => {
    expect(isNewDesignIntent('太丑了')).toBe(false)
    expect(isNewDesignIntent('再来一版')).toBe(false)
    expect(isNewDesignIntent('把按钮改红')).toBe(false)
    expect(isNewDesignIntent('不行，重来')).toBe(false)
  })
})

describe('isEditIntent', () => {
  it('修改类指令判定为增量编辑', () => {
    expect(isEditIntent('把购买按钮改成红色')).toBe(true)
    expect(isEditIntent('将标题居中')).toBe(true)
    expect(isEditIntent('按钮调大一点')).toBe(true)
    expect(isEditIntent('把间距改小')).toBe(true)
    expect(isEditIntent('删除那个图片')).toBe(true)
    expect(isEditIntent('颜色换成蓝色')).toBe(true)
    expect(isEditIntent('圆角再大一点')).toBe(true)
  })

  it('新设计类指令判定为全量生成', () => {
    expect(isEditIntent('设计一个登录页')).toBe(false)
    expect(isEditIntent('做一个电商优惠券页')).toBe(false)
    expect(isEditIntent('帮我设计一个仪表板')).toBe(false)
    expect(isEditIntent('自由生成一个设置页')).toBe(false)
    expect(isEditIntent('生成一个文章页')).toBe(false)
  })

  it('无动词的模糊指令默认全量生成', () => {
    expect(isEditIntent('登录页')).toBe(false)
    expect(isEditIntent('电商页面')).toBe(false)
  })
})
