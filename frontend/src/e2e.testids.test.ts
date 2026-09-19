/**
 * E2E 规格引用的 `data-testid` 必须在源码里真实存在（2026-09-17 补）。
 *
 * 背景：E2E 需要起 docker + 前后端才能跑，改个 testid 名字后往往要到演示前才发现
 * "有一条用例跑不通"。这条**静态**守门在单测阶段就抓住"规格引用了不存在的 testid"。
 *
 * 命中判定（尽量宽松，只抓真漂移）：
 * - 源码里的静态写法：`data-testid="x"`、`'data-testid': 'x'`、以及组件 prop `testId="x"`；
 * - **任意**含 `${}` 的反引号模板的前缀（如 `` `node-${id}` `` 覆盖 `node-coupon-1`）；
 * - 规格里含 `${}` 的动态引用跳过（那是用例自己拼的）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const E2E_DIR = 'e2e'
const SRC_DIR = 'src'

function walk(dir: string, filter: (name: string) => boolean): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, filter))
    else if (filter(entry.name)) out.push(full)
  }
  return out
}

function readAll(files: string[]): string {
  return files.map((f) => readFileSync(f, 'utf-8')).join('\n')
}

function collectUsedTestIds(specText: string): Set<string> {
  const used = new Set<string>()
  const patterns = [
    /getByTestId\(\s*['"]([^'"$]+)['"]/g, // getByTestId('x')
    /data-testid="([^"$]+)"/g, // [data-testid="x"] / 选择器
    /locator\(\s*['"]\[data-testid="([^"$]+)"\]/g,
  ]
  for (const re of patterns) {
    for (const m of specText.matchAll(re)) used.add(m[1])
  }
  return used
}

function collectKnownTestIds(srcText: string): { names: Set<string>; prefixes: Set<string> } {
  const names = new Set<string>()
  for (const re of [
    /data-testid="([^"$]+)"/g,
    /['"]data-testid['"]\s*:\s*['"]([^'"$]+)['"]/g, // 对象属性写法（NodeRenderer 用的是这个）
    /\btestId="([^"$]+)"/g, // 组件 prop 形式（SourceBadge / DesignThumbnail）
  ]) {
    for (const m of srcText.matchAll(re)) names.add(m[1])
  }
  const prefixes = new Set<string>()
  for (const m of srcText.matchAll(/`([^`]*)`/g)) {
    const literal = m[1]
    if (literal.includes('${')) prefixes.add(literal.split('${')[0])
  }
  return { names, prefixes }
}

describe('E2E 规格的 data-testid 与源码一致', () => {
  it('规格里引用的每个 testid 都能在源码找到（静态或模板前缀）', () => {
    const specFiles = walk(E2E_DIR, (name) => name.endsWith('.spec.ts'))
    expect(specFiles.length, '没找到 E2E 规格文件（cwd 应为 frontend/）').toBeGreaterThan(5)

    const srcFiles = walk(SRC_DIR, (name) => (name.endsWith('.ts') || name.endsWith('.tsx')) && !name.includes('.test.'))
    const used = collectUsedTestIds(readAll(specFiles))
    const { names, prefixes } = collectKnownTestIds(readAll(srcFiles))

    expect(used.size, '没能从规格里解析出 testid').toBeGreaterThan(50)
    const unresolved = [...used].filter(
      (id) => !names.has(id) && ![...prefixes].some((p) => p.length > 0 && id.startsWith(p)),
    )
    expect(unresolved, `以下 testid 在源码里找不到（改名了？）：${unresolved.join('、')}`).toEqual([])
  })
})
