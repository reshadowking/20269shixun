/**
 * 保存命名表单（缺陷 16/17）：输入名称后确认保存。
 */
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface SaveNameFormProps {
  onCancel: () => void
  onConfirm: (name: string) => void
}

export function SaveNameForm({ onCancel, onConfirm }: SaveNameFormProps) {
  const [name, setName] = useState('')
  return (
    <div className="flex flex-col gap-3">
      <Input
        autoFocus
        className="h-9 text-sm"
        data-testid="save-name-input"
        placeholder="输入设计名称，如：电商首页 v1"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) onConfirm(name)
        }}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" data-testid="save-name-cancel" onClick={onCancel}>
          取消
        </Button>
        <Button size="sm" data-testid="save-name-confirm" disabled={!name.trim()} onClick={() => onConfirm(name)}>
          保存
        </Button>
      </div>
    </div>
  )
}
