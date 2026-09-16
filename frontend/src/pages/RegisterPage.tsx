/**
 * T46a-4：开放注册页（后端建用户 + **个人工作区**，直接返回 token，注册即登录）。
 *
 * 与登录页同构（同一套卡片/背景装饰），差别只有字段与文案——开放注册是权限模型的地基：
 * 没有第二个账号，就没法验证邀请 / 成员 / viewer 只读。
 */
import { useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getToken, register } from '@/lib/api'

export default function RegisterPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (getToken()) {
    const redirect = searchParams.get('redirect')
    return <Navigate to={redirect && redirect.startsWith('/') ? redirect : '/'} replace />
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    // 本地先拦一道（与后端口径一致）：省一次往返，也让提示更直白
    if (username.trim().length < 3) {
      setError('账号至少 3 个字符（只允许字母、数字、下划线、连字符）')
      return
    }
    if (password.length < 6) {
      setError('密码至少 6 位')
      return
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    setLoading(true)
    try {
      await register(username, password)
      const redirect = searchParams.get('redirect')
      navigate(redirect && redirect.startsWith('/') ? redirect : '/')
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-muted/40"
      data-testid="register-page"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-28 -right-16 h-80 w-80 rounded-full bg-secondary/10 blur-3xl" />
      </div>

      <Card className="relative w-full max-w-sm border-border/70 shadow-xl" data-testid="register-card">
        <CardHeader className="items-center text-center">
          <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary text-lg font-bold text-primary-foreground shadow-sm">
            A
          </span>
          <CardTitle className="text-xl">创建账号</CardTitle>
          <CardDescription>注册后自动获得一个个人工作区，可邀请他人协作</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username">账号</Label>
              <Input
                id="username"
                data-testid="register-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="字母 / 数字 / _ / -（3–64 位）"
                autoComplete="username"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                data-testid="register-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 6 位"
                autoComplete="new-password"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm">确认密码</Label>
              <Input
                id="confirm"
                data-testid="register-confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" data-testid="register-error">{error}</p>
            )}
            <Button type="submit" disabled={loading} className="mt-1" data-testid="register-submit">
              {loading ? '注册中…' : '注 册'}
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">
              已有账号？<Link className="text-primary hover:underline" data-testid="to-login" to="/login">去登录</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
