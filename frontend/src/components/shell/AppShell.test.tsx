/** T36：AppShell 侧边栏（导航/高亮/折叠持久化/壁纸入口）。 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import AppShell from './AppShell'

function renderShell(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell>
        <div data-testid="page-content">页面内容</div>
      </AppShell>
    </MemoryRouter>,
  )
}

describe('AppShell', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('渲染五个全局入口与新建画布，并显示主区内容', () => {
    renderShell()
    for (const key of ['home', 'templates', 'assets', 'projects', 'settings']) {
      expect(screen.getByTestId(`nav-${key}`)).toBeInTheDocument()
    }
    expect(screen.getByTestId('nav-new-canvas')).toBeInTheDocument()
    expect(screen.getByTestId('page-content')).toBeInTheDocument()
  })

  it('按当前路由高亮对应入口', () => {
    renderShell('/projects')
    expect(screen.getByTestId('nav-projects')).toHaveClass('is-active')
    expect(screen.getByTestId('nav-home')).not.toHaveClass('is-active')
    expect(screen.getByTestId('nav-projects')).toHaveAttribute('aria-current', 'page')
  })

  it('折叠侧边栏并持久化记忆', () => {
    renderShell()
    expect(screen.getByTestId('app-sidebar')).toHaveAttribute('data-collapsed', '0')
    fireEvent.click(screen.getByTestId('sidebar-collapse'))
    expect(screen.getByTestId('app-sidebar')).toHaveAttribute('data-collapsed', '1')
    expect(localStorage.getItem('app-shell-collapsed')).toBe('1')
  })

  it('壁纸入口：未上传时不渲染背景层，恢复默认会清掉记录', () => {
    localStorage.setItem('home-wallpaper', 'data:image/png;base64,AAA')
    renderShell()
    expect(screen.getByTestId('app-wallpaper')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('wallpaper-reset'))
    expect(screen.queryByTestId('app-wallpaper')).toBeNull()
    expect(localStorage.getItem('home-wallpaper')).toBeNull()
  })
})
