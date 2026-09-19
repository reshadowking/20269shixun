/**
 * 「测量前等版面稳定」（2026-09-17）。
 *
 * 这组用例锁的是"转自由画布偶尔排版错乱"的头号机制：**测量太早**——
 * web font 未就绪 / `<img>` 未解码时测到的尺寸偏小，冻结写进 style 后就错位。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { waitForLayoutStable } from './freeze'

function makeImg(complete: boolean): HTMLImageElement {
  const img = document.createElement('img')
  Object.defineProperty(img, 'complete', { value: complete, configurable: true })
  return img
}

describe('waitForLayoutStable', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      setTimeout(() => cb(0), 0)
      return 0
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('容器里没有未完成的图片时：等两帧后即返回（不空等）', async () => {
    const box = document.createElement('div')
    box.append(makeImg(true))
    const done = waitForLayoutStable(box, 5000)
    await vi.advanceTimersByTimeAsync(10)
    await expect(done).resolves.toEqual({ settled: true, pendingImages: 0, fontsPending: false })
  })

  it('有未完成的图片：必须等它 load 才返回（这是错乱的关键一步）', async () => {
    const box = document.createElement('div')
    const pending = makeImg(false)
    box.append(pending)

    let finished = false
    const done = waitForLayoutStable(box, 5000).then(() => {
      finished = true
    })
    await vi.advanceTimersByTimeAsync(50)
    expect(finished, '图片没 load 就不该放行测量').toBe(false)

    pending.dispatchEvent(new Event('load'))
    await vi.advanceTimersByTimeAsync(10)
    await done
    expect(finished).toBe(true)
  })

  it('图片加载失败（error）也要放行——否则按钮永远转圈', async () => {
    const box = document.createElement('div')
    const broken = makeImg(false)
    box.append(broken)

    let finished = false
    const done = waitForLayoutStable(box, 5000).then(() => {
      finished = true
    })
    await vi.advanceTimersByTimeAsync(50)
    expect(finished).toBe(false)

    broken.dispatchEvent(new Event('error'))
    await vi.advanceTimersByTimeAsync(10)
    await done
    expect(finished).toBe(true)
  })

  it('超时兜底：图片永远不落定时也要返回（不能让按钮永久转圈），但必须标记 settled=false', async () => {
    const box = document.createElement('div')
    box.append(makeImg(false))

    let finished = false
    let report: Awaited<ReturnType<typeof waitForLayoutStable>> | null = null
    const done = waitForLayoutStable(box, 300).then((r) => {
      report = r
      finished = true
    })
    await vi.advanceTimersByTimeAsync(100)
    expect(finished).toBe(false)
    await vi.advanceTimersByTimeAsync(400)
    await done
    expect(finished, '卡住的图片不能把转自由画布永久挂住').toBe(true)
    // 2026-09-17 修：超时返回时必须告诉调用方"没落定"，调用方据此中止冻结，
    // 而不是拿偏小的尺寸照旧落库（那正是"偶发排版错乱"的第二条路径）。
    expect(report).toEqual({ settled: false, pendingImages: 1, fontsPending: false })
  })

  it('el 为 null（画布还没挂上）也不抛错', async () => {
    const done = waitForLayoutStable(null, 100)
    await vi.advanceTimersByTimeAsync(200)
    // 没有容器 = 没有可等的东西：按"已落定"处理（后续测量自己会报 missing）
    await expect(done).resolves.toEqual({ settled: true, pendingImages: 0, fontsPending: false })
  })

  it('超时收尾按"当下的真实状态"判定：刚好在超时前加载完的图片不算未落定（不误伤）', async () => {
    const box = document.createElement('div')
    const img = makeImg(false)
    box.append(img)
    const done = waitForLayoutStable(box, 50)
    // 超时前一刻图片完成 → 收尾时它已 complete，不该再按"没落定"处理
    Object.defineProperty(img, 'complete', { value: true, configurable: true })
    await vi.advanceTimersByTimeAsync(100)
    await expect(done).resolves.toEqual({ settled: true, pendingImages: 0, fontsPending: false })
  })
})
