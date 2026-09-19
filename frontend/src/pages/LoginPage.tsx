import { useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { login, getToken } from '@/lib/api'
import { safeInternalPath } from '@/lib/safeRedirect'

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [username, setUsername] = useState('demo')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (getToken()) {
    // 已登录：回到来源页（redirect）或主页
    return <Navigate to={safeInternalPath(searchParams.get('redirect'))} replace />
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password)
      navigate(safeInternalPath(searchParams.get('redirect')))
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-muted/40"
      data-testid="login-page"
    >
      {/* 背景装饰：两团低饱和光晕，给纯色的登录页加一点层次（不承载交互） */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-28 -right-16 h-80 w-80 rounded-full bg-secondary/10 blur-3xl" />
      </div>

      <Card className="relative w-full max-w-sm border-border/70 shadow-xl" data-testid="login-card">
        <CardHeader className="items-center text-center">
          <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary text-lg font-bold text-primary-foreground shadow-sm">
            A
          </span>
          <CardTitle className="text-xl">AI 原生设计工具</CardTitle>
          <CardDescription>自然语言 → 可编辑设计稿 → 一致化代码</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username">账号</Label>
              <Input
                id="username"
                data-testid="login-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="demo"
                autoComplete="username"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                data-testid="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="演示账号密码：demo123"
                autoComplete="current-password"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" data-testid="login-error">{error}</p>
            )}
            <Button type="submit" disabled={loading} className="mt-1" data-testid="login-submit">
              {loading ? '登录中…' : '登 录'}
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">
              没有账号？<Link className="text-primary hover:underline" data-testid="to-register" to="/register">注册一个</Link>
            </p>
            <p className="text-center text-[11px] text-muted-foreground">演示账号：demo / demo123</p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
