/**
 * 右侧面板宽度：夹紧与持久化（T49）。
 *
 * 重点在**窄屏**：`clamp(w, min, max)` 在 `max < min` 时区间反了，结果不可预期。
 * 所以上界先与下界取大 —— 任何视口宽度下区间都非空。
 *
 * 存储走注入的内存后端（`__setStorageForTests`），不直接摸 `window.localStorage`：
 * 全局 setup 每个用例前会换一份全新的内存存储。
 */
import { describe, expect, it } from 'vitest'

import {
  PANEL_WIDTH_DEFAULT,
  PANEL_WIDTH_KEY,
  PANEL_WIDTH_MAX,
  PANEL_WIDTH_MIN,
  clampPanelWidth,
  readPanelWidth,
  writePanelWidth,
} from './panelWidth'
import { __setStorageForTests, createMemoryStorage, readStorage } from './storage'

/** 造一个"存量值"场景（模拟上一次拖拽留下的宽度，可能是脏值） */
function seedStoredWidth(raw: string): void {
  __setStorageForTests(createMemoryStorage({ [PANEL_WIDTH_KEY]: raw }))
}

describe('clampPanelWidth', () => {
  it('常规视口：按 min/max 夹紧', () => {
    expect(clampPanelWidth(400, 1440)).toBe(400)
    expect(clampPanelWidth(100, 1440)).toBe(PANEL_WIDTH_MIN)
    expect(clampPanelWidth(9999, 1440)).toBe(PANEL_WIDTH_MAX)
  })

  it('窄屏：60vw 小于下界时上界退化为下界，**不出反区间**', () => {
    // 400 * 0.6 = 240 < 260 → upper = max(260, min(720, 240)) = 260
    expect(clampPanelWidth(320, 400)).toBe(PANEL_WIDTH_MIN)
    expect(clampPanelWidth(9999, 400)).toBe(PANEL_WIDTH_MIN)
    expect(clampPanelWidth(100, 400)).toBe(PANEL_WIDTH_MIN)
  })

  it('极窄屏（比下界还窄）也不返回小于下界的值', () => {
    expect(clampPanelWidth(300, 200)).toBe(PANEL_WIDTH_MIN)
  })

  it('视口取 60% 作上界', () => {
    expect(clampPanelWidth(9999, 1000)).toBe(600)
    expect(clampPanelWidth(9999, 800)).toBe(480)
  })

  it('脏值（NaN / 视口缺失）回落到默认值而不是 NaN', () => {
    expect(clampPanelWidth(Number.NaN, 1440)).toBe(PANEL_WIDTH_DEFAULT)
    expect(clampPanelWidth(320, Number.NaN)).toBe(PANEL_WIDTH_DEFAULT)
  })

  it('取整（拖拽产生的浮点宽度不该进 state）', () => {
    expect(clampPanelWidth(411.6, 1440)).toBe(412)
  })
})

describe('readPanelWidth / writePanelWidth', () => {
  it('写入后能读回', () => {
    writePanelWidth(420)
    expect(readStorage(PANEL_WIDTH_KEY)).toBe('420')
    expect(readPanelWidth(1440)).toBe(420)
  })

  it('缺省时回落默认值', () => {
    expect(readPanelWidth(1440)).toBe(PANEL_WIDTH_DEFAULT)
  })

  it('存量脏值（非数字 / 空串 / 负数 / NaN 字面量）都回落合法值', () => {
    for (const dirty of ['abc', '', '   ', '-100', 'NaN']) {
      seedStoredWidth(dirty)
      const got = readPanelWidth(1440)
      expect(got).toBeGreaterThanOrEqual(PANEL_WIDTH_MIN)
      expect(got).toBeLessThanOrEqual(PANEL_WIDTH_MAX)
    }
  })

  it('存量越界值被夹回区间', () => {
    seedStoredWidth('5000')
    expect(readPanelWidth(1440)).toBe(PANEL_WIDTH_MAX)
    seedStoredWidth('10')
    expect(readPanelWidth(1440)).toBe(PANEL_WIDTH_MIN)
  })

  it('存量宽度在窄屏下也被重新夹紧（不会把画布压没）', () => {
    seedStoredWidth('700')
    expect(readPanelWidth(800)).toBe(480) // 800 * 0.6
  })
})
