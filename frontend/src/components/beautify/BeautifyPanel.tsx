/**
 * 美化面板（缺陷 3）：版面确认 → 只追加样式白名单效果 → 可对比原始版面 / 临时关闭全部效果。
 * 写入统一走 POST /api/apply-effects（服务端白名单铁闸），前端不自行拼 CSS。
 * T4 批3：新增批量应用范围——「当前节点」（原路径不变）/「同类节点」/「选中多个」，
 * 执行前显示影响范围，changesSize 类效果批量应用前带范围数二次确认。
 */
import { useMemo, useState } from 'react'

import DesignThumbnail from '@/components/chat/DesignThumbnail'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { EFFECT_SPECS, countBeautifiedNodes, collectSameTypeNodes, effectValueLabel } from '@/design/beautify'
import { findNode } from '@/design/tree'
import type { DesignNode } from '@/design/types'
import type { BaseSnapshot } from '@/lib/baseSnapshot'

/** T4 批3：批量应用范围。single = 原单人路径（行为不变） */
type ApplyScope = 'single' | 'same-type' | 'multi'

interface BeautifyPanelProps {
  design: DesignNode
  selectedNode: DesignNode | null
  baseSnapshot: BaseSnapshot | null
  /** 版面已确认（写入层已锁定非样式改动） */
  locked: boolean
  applying: boolean
  error: string
  /** 画布是否处于「临时关闭全部高级效果」预览 */
  previewing: boolean
  /** T4 批3：画布多选集合（≥2 时提供「应用到选中多个」入口） */
  selectedIds?: Set<string>
  onConfirmLayout: () => void
  onUnlock: () => void
  onApplyEffect: (nodeId: string, key: string, value: string | number | null) => void
  /** T4 批3：批量应用回调（同类/多选共用；nodeIds 为已算好的目标集合，含影响范围语义） */
  onApplyEffectBatch?: (nodeIds: string[], key: string, value: string | number | null) => void
  onPreviewToggle: (on: boolean) => void
  /** T46a-3e：只读访客——效果/版面锁定全部不可写（只能看） */
  readOnly?: boolean
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function BeautifyPanel({
  design,
  selectedNode,
  baseSnapshot,
  locked,
  applying,
  error,
  previewing,
  selectedIds,
  onConfirmLayout,
  onUnlock,
  onApplyEffect,
  onApplyEffectBatch,
  onPreviewToggle,
  readOnly = false,
}: BeautifyPanelProps) {
  const [compareOpen, setCompareOpen] = useState(false)
  const [scopeChoice, setScopeChoice] = useState<ApplyScope>('single')
  const style = (selectedNode?.style ?? {}) as Record<string, unknown>
  const effectCount = countBeautifiedNodes(design)

  // T4 批3：批量目标集合（同类 = 同类型全部可见节点；多选 = 选中集合中存在的可见节点）
  const sameTypeNodes = useMemo(
    () => (selectedNode ? collectSameTypeNodes(design, selectedNode) : []),
    [design, selectedNode],
  )
  const multiNodes = useMemo(() => {
    const ids = [...(selectedIds ?? [])]
    if (ids.length < 2) return []
    return ids
      .map((id) => findNode(design, id))
      .filter((n): n is DesignNode => n !== null && !n.hidden)
  }, [design, selectedIds])

  const canSameType = Boolean(selectedNode) && sameTypeNodes.length >= 2
  const canMulti = multiNodes.length >= 2
  // 选项不可用（选区变了）时自动回落，不产生悬空范围；多选（无单选节点）时强制批量范围
  const scope: ApplyScope =
    scopeChoice === 'same-type' && canSameType
      ? 'same-type'
      : scopeChoice === 'multi' && canMulti
        ? 'multi'
        : selectedNode
          ? 'single'
          : canMulti
            ? 'multi'
            : 'single'
  const targetNodes = scope === 'same-type' ? sameTypeNodes : scope === 'multi' ? multiNodes : []

  /** 批量应用分发：changesSize 类效果带影响范围二次确认（与单人应用同口径） */
  const applyToTargets = (key: string, value: string | number | null) => {
    if (scope === 'single') {
      if (selectedNode) onApplyEffect(selectedNode.id, key, value)
      return
    }
    const ids = targetNodes.map((n) => n.id)
    if (ids.length === 0) return
    const spec = EFFECT_SPECS.find((s) => s.key === key)
    if (value !== null && spec?.changesSize && !window.confirm(`该效果可能改变组件尺寸，将应用到 ${ids.length} 个节点，是否确认？`)) {
      return
    }
    onApplyEffectBatch?.(ids, key, value)
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4" data-testid="beautify-panel">
      {readOnly && (
        <p className="rounded-md bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground" data-testid="beautify-readonly-note">
          只读访客：可以查看当前效果，但不能修改（需要 owner / editor 权限）。
        </p>
      )}
      {/* ① 版面确认（基础版快照） */}
      <div className="flex flex-col gap-2 rounded-md border bg-background p-3" data-testid="beautify-status">
        {/*
          2026-09-18 修：分支条件原本是 `baseSnapshot`，于是**解锁后快照还在、面板永远停在"已锁定"**
          ——用户实测反馈"点了确认版面之后变成解除绑定，再按几次都没变化"就是这个：
          服务端其实已经解锁，但面板显示的还是"版面已锁定 / 解除版面锁定"，点多少次都不变。
          现在按**真实的锁状态** `locked` 分支；快照只是"对比原始版面"的基线，解锁后继续保留。
        */}
        {locked ? (
          <>
            <div className="text-sm font-medium" data-testid="beautify-confirmed">
              {baseSnapshot ? `基础版已保留（${fmtTime(baseSnapshot.at)}）` : '版面已锁定'}
            </div>
            <div className="text-xs text-muted-foreground" data-testid="lock-state">
              版面已锁定：布局 / 模块顺序 / 文本 / 尺寸的改动会被写入层拒绝，只放行样式效果。
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              data-testid="beautify-unlock"
              disabled={readOnly}
              onClick={onUnlock}
            >
              解除版面锁定（继续编辑版面）
            </Button>
          </>
        ) : (
          <>
            <div className="text-sm font-medium">版面确认</div>
            <div className="text-xs text-muted-foreground">
              确认后自动保留「基础版快照」（无动效 / 渐变 / 装饰），后续美化不会改动它。
            </div>
            {baseSnapshot && (
              <div className="text-xs text-muted-foreground" data-testid="beautify-base-kept">
                上次基础版仍保留（{fmtTime(baseSnapshot.at)}）：随时可用「对比原始版面」回看。
              </div>
            )}
            <Button size="sm" className="h-7 text-xs" data-testid="beautify-confirm" disabled={readOnly} onClick={onConfirmLayout}>
              确认版面，进入美化
            </Button>
          </>
        )}
      </div>

      {/* ② 对比 / 临时关闭全部效果 */}
      <div className="flex flex-col gap-2 rounded-md border bg-background p-3">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          data-testid="beautify-compare"
          disabled={!baseSnapshot}
          onClick={() => setCompareOpen(true)}
        >
          对比原始版面
        </Button>
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm">临时关闭全部高级效果</div>
            <div className="text-xs text-muted-foreground">一键查看基础版外观，无需重新生成</div>
          </div>
          <Switch
            data-testid="beautify-preview-toggle"
            checked={previewing}
            disabled={!baseSnapshot}
            onCheckedChange={(v) => onPreviewToggle(Boolean(v))}
          />
        </div>
      </div>

      {/* ③ 效果白名单（需要选中一个节点，或多选 ≥2） */}
      {!selectedNode && !canMulti ? (
        <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground" data-testid="beautify-need-selection">
          先在画布上选中一个组件，再追加高级效果。
        </p>
      ) : (
        <div className="flex flex-col gap-3" data-testid="beautify-effects">
          <div className="text-xs text-muted-foreground">
            {selectedNode
              ? `目标：${selectedNode.componentType ?? selectedNode.type} · ${selectedNode.id.slice(0, 12)}`
              : `已选 ${multiNodes.length} 个节点`}
          </div>
          {(canSameType || canMulti) && (
            <div className="flex flex-wrap items-center gap-1" data-testid="beautify-batch-scope">
              <span className="text-[11px] text-muted-foreground">应用范围：</span>
              <button
                className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                  scope === 'single' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'
                }`}
                data-testid="beautify-scope-single"
                disabled={applying || readOnly}
                onClick={() => setScopeChoice('single')}
              >
                当前节点
              </button>
              {canSameType && (
                <button
                  className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                    scope === 'same-type' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'
                  }`}
                  data-testid="beautify-scope-same-type"
                  disabled={applying || readOnly}
                  onClick={() => setScopeChoice('same-type')}
                >
                  同类节点（{sameTypeNodes.length}）
                </button>
              )}
              {canMulti && (
                <button
                  className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                    scope === 'multi' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'
                  }`}
                  data-testid="beautify-scope-multi"
                  disabled={applying || readOnly}
                  onClick={() => setScopeChoice('multi')}
                >
                  选中多个（{multiNodes.length}）
                </button>
              )}
            </div>
          )}
          {scope !== 'single' && (
            <div className="rounded-md bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground" data-testid="beautify-batch-note">
              将应用到 {targetNodes.length} 个节点（隐藏节点已排除）；一次批量 = 一步撤销。
            </div>
          )}
          <div className="rounded-md bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground" data-testid="beautify-lock-note">
            {locked
              ? '版面已锁定：仅下列样式效果可写入（布局/文本/尺寸由写入层拒绝）'
              : '尚未确认版面：可先确认版面以锁定结构，或直接试效果'}
          </div>
          {EFFECT_SPECS.map((spec) => {
            const current = style[spec.key]
            return (
              <div key={spec.key} className="flex flex-col gap-1" data-testid={`beautify-group-${spec.key}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">
                    {spec.label}
                    {spec.changesSize && <span className="ml-1 text-[10px] text-amber-600">可能改变尺寸</span>}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    当前：{current === undefined ? '无' : effectValueLabel(spec.key, current)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {spec.values.map((v, i) => (
                    <button
                      key={v.label}
                      className={`rounded-full border px-2 py-0.5 text-[11px] transition hover:border-primary ${
                        current === v.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'
                      }`}
                      data-testid={`beautify-${spec.key}-${i}`}
                      disabled={applying || readOnly}
                      onClick={() => applyToTargets(spec.key, v.value)}
                    >
                      {v.label}
                    </button>
                  ))}
                  <button
                    className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition hover:border-destructive hover:text-destructive"
                    data-testid={`beautify-${spec.key}-off`}
                    disabled={applying || readOnly || current === undefined}
                    onClick={() => applyToTargets(spec.key, null)}
                  >
                    关闭
                  </button>
                </div>
              </div>
            )
          })}
          {applying && <p className="text-xs text-muted-foreground">应用中…</p>}
          {error && (
            <p className="text-xs text-destructive" data-testid="beautify-error">
              {error}
            </p>
          )}
        </div>
      )}

      {/* ④ 对比弹窗 */}
      {compareOpen && baseSnapshot && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          data-testid="beautify-compare-dialog"
          onClick={() => setCompareOpen(false)}
        >
          <div className="w-[560px] rounded-xl border bg-background p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold">对比原始版面</span>
              <button className="text-xs text-muted-foreground hover:text-foreground" data-testid="beautify-compare-close" onClick={() => setCompareOpen(false)}>
                ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="mb-1 text-muted-foreground">基础版（无高级效果）</div>
                <DesignThumbnail design={baseSnapshot.design} width={240} height={144} testId="beautify-thumb-base" />
              </div>
              <div>
                <div className="mb-1 text-muted-foreground">当前（{effectCount} 处效果）</div>
                <DesignThumbnail design={design} width={240} height={144} testId="beautify-thumb-current" />
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              基础版快照在版面确认时保存，后续任何美化操作都不会改动它；「临时关闭全部高级效果」即在画布上查看这份版本。
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
