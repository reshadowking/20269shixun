/**
 * 转自由画布（P1-13）：像素级冻结。
 *
 * 目标语义：**保留当前视觉现状，只把子节点变成可拖拽**，而不是重新排布。
 *
 * 坐标系规则（易错点，改动前先读）：
 * - 节点 x/y 的原点 = 父级 **padding box** 左上角（= 父级 border box 内缩 border 宽度）；
 *   abspos 子元素不受父级 padding 影响，因此只减 border，不减 padding；
 * - style.width/height 是 **border box** 尺寸（NodeRenderer 设了 boxSizing: 'border-box'），
 *   与 getBoundingClientRect() 口径一致；
 * - 屏幕像素 → 画布单位必须 **除以 view.scale**（画布纸张带 translate+scale 变换）。
 */
import type { DesignNode } from '@/design/types'

export interface FreezeMeasurement {
  id: string
  /** 画布单位，相对父级 padding box */
  x: number
  y: number
  /** border box 尺寸（画布单位） */
  width: number
  height: number
}

export interface FreezeMeasureResult {
  measurements: FreezeMeasurement[]
  /** 测不到的节点（如 hidden 未渲染），调用方需提示而非静默 */
  missing: string[]
  /**
   * 容器**自己**的 border box 尺寸（画布单位）。
   *
   * 2026-09-17 修：只冻结子节点是不够的 —— 子节点改成绝对定位后**不再撑高父容器**，
   * 而模板/AI 产物的容器普遍没有显式 `height`（auto，靠内容撑），于是"转自由画布"会把
   * 容器塌成只剩 padding 的一条（E2E 实测 demo 根节点 276 → 64），背景/圆角跟着消失、
   * 子节点浮在容器外。调用方要把它一并写进容器的 style，才算"保留当前视觉现状"。
   */
  container?: { width: number; height: number }
}

/** `waitForLayoutStable` 的结果：settled=false 表示"等超时了，还有东西没落定"。 */
export interface LayoutStableReport {
  /**
   * true = 字体与容器内所有 `<img>` 都已落定（两帧 rAF 也已完成）。
   * **false 时调用方必须中止冻结**——此时测到的尺寸可能偏小，写进 style 就是"排版错乱"。
   */
  settled: boolean
  /** 超时那一刻仍未落定的 `<img>` 数量（未 decode 完的图会把高度测小） */
  pendingImages: number
  /** 超时那一刻 web font 仍未就绪；环境没有 FontFaceSet（如 jsdom）时为 false */
  fontsPending: boolean
}

/**
 * 等版面稳定再测量（2026-09-17）。
 *
 * 背景：验收反馈"转自由画布有时排版错乱"。头号嫌疑是**测量时机太早**——
 * 生成/打开后立刻测，此时 web font 还没加载完、`<img>` 还没解码，
 * 测到的高度偏小；冻结把它写进 `style.height` 后，图片/文字按真实尺寸渲染 → 错位。
 *
 * 做法：等 `document.fonts.ready` + 容器内未完成的 `<img>` 落定（load 或 error）+ 两帧 rAF。
 * **带超时兜底**（默认 1200ms）：任何一项卡住也不会让「转自由画布」永远转圈。
 *
 * ⚠️ 超时 ≠ 可以照旧测量（2026-09-17 二次修）：超时那一刻没落定的图片/字体，
 * 测出来的高度就是偏小的，照旧冻结正是"偶发错乱"的第二条路径。
 * 因此本函数返回 `settled`，调用方在 false 时应当**中止**（手动按钮→给可读提示；
 * 自动冻结→静默跳过，保留 flex），而不是拿可能过期的尺寸落库。
 * 纯函数式依赖注入（el / 全局对象都可传），便于单测。
 */
export async function waitForLayoutStable(el: HTMLElement | null, timeoutMs = 1200): Promise<LayoutStableReport> {
  const fonts = (globalThis.document as Document | undefined)?.fonts
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
  const fontsReady = (async () => {
    if (fonts?.ready) await fonts.ready
  })().catch(() => undefined)
  const imagesReady = el
    ? Promise.all(
        Array.from(el.querySelectorAll('img'))
          .filter((img) => !img.complete)
          .map(
            (img) =>
              new Promise<void>((resolve) => {
                img.addEventListener('load', () => resolve(), { once: true })
                img.addEventListener('error', () => resolve(), { once: true })
              }),
          ),
      )
    : Promise.resolve()
  const twoFrames = new Promise<void>((resolve) => {
    const raf = globalThis.requestAnimationFrame
    if (typeof raf !== 'function') {
      resolve()
      return
    }
    raf(() => raf(() => resolve()))
  })
  let timedOut = false
  await Promise.race([
    Promise.all([fontsReady, imagesReady, twoFrames]).then(() => undefined),
    timeout.then(() => {
      timedOut = true
    }),
  ])
  // 用**当下**的真实状态回答"到底还有谁没落定"，而不是靠记账推测：
  // 超时那一刻刚好加载完的图片不该被算成"没落定"（避免无谓地取消冻结）。
  const pendingImages = el ? Array.from(el.querySelectorAll('img')).filter((img) => !img.complete).length : 0
  const fontsPending = !!fonts && fonts.status !== 'loaded'
  return {
    settled: !timedOut || (pendingImages === 0 && !fontsPending),
    pendingImages,
    fontsPending,
  }
}

/**
 * 读取容器内直接子节点的冻结坐标（画布单位）。
 *
 * @param container 画布容器（含 data-testid="canvas-sheet" 的祖先即可）
 * @param parentId  父节点 id（其元素带 data-node-id）
 * @param childIds  待冻结的直接子节点 id
 * @param scale     当前画布缩放（DesignCanvas 的 view.scale）
 */
export function measureChildren(
  container: HTMLElement,
  parentId: string,
  childIds: string[],
  scale: number,
): FreezeMeasureResult {
  const safeScale = scale > 0 ? scale : 1
  const parentEl = container.querySelector<HTMLElement>(`[data-node-id="${parentId}"]`)
  if (!parentEl) return { measurements: [], missing: [...childIds] }

  const parentRect = parentEl.getBoundingClientRect()
  const computed = getComputedStyle(parentEl)
  // 包含块原点 = border box 内缩 border 宽度（padding 不影响 abspos 子元素）
  const originX = Number.parseFloat(computed.borderLeftWidth) || 0
  const originY = Number.parseFloat(computed.borderTopWidth) || 0

  const measurements: FreezeMeasurement[] = []
  const missing: string[] = []
  const containerSize = {
    width: Math.ceil(parentRect.width / safeScale),
    height: Math.round(parentRect.height / safeScale),
  }

  for (const id of childIds) {
    const el = container.querySelector<HTMLElement>(`[data-node-id="${id}"]`)
    if (!el) {
      missing.push(id)
      continue
    }
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      missing.push(id)
      continue
    }
    measurements.push({
      id,
      x: (rect.left - parentRect.left) / safeScale - originX,
      y: (rect.top - parentRect.top) / safeScale - originY,
      // 宽度向上取整：文本节点靠宽度断行，向下取整可能触发额外换行
      width: Math.ceil(rect.width / safeScale),
      height: Math.round(rect.height / safeScale),
    })
  }

  return { measurements, missing, container: containerSize }
}

/**
 * 把测量结果冻结进子节点（纯函数，便于单测）。
 *
 * - 测到的节点：写入 x/y 与 style.width/height（覆盖百分比/自适应尺寸——这正是"冻结"的含义）
 * - 测不到的节点：原样返回，由调用方决定提示方式
 */
export function freezeToFreeLayout(
  children: DesignNode[],
  measurements: FreezeMeasurement[],
): DesignNode[] {
  const byId = new Map(measurements.map((m) => [m.id, m]))
  return children.map((child) => {
    const m = byId.get(child.id)
    if (!m) return child
    return {
      ...child,
      x: Math.round(m.x),
      y: Math.round(m.y),
      // 宽度向上取整（防文本重新换行）；高度四舍五入。此处再归一一次，
      // 保证无论测量来源如何，落库数值都是整数。
      style: { ...(child.style ?? {}), width: Math.ceil(m.width), height: Math.round(m.height) },
    }
  })
}
