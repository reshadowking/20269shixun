import { Button } from '@/components/ui/button'
import { clearAuth } from '@/lib/api'

/** 设计列表页（阶段 4 实现完整功能） */
export default function DesignsPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-xl font-semibold">设计列表</h1>
      <p className="text-sm text-muted-foreground">设计稿列表与版本管理（阶段 4 接入）</p>
      <Button onClick={() => { clearAuth(); location.href = '/login' }}>退出登录</Button>
    </div>
  )
}
