/**
 * T29：追问模式下拉的回显修复——切换后**立即**显示新值，且不产生任何网络请求。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import FollowupModeSelect from './FollowupModeSelect'
import { readStorage } from '@/lib/storage'

describe('FollowupModeSelect', () => {
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('切换后立即回显新值并写入 localStorage（纯前端，无网络）', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<FollowupModeSelect />)

    const select = screen.getByTestId('followup-mode-select') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'off' } })

    expect(select.value).toBe('off') // 修复点：不再需要整页重渲染才显示
    // T41：断言走存储适配器（每个用例注入独立内存后端，window.localStorage 不再被写）
    expect(readStorage('design-followup-mode')).toBe('off')
    expect(fetchMock).not.toHaveBeenCalled() // 该设置是纯前端偏好，永远不发请求
  })

  it('外部传入 value 时以外部为准，切换仍会回调', () => {
    const onChange = vi.fn()
    render(<FollowupModeSelect value="detailed" onChange={onChange} />)
    const select = screen.getByTestId('followup-mode-select') as HTMLSelectElement
    expect(select.value).toBe('detailed')
    fireEvent.change(select, { target: { value: 'concise' } })
    expect(onChange).toHaveBeenCalledWith('concise')
  })
})
