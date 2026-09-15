/**
 * T36：全局外壳（左侧边栏 + 主区）。
 *
 * 用途：首页 / 模板库 / 资产库 / 我的项目 / 设置 共用；**工作台不套**（它自身是三栏，
 * 会变成两条左栏，工作台走 48px 图标 rail）。
 * 侧边栏承担全局导航 + 壁纸入口；折叠态持久化到 localStorage。
 */
import { useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import './appShell.css'

const COLLAPSE_KEY = 'app-shell-collapsed'
const WALLPAPER_KEY = 'home-wallpaper'

export interface NavItem {
  key: string
  label: string
  icon: string
  to: string
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'home', label: '首页', icon: '◫', to: '/' },
  { key: 'templates', label: '模板库', icon: '▦', to: '/templates' },
  { key: 'assets', label: '资产库', icon: '▣', to: '/assets' },
  { key: 'projects', label: '我的项目', icon: '▤', to: '/projects' },
  { key: 'settings', label: '设置', icon: '⚙', to: '/settings' },
]

function readWallpaper(): string | null {
  try {
    return localStorage.getItem(WALLPAPER_KEY)
  } catch {
    return null
  }
}

export default function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [wallpaper, setWallpaper] = useState<string | null>(() => readWallpaper())
  const fileRef = useRef<HTMLInputElement>(null)

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        /* 忽略：仅影响记忆 */
      }
      return next
    })
  }

  const saveWallpaper = (dataUrl: string) => {
    setWallpaper(dataUrl)
    try {
      localStorage.setItem(WALLPAPER_KEY, dataUrl)
    } catch {
      /* 图片过大时不落盘，仅本次生效 */
    }
  }

  const clearWallpaper = () => {
    setWallpaper(null)
    try {
      localStorage.removeItem(WALLPAPER_KEY)
    } catch {
      /* 忽略 */
    }
  }

  const isActive = (item: NavItem) => (item.to === '/' ? pathname === '/' : pathname.startsWith(item.to))

  return (
    <div className={`app-shell${collapsed ? ' app-shell--rail' : ''}`} data-testid="app-shell">
      {wallpaper && (
        <div
          className="app-shell__wallpaper"
          data-testid="app-wallpaper"
          style={{ backgroundImage: `url("${wallpaper}")` }}
        />
      )}
      <aside className="app-shell__side" data-testid="app-sidebar" data-collapsed={collapsed ? '1' : '0'}>
        <div className="app-shell__brand">
          <span className="app-shell__logo">AI</span>
          {!collapsed && (
            <span className="app-shell__brand-text">
              设计工作台<small>natural language → code</small>
            </span>
          )}
        </div>

        <button className="app-shell__cta" data-testid="nav-new-canvas" onClick={() => navigate('/workspace')}>
          ＋ {collapsed ? '' : '新建画布'}
        </button>

        <nav className="app-shell__nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`app-shell__nav-item${isActive(item) ? ' is-active' : ''}`}
              data-testid={`nav-${item.key}`}
              aria-current={isActive(item) ? 'page' : undefined}
              title={collapsed ? item.label : undefined}
              onClick={() => navigate(item.to)}
            >
              <span className="app-shell__nav-icon">{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="app-shell__grow" />

        <div className="app-shell__foot">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            data-testid="wallpaper-input"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = () => saveWallpaper(String(reader.result))
              reader.readAsDataURL(file)
              e.target.value = ''
            }}
          />
          <button className="app-shell__foot-btn" data-testid="wallpaper-upload" onClick={() => fileRef.current?.click()}>
            🖼 {!collapsed && '上传壁纸'}
          </button>
          {wallpaper && !collapsed && (
            <button className="app-shell__foot-btn" data-testid="wallpaper-reset" onClick={clearWallpaper}>
              恢复默认壁纸
            </button>
          )}
          <button className="app-shell__foot-btn" data-testid="sidebar-collapse" onClick={toggleCollapsed}>
            {collapsed ? '⇥' : '⇤'} {!collapsed && '收起侧边栏'}
          </button>
        </div>
      </aside>

      <main className="app-shell__main" data-testid="app-main">
        {children}
      </main>
    </div>
  )
}
