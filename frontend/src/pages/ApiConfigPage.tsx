/**
 * API 配置页（前端直接配置 LLM）：供应商预设 / Key / 模型 / 测试连接 / 保存立即生效。
 * 配置存后端 backend/data/llm-config.json（不入 git），优先于 .env，无需重启。
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Eye, EyeOff, Loader2, XCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import FollowupModeSelect from '@/components/settings/FollowupModeSelect'
import MembersPanel from '@/components/collab/MembersPanel'
import { api } from '@/lib/api'

interface LLMConfig {
  llm_mode: string
  llm_base_url: string
  llm_api_key: string
  llm_model: string
  llm_backup_model: string
  llm_timeout_seconds: number
  llm_max_tokens: number
  providers?: Record<string, { name: string; base_url: string; model: string }>
}

interface TestResult {
  ok: boolean
  reply?: string
  model?: string
  error?: string
  code?: string
}

/** T34：接口档案（多套接口互不覆盖；Key 由后端脱敏返回） */
interface ProfileRow {
  id: string
  name: string
  llm_base_url?: string
  llm_api_key?: string
  llm_model?: string
  llm_backup_model?: string
  llm_timeout_seconds?: number
}

interface ProfileList {
  active: string
  profiles: ProfileRow[]
}

const MODE_OPTIONS = [
  { value: 'real', label: '真实模式（调用 API）' },
  { value: 'mock', label: 'Mock 模式（预置模板，零成本）' },
]

export default function ApiConfigPage({ showMembers = false }: { showMembers?: boolean } = {}) {
  const [cfg, setCfg] = useState<LLMConfig | null>(null)
  const [provider, setProvider] = useState('deepseek')
  const [mode, setMode] = useState('real')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  /** 用户是否编辑过 Key（回显的是脱敏值，未编辑时提交会把 **** 覆盖真实 Key，故仅编辑过才提交） */
  const [keyEdited, setKeyEdited] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [model, setModel] = useState('')
  const [backupModel, setBackupModel] = useState('')
  const [timeoutSec, setTimeoutSec] = useState('60')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [activeProfile, setActiveProfile] = useState('')
  const [profileName, setProfileName] = useState('')
  const [profileMsg, setProfileMsg] = useState('')

  // 加载当前生效配置（Key 脱敏）
  useEffect(() => {
    api<LLMConfig>('/api/llm-config')
      .then((data) => {
        setCfg(data)
        setMode(data.llm_mode ?? 'real')
        setBaseUrl(data.llm_base_url ?? '')
        setApiKey(data.llm_api_key ?? '')
        setModel(data.llm_model ?? '')
        setBackupModel(data.llm_backup_model ?? '')
        setTimeoutSec(String(data.llm_timeout_seconds ?? 60))
      })
      .catch(() => setCfg(null))
  }, [])

  // T34：加载档案列表（当前生效 id + 全部档案，Key 已脱敏）
  const refreshProfiles = async () => {
    try {
      const data = await api<ProfileList>('/api/llm-config/profiles')
      setProfiles(data.profiles)
      setActiveProfile(data.active)
      setProfileName(data.profiles.find((p) => p.id === data.active)?.name ?? '')
    } catch {
      setProfiles([])
    }
  }
  useEffect(() => {
    void refreshProfiles()
  }, [])

  /** 选中某档案：把它的值载入表单（Key 不回填——脱敏值会被后端忽略，避免误以为已填）。 */
  const loadProfile = (id: string) => {
    const p = profiles.find((item) => item.id === id)
    setActiveProfile(id)
    if (!p) return
    setProfileName(p.name)
    setBaseUrl(p.llm_base_url ?? '')
    setModel(p.llm_model ?? '')
    setBackupModel(p.llm_backup_model ?? '')
    setTimeoutSec(String(p.llm_timeout_seconds ?? 60))
    setApiKey('')
    setKeyEdited(false)
    setProfileMsg(p.llm_api_key ? '该档案已存 Key（脱敏显示），不改就不用重填。' : '该档案还没有 Key，请填写后保存。')
  }

  /** 新建：清空表单，避免继承上一个预设/档案的地址与模型（这就是"自定义跟着上一个走"的修法）。 */
  const handleNewProfile = () => {
    setActiveProfile('')
    setProfileName('')
    setBaseUrl('')
    setModel('')
    setBackupModel('')
    setApiKey('')
    setKeyEdited(false)
    setProfileMsg('已清空表单，填写新接口后点「保存档案」即可创建一份新配置。')
  }

  const handleSaveProfile = async () => {
    setProfileMsg('')
    try {
      const body: Record<string, unknown> = {
        name: profileName.trim() || '未命名配置',
        llm_base_url: baseUrl.trim(),
        llm_model: model.trim(),
        llm_backup_model: backupModel.trim(),
        llm_timeout_seconds: Number(timeoutSec) || 60,
      }
      if (activeProfile) body.id = activeProfile
      if (keyEdited && apiKey.trim()) body.llm_api_key = apiKey.trim()
      const data = await api<ProfileList>('/api/llm-config/profiles', { method: 'POST', body: JSON.stringify(body) })
      setProfiles(data.profiles)
      setActiveProfile(data.active)
      setProfileMsg('已保存并设为当前生效（无需重启）。')
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : '保存档案失败')
    }
  }

  const handleActivateProfile = async (id: string) => {
    try {
      const data = await api<ProfileList>(`/api/llm-config/profiles/${id}/activate`, { method: 'POST' })
      setProfiles(data.profiles)
      setActiveProfile(data.active)
      setProfileMsg('已切换生效档案。')
      await refreshProfiles()
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : '切换失败')
    }
  }

  const handleDeleteProfile = async (id: string) => {
    if (!window.confirm('删除这份接口配置？')) return
    try {
      const data = await api<ProfileList>(`/api/llm-config/profiles/${id}`, { method: 'DELETE' })
      setProfiles(data.profiles)
      setActiveProfile(data.active)
      setProfileMsg('已删除。')
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : '删除失败')
    }
  }

  // 供应商预设快捷填充
  const applyProvider = (key: string) => {
    setProvider(key)
    const p = cfg?.providers?.[key]
    if (p) {
      setBaseUrl(p.base_url)
      setModel(p.model)
      setBackupModel(p.model)
    }
  }

  const payload = () => ({
    llm_mode: mode,
    llm_base_url: baseUrl.trim(),
    ...(keyEdited ? { llm_api_key: apiKey.trim() } : {}),
    llm_model: model.trim(),
    llm_backup_model: backupModel.trim(),
    llm_timeout_seconds: Number(timeoutSec) || 60,
  })

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const resp = await api<LLMConfig>('/api/llm-config', { method: 'POST', body: JSON.stringify(payload()) })
      setCfg(resp)
      setApiKey(resp.llm_api_key) // 回显脱敏值
      setKeyEdited(false) // 已固化，后续保存不再携带 key 字段
      setSaved(true)
      setTestResult(null)
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : '保存失败' })
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const resp = await api<TestResult>('/api/llm-config/test', { method: 'POST', body: JSON.stringify(payload()) })
      setTestResult(resp)
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : '测试失败' })
    } finally {
      setTesting(false)
    }
  }

  const inputCls = 'h-9 text-sm'

  return (
    <div className="flex min-h-screen flex-col items-center bg-muted/40 py-12">
      <div className="w-full max-w-2xl rounded-xl border bg-background p-8 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">API 配置</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              在页面直接配置供应商与密钥，保存后<strong>立即生效，无需改 .env、无需重启</strong>
            </p>
          </div>
          {saved && (
            <span className="flex items-center gap-1 text-xs text-emerald-600" data-testid="save-ok">
              <CheckCircle2 className="h-3.5 w-3.5" /> 已保存并生效
            </span>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-4">
          {/* 供应商预设 */}
          <div className="rounded-lg border p-4">
            <div className="mb-2 text-sm font-medium">供应商预设</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(cfg?.providers ?? {}).map(([key, p]) => (
                <button
                  key={key}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    provider === key ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent'
                  }`}
                  data-testid={`provider-${key}`}
                  onClick={() => applyProvider(key)}
                >
                  {p.name}
                </button>
              ))}
              <button
                className={`rounded-full border px-3 py-1 text-xs ${
                  provider === 'custom' ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent'
                }`}
                data-testid="provider-custom"
                onClick={() => applyProvider('custom')}
              >
                自定义
              </button>
            </div>
          </div>

          {/* 连接参数 */}
          <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label className="text-xs text-muted-foreground">Base URL（OpenAI 兼容地址）</label>
              {/* T34：接口档案区——可保存多套接口（互相不覆盖），支持新建/切换/删除 */}
              <div className="flex flex-col gap-2 rounded-md border bg-background p-3" data-testid="profile-section">
                <div className="flex items-center gap-2">
                  <select
                    className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                    data-testid="profile-select"
                    value={activeProfile}
                    onChange={(e) => loadProfile(e.target.value)}
                  >
                    {!activeProfile && <option value="">（新建配置）</option>}
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.id === activeProfile ? ' · 当前' : ''}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" variant="outline" className="h-9 text-xs" data-testid="profile-new" onClick={handleNewProfile}>
                    ＋ 新建配置
                  </Button>
                </div>
                <Input
                  className={inputCls}
                  data-testid="profile-name"
                  value={profileName}
                  placeholder="配置名称，例如：本地 Ollama / 千问生产"
                  onChange={(e) => setProfileName(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <Button size="sm" className="h-8 text-xs" data-testid="profile-save" onClick={handleSaveProfile}>
                    保存档案（并设为生效）
                  </Button>
                  {activeProfile && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        data-testid="profile-activate"
                        onClick={() => handleActivateProfile(activeProfile)}
                      >
                        设为生效
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        data-testid="profile-delete"
                        onClick={() => handleDeleteProfile(activeProfile)}
                      >
                        删除
                      </Button>
                    </>
                  )}
                </div>
                {profileMsg && (
                  <p className="text-xs text-muted-foreground" data-testid="profile-msg">
                    {profileMsg}
                  </p>
                )}
              </div>
              <Input className={inputCls} data-testid="cfg-base-url" value={baseUrl} placeholder="https://api.deepseek.com/v1" onChange={(e) => setBaseUrl(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label className="text-xs text-muted-foreground">API Key</label>
              <div className="relative">
                <Input
                  className={`${inputCls} pr-10`}
                  data-testid="cfg-api-key"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  placeholder="sk-..."
                  onChange={(e) => {
                    setApiKey(e.target.value)
                    setKeyEdited(true)
                  }}
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  data-testid="cfg-toggle-key"
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {apiKey && apiKey.includes('****') ? `当前已保存：${apiKey}（重新输入可替换）` : '密钥仅保存在本机后端文件，不会提交到代码仓库'}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">主模型</label>
              <Input className={inputCls} data-testid="cfg-model" value={model} placeholder="deepseek-chat" onChange={(e) => setModel(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">备用模型（超时自动切换）</label>
              <Input className={inputCls} data-testid="cfg-backup-model" value={backupModel} placeholder="deepseek-chat" onChange={(e) => setBackupModel(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">超时（秒）</label>
              <Input className={inputCls} data-testid="cfg-timeout" type="number" min={10} max={300} value={timeoutSec} onChange={(e) => setTimeoutSec(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">运行模式</label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                data-testid="cfg-mode"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                {MODE_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center gap-2">
            <Button size="sm" data-testid="cfg-save" disabled={saving} onClick={handleSave}>
              {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              保存配置
            </Button>
            <Button size="sm" variant="outline" data-testid="cfg-test" disabled={testing} onClick={handleTest}>
              {testing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              测试连接
            </Button>
          </div>

          {/* 测试结果 */}
          {testResult && (
            <div
              className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${
                testResult.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-red-300 bg-red-50 text-red-700'
              }`}
              data-testid="test-result"
            >
              {testResult.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
              <div>
                {testResult.ok ? (
                  <>
                    <div className="font-medium">连接成功 ✓ 模型回复：{testResult.reply}</div>
                    <div className="mt-0.5 opacity-80">实际模型：{testResult.model}</div>
                  </>
                ) : (
                  <div className="font-medium">连接失败：{testResult.error}</div>
                )}
              </div>
            </div>
          )}

          {/* 追问模式 */}
          <div className="rounded-lg border p-4">
            <div className="text-sm font-medium">追问模式</div>
            <div className="mt-2">
              <FollowupModeSelect />
            </div>
            <div className="mt-2 text-xs leading-relaxed text-muted-foreground">
              AI 生成前会先判断需求是否完整（页面类型 / 风格），按模式决定是否追问。
              聊天框还支持快捷指令：「直接生成」跳过追问、「问详细一点」「简单点」本次切换模式。
            </div>
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <Link to="/" className="text-sm text-primary hover:underline">← 返回工作台</Link>
            <span className="text-xs text-muted-foreground">未配置 Key 时自动走 Mock 模式（预置模板兜底）</span>
          </div>
        </div>
        {/* T46a-4：设置页（/settings）才显示「成员与邀请」；/api-config 旧入口保持纯 API 配置 */}
        {showMembers && <MembersPanel />}
      </div>
    </div>
  )
}
