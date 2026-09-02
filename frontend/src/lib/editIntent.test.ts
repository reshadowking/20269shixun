/**
 * 增量修改意图检测测试（P0-1）。
 */
import { describe, expect, it } from 'vitest'

import { isEditIntent } from './editIntent'

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
