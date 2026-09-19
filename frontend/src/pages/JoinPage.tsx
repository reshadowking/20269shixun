/**
 * T46a-4：接受邀请页（`/join?token=…`）。
 *
 * 三种状态都要说清楚，不能让人对着空白页猜：
 *   加入成功（显示工作区名 + 我的角色）/ 链接无效或用过或过期（404）/ 缺少 token。
 * 邀请 token 一次性（后端 join 用过即失效，已是成员时幂等不降级）。
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'

type JoinResult = { workspace_id: number; name: string; role: string }

const ROLE_LABEL: Record<string, string> = {
  owner: '所有者',
  editor: '可编辑',
  viewer: '只读访客',
}

export default function JoinPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const [state, setState] = useState<'joining' | 'ok' | 'failed'>('joining')
  const [result, setResult] = useState<JoinResult | null>(null)
  const [error, setError] = useState('')
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return // StrictMode 双渲染：邀请是一次性的，绝不能打两次
    startedRef.current = true
    if (!token) {
      setState('failed')
      setError('邀请链接缺少 token，请向邀请你的人要一条完整链接。')
      return
    }
    api<JoinResult>('/api/workspaces/join', { method: 'POST', body: JSON.stringify({ token }) })
      .then((r) => {
        setResult(r)
        setState('ok')
      })
      .catch((err: unknown) => {
        const status = (err as { status?: number }).status
        setError(
          status === 404
            ? '邀请链接无效、已过期或已被使用（邀请是**一次性**的，请让管理员重新生成）。'
            : err instanceof Error
              ? err.message
              : '加入失败，请稍后重试。',
        )
        setState('failed')
      })
  }, [token])

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-muted/40 p-6"
      data-testid="join-page"
    >
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-lg">
            {state === 'ok' ? '已加入工作区' : state === 'failed' ? '未能加入' : '正在接受邀请…'}
          </CardTitle>
          <CardDescription>
            {state === 'ok'
              ? '对方的设计稿现在对你可见（权限按你的角色生效）。'
              : state === 'failed'
                ? '这条邀请没有生效。'
                : '正在校验邀请 token…'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {state === 'ok' && result && (
            <div className="rounded-md border bg-background p-3 text-sm" data-testid="join-result">
              <div className="font-medium">{result.name || `工作区 #${result.workspace_id}`}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                我的角色：{ROLE_LABEL[result.role] ?? result.role}
              </div>
            </div>
          )}
          {state === 'failed' && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" data-testid="join-error">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button data-testid="join-go-projects" onClick={() => navigate('/projects')}>
              去「我的项目」
            </Button>
            <Button variant="outline" data-testid="join-go-home" onClick={() => navigate('/')}>
              回首页
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
