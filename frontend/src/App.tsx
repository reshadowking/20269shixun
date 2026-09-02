import { Navigate, Route, Routes } from 'react-router-dom'

import ApiConfigPage from '@/pages/ApiConfigPage'
import DesignsPage from '@/pages/DesignsPage'
import HomePage from '@/pages/HomePage'
import LoginPage from '@/pages/LoginPage'
import PreviewPage from '@/pages/PreviewPage'
import WorkspacePage from '@/pages/WorkspacePage'

import { getToken } from '@/lib/api'

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getToken()) {
    // 记录来源路径：登录后跳回（缺陷 5/8：主页/工作台/配置页各自可达）
    const redirect = `${window.location.pathname}${window.location.search}`
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<RequireAuth><HomePage /></RequireAuth>} />
      <Route path="/workspace" element={<RequireAuth><WorkspacePage /></RequireAuth>} />
      <Route path="/designs" element={<RequireAuth><DesignsPage /></RequireAuth>} />
      <Route path="/api-config" element={<RequireAuth><ApiConfigPage /></RequireAuth>} />
      <Route path="/preview/:id" element={<RequireAuth><PreviewPage /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
