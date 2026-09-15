import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import ApiConfigPage from '@/pages/ApiConfigPage'
import AssetsPage from '@/pages/AssetsPage'
import HomePage from '@/pages/HomePage'
import LoginPage from '@/pages/LoginPage'
import ProjectsPage from '@/pages/ProjectsPage'
import TemplatesPage from '@/pages/TemplatesPage'
import WorkspacePage from '@/pages/WorkspacePage'
import AppShell from '@/components/shell/AppShell'

import { api, getToken } from '@/lib/api'

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getToken()) {
    // 记录来源路径：登录后跳回（缺陷 5/8：主页/工作台/配置页各自可达）
    const redirect = `${window.location.pathname}${window.location.search}`
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />
  }
  return <>{children}</>
}

export default function App() {
  // P2-1：启动时校验一次凭证（token 存在但已失效 → 由 api() 的 401 处理清凭证并跳登录），
  // 消除"看着已登录、实际请求全 401"的中间态
  useEffect(() => {
    if (!getToken()) return
    api('/api/auth/me').catch(() => {
      /* 401 已由 handleUnauthorized 处理；其它错误（后端未启动）不阻塞使用 */
    })
  }, [])

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* T36：首页/模板库/资产库/我的项目/设置共用全局侧边栏；工作台不套（它自身三栏） */}
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell>
              <HomePage />
            </AppShell>
          </RequireAuth>
        }
      />
      <Route
        path="/templates"
        element={
          <RequireAuth>
            <AppShell>
              <TemplatesPage />
            </AppShell>
          </RequireAuth>
        }
      />
      <Route
        path="/assets"
        element={
          <RequireAuth>
            <AppShell>
              <AssetsPage />
            </AppShell>
          </RequireAuth>
        }
      />
      <Route
        path="/projects"
        element={
          <RequireAuth>
            <AppShell>
              <ProjectsPage />
            </AppShell>
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <AppShell>
              <ApiConfigPage />
            </AppShell>
          </RequireAuth>
        }
      />
      <Route path="/workspace" element={<RequireAuth><WorkspacePage /></RequireAuth>} />
      <Route path="/api-config" element={<RequireAuth><ApiConfigPage /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
