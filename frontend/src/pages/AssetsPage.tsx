/**
 * T36：「资产库」占位页（真实实现见 T38：owner 隔离 + 类型/大小/配额 + 插入画布）。
 * 现在只把入口与边界写清楚，避免用户点进来是空白。
 */
import { useNavigate } from 'react-router-dom'

export default function AssetsPage() {
  const navigate = useNavigate()
  return (
    <div className="mx-auto max-w-[1080px] px-8 py-8" data-testid="assets-page">
      <h1 className="text-lg font-semibold">资产库</h1>
      <div className="mt-4 rounded-xl border border-dashed border-border p-8 text-sm text-muted-foreground">
        <p className="mb-2">当前阶段：图片上传已可用（画布选中「图片」组件 → 属性面板上传），资产库正在建设中。</p>
        <p className="mb-4 text-xs">
          建成后支持：按用户隔离的素材存储（png/jpg/webp，单文件 ≤2MB）、一键插入画布、用量配额与删除引用检查。
        </p>
        <button
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
          data-testid="assets-go-workspace"
          onClick={() => navigate('/workspace')}
        >
          去画布上传图片 →
        </button>
      </div>
    </div>
  )
}
