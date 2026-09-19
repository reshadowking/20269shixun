/**
 * API 配置页（前端直接配置 LLM）：供应商预设 / API 格式 / Key / 模型 / 测试连接 / 保存立即生效。
 * 配置存后端 backend/data/llm-config.json（不入 git），优先于 .env，无需重启。
 *
 * T48：用哪种协议由「供应商预设 + API 格式」共同决定，**请求构造在后端**（协议族 × profile）。
 * 本页只做三件事：收集表单值、渲染后端下发的预设数据、用后端下发的后缀名单做即时校验。
 * **不做 URL 归一化/拼接，也不做最终 URL 预览**——权威值在「测试连接」返回的 final_url 里。
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Eye, EyeOff, Loader2, XCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import FollowupModeSelect from '@/components/settings/FollowupModeSelect'
import MembersPanel from '@/components/collab/MembersPanel'
import { api } from '@/lib/api'
import {
  DEFAULT_FORMAT,
  anthropicV1Warning,
  baseUrlMatchesPreset,
  formSignature,
  formatHint,
  formatOptions,
  inferProviderId,
  supportedFormats,
  validateBaseUrl,
  visibleProviders,
  type ApiFormat,
  type ProviderPreset,
} from '@/lib/llmProvider'

interface LLMConfig {
  llm_mode: string
  llm_base_url: string
  llm_api_key: string
  llm_model: string
  llm_backup_model: string
  llm_timeout_seconds: number
  llm_max_tokens: number
  /** T48：供应商预设与 API 格式 */
  llm_provider?: string
  llm_api_format?: string
  providers?: Record<string, ProviderPreset>
  /** 即时校验用的名单与文案（后端下发，前端不持有规则副本） */
  reserved_path_suffixes?: string[]
  reserved_path_message?: string
  api_format_labels?: Record<string, string>
}

interface TestResult {
  ok: boolean
  reply?: string
  model?: string
  error?: string
  code?: string
  /** T48：失败时的排查信息（HTTP 状态码 + 原始 error body + 最终 URL + 实际格式） */
  status?: number | null
  body?: string
  final_url?: string | null
  api_format?: string
  mock?: boolean
  latency_ms?: number
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
  llm_provider?: string
  llm_api_format?: string
}

interface ProfileList {
  active: string
  profiles: ProfileRow[]
}

const MODE_OPTIONS = [
  { value: 'real', label: '真实模式（调用 API）' },
  { value: 'mock', label: 'Mock 模式（预置模板，零成本）' },
]

/**
 * 档案列表响应的形状兜底（2026-09-18）：接口一旦没带 `profiles`（形状变更、代理返回错误体…），
 * 旧代码会把 `undefined` 塞进 state，渲染时 `profiles.map` 直接**整页白屏**。
 * 宁可显示空列表——空列表顶多是"看不到配置"，白屏是啥都干不了。
 */
function profileRows(data: ProfileList | undefined | null): ProfileRow[] {
  return Array.isArray(data?.profiles) ? data.profiles : []
}

export default function ApiConfigPage({ showMembers = false }: { showMembers?: boolean } = {}) {
  const [cfg, setCfg] = useState<LLMConfig | null>(null)
  const [provider, setProvider] = useState('deepseek')
  /** T48：API 格式（chat | responses | anthropic），与供应商预设联动 */
  const [apiFormat, setApiFormat] = useState<string>(DEFAULT_FORMAT)
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
  /**
   * T48：最近一次与**服务端一致**的表单指纹。与当前指纹不同 → 有未保存改动。
   * 加它的直接原因：用户在面板上点了预设、以为已生效，实际要等「保存配置」才落盘，
   * 结果是"以为在用 Kimi，实际请求发给了 DeepSeek"。
   */
  const [savedSig, setSavedSig] = useState<string | null>(null)
  /** 档案列表加载失败的提示前缀：与"确实没有档案"区分，也便于成功后精准收掉这条消息 */
  const LOAD_ERROR_PREFIX = '档案列表加载失败'

  // 加载当前生效配置（Key 脱敏）
  useEffect(() => {
    api<LLMConfig>('/api/llm-config')
      .then((data) => {
        const providerId = data.llm_provider ?? inferProviderId(data.llm_base_url ?? '', data.providers)
        const format = data.llm_api_format ?? DEFAULT_FORMAT
        const base = data.llm_base_url ?? ''
        const keyText = data.llm_api_key ?? ''
        const mainModel = data.llm_model ?? ''
        const backup = data.llm_backup_model ?? ''
        const timeout = String(data.llm_timeout_seconds ?? 60)
        setCfg(data)
        setMode(data.llm_mode ?? 'real')
        setBaseUrl(base)
        setApiKey(keyText)
        setModel(mainModel)
        setBackupModel(backup)
        setTimeoutSec(timeout)
        setProvider(providerId)
        setApiFormat(format)
        // 与服务端对齐：载入即"无未保存改动"（用刚拿到的值构造，避免读到旧 state）
        setSavedSig(
          formSignature({
            mode: data.llm_mode ?? 'real',
            baseUrl: base,
            apiKey: keyText,
            keyEdited: false,
            model: mainModel,
            backupModel: backup,
            timeoutSec: timeout,
            provider: providerId,
            apiFormat: format,
          }),
        )
      })
      .catch(() => setCfg(null))
  }, [])

  // T34：加载档案列表（当前生效 id + 全部档案，Key 已脱敏）
  const refreshProfiles = async () => {
    try {
      const data = await api<ProfileList>('/api/llm-config/profiles')
      const rows = profileRows(data)
      setProfiles(rows)
      setActiveProfile(data.active)
      setProfileName(rows.find((p) => p.id === data.active)?.name ?? '')
      // 加载成功后，把上次的"加载失败"提示收掉（但不要碰"已保存档案 ✓"这类操作反馈）
      setProfileMsg((m) => (m.startsWith(LOAD_ERROR_PREFIX) ? '' : m))
    } catch (err) {
      // 2026-09-18：失败**不许**清成空列表——用户会以为自己的接口配置没了。
      // 保留上一次拿到的档案，并把原因说出来（与"确实没有档案"区分开）。
      const detail = err instanceof Error ? err.message : String(err)
      setProfileMsg(`${LOAD_ERROR_PREFIX}：${detail}（下面显示的可能不是最新）`)
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
    const base = p.llm_base_url ?? ''
    const mainModel = p.llm_model ?? ''
    const backup = p.llm_backup_model ?? ''
    const timeout = String(p.llm_timeout_seconds ?? 60)
    // T48：老档案（T48 之前保存的）没有 llm_provider —— 必须按地址反推，
    // **不能保留上一个值**，否则会造出"Kimi 的地址 + DeepSeek 的 provider"，
    // 并在下次保存时把这种错配固化进配置。
    const providerId = p.llm_provider ?? inferProviderId(base, cfg?.providers)
    const format = p.llm_api_format ?? apiFormat
    setProfileName(p.name)
    setBaseUrl(base)
    setModel(mainModel)
    setBackupModel(backup)
    setTimeoutSec(timeout)
    setProvider(providerId)
    setApiFormat(format)
    setApiKey('')
    setKeyEdited(false)
    // 「载入档案」是已落盘的状态（有自己的提示语），不算未保存改动
    setSavedSig(
      formSignature({
        mode,
        baseUrl: base,
        apiKey: '',
        keyEdited: false,
        model: mainModel,
        backupModel: backup,
        timeoutSec: timeout,
        provider: providerId,
        apiFormat: format,
      }),
    )
    setProfileMsg(p.llm_api_key ? '该档案已存 Key（脱敏显示），不改就不用重填。' : '该档案还没有 Key，请填写后保存。')
  }

  /** 新建：清空表单，避免继承上一个预设/档案的地址与模型（这就是"自定义跟着上一个走"的修法）。 */
  const handleNewProfile = () => {
    setActiveProfile('')
    setProfileName('')
    setBaseUrl('')
    setModel('')
    setBackupModel('')
    setApiFormat(DEFAULT_FORMAT)
    // 供应商也要一起重置：清空地址却留着上一个供应商，会写下"空地址 + DeepSeek"这种错配
    setProvider('custom')
    setApiKey('')
    setKeyEdited(false)
    setSavedSig(null)
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
        llm_provider: provider,
        llm_api_format: apiFormat,
      }
      if (activeProfile) body.id = activeProfile
      if (keyEdited && apiKey.trim()) body.llm_api_key = apiKey.trim()
      const data = await api<ProfileList>('/api/llm-config/profiles', { method: 'POST', body: JSON.stringify(body) })
      setProfiles(profileRows(data))
      setActiveProfile(data.active)
      setProfileMsg('已保存并设为当前生效（无需重启）。')
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : '保存档案失败')
    }
  }

  const handleActivateProfile = async (id: string) => {
    try {
      const data = await api<ProfileList>(`/api/llm-config/profiles/${id}/activate`, { method: 'POST' })
      setProfiles(profileRows(data))
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
      setProfiles(profileRows(data))
      setActiveProfile(data.active)
      setProfileMsg('已删除。')
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : '删除失败')
    }
  }

  // 供应商预设快捷填充：BaseURL + 默认 API 格式 + 推荐主/备模型
  const applyProvider = (key: string) => {
    setProvider(key)
    const p = cfg?.providers?.[key]
    if (!p) return
    const fmt = p.default_api_format ?? DEFAULT_FORMAT
    setApiFormat(fmt)
    setBaseUrl(p.base_url_by_format?.[fmt] ?? p.base_url)
    setModel(p.models?.primary ?? p.model)
    setBackupModel(p.models?.fallback ?? p.backup_model ?? p.model)
  }

  /** 切换 API 格式：该格式在预设里有专属地址时联动 BaseURL（自定义不动用户填的地址） */
  const handleFormatChange = (next: string) => {
    setApiFormat(next)
    if (provider === 'custom') return
    const nextBase = cfg?.providers?.[provider]?.base_url_by_format?.[next as ApiFormat]
    if (nextBase) setBaseUrl(nextBase)
  }

  const payload = () => ({
    llm_mode: mode,
    llm_base_url: baseUrl.trim(),
    ...(keyEdited ? { llm_api_key: apiKey.trim() } : {}),
    llm_model: model.trim(),
    llm_backup_model: backupModel.trim(),
    llm_timeout_seconds: Number(timeoutSec) || 60,
    llm_provider: provider,
    llm_api_format: apiFormat,
  })

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const resp = await api<LLMConfig>('/api/llm-config', { method: 'POST', body: JSON.stringify(payload()) })
      // 用**服务端返回值**回填表单：服务端会做裁剪与归一（去空格、旧 id 归一），
      // 不回填就会出现"界面值与实际生效值不一致"，且未保存提示会一直亮着
      const base = resp.llm_base_url ?? ''
      const mainModel = resp.llm_model ?? ''
      const backup = resp.llm_backup_model ?? ''
      const timeout = String(resp.llm_timeout_seconds ?? 60)
      const keyText = resp.llm_api_key ?? ''
      const providerId = resp.llm_provider ?? inferProviderId(base, resp.providers)
      const format = resp.llm_api_format ?? DEFAULT_FORMAT
      const modeValue = resp.llm_mode ?? mode
      setCfg(resp)
      setMode(modeValue)
      setBaseUrl(base)
      setModel(mainModel)
      setBackupModel(backup)
      setTimeoutSec(timeout)
      setProvider(providerId)
      setApiFormat(format)
      setApiKey(keyText) // 回显脱敏值
      setKeyEdited(false) // 已固化，后续保存不再携带 key 字段
      setSavedSig(
        formSignature({
          mode: modeValue,
          baseUrl: base,
          apiKey: keyText,
          keyEdited: false,
          model: mainModel,
          backupModel: backup,
          timeoutSec: timeout,
          provider: providerId,
          apiFormat: format,
        }),
      )
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
  // T48：预设/格式相关派生值——全部来自后端下发的数据，前端不推导任何规则
  const preset = cfg?.providers?.[provider]
  const presetList = visibleProviders(cfg?.providers)
  const allowedFormats = supportedFormats(preset)
  const formats = formatOptions(cfg?.api_format_labels, preset)
  const baseUrlError = validateBaseUrl(baseUrl, cfg?.reserved_path_suffixes, cfg?.reserved_path_message)
  const baseUrlWarning = anthropicV1Warning(baseUrl, apiFormat)
  const hint = formatHint(preset, apiFormat)
  // 有未保存改动？（表单指纹 vs 最近一次与服务端一致时的指纹）
  const sigNow = formSignature({ mode, baseUrl, apiKey, keyEdited, model, backupModel, timeoutSec, provider, apiFormat })
  const dirty = savedSig !== null && savedSig !== sigNow
  // 地址与所选预设不匹配（老档案错配 / 手改了地址）：只提示不拦截——地址照用，
  // 但参数策略仍按该预设生效，用户需要知道这件事
  const presetMismatch = !!baseUrl.trim() && !baseUrlMatchesPreset(baseUrl, provider, cfg?.providers)

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
              {presetList.map(([key, p]) => (
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
            </div>
            {/* T48：API 格式——紧跟预设按钮组之后、BaseURL 之前（唯一新增控件） */}
            <div className="mt-3 flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">API 格式</label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                data-testid="api-format-select"
                value={apiFormat}
                onChange={(e) => handleFormatChange(e.target.value)}
              >
                {formats.map((f) => {
                  const supported = allowedFormats.includes(f.value as ApiFormat)
                  return (
                    <option key={f.value} value={f.value} disabled={!supported}>
                      {f.label}
                      {supported ? '' : '（该预设不支持）'}
                    </option>
                  )
                })}
              </select>
              {hint && (
                <p className="text-[11px] text-muted-foreground" data-testid="api-format-hint">
                  {hint}
                </p>
              )}
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
              {/* T48：即时校验（名单与文案都来自后端）——点测试连接之前就拦住 */}
              {baseUrlError && (
                <p className="text-[11px] text-red-600" data-testid="cfg-base-url-error">
                  {baseUrlError}
                </p>
              )}
              {!baseUrlError && baseUrlWarning && (
                <p className="text-[11px] text-amber-600" data-testid="cfg-base-url-warning">
                  {baseUrlWarning}
                </p>
              )}
              {!baseUrlError && presetMismatch && (
                <p className="text-[11px] text-amber-600" data-testid="cfg-base-url-mismatch">
                  当前 BaseURL 不属于预设「{preset?.name ?? provider}」：请求会发往这个地址，
                  但参数策略仍按该预设生效。若这是另一家的接口，请切换预设或改用「自定义」。
                </p>
              )}
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
            <Button size="sm" data-testid="cfg-save" disabled={saving || !!baseUrlError} onClick={handleSave}>
              {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              保存配置
            </Button>
            <Button size="sm" variant="outline" data-testid="cfg-test" disabled={testing || !!baseUrlError} onClick={handleTest}>
              {testing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              测试连接
            </Button>
            {/* T48：改了字段但没保存时明确说出来 —— "以为改了其实没生效"曾导致真实误判 */}
            {dirty && (
              <span className="text-[11px] text-amber-600" data-testid="cfg-dirty">
                有未保存改动，点「保存配置」才会生效
              </span>
            )}
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
              <div className="min-w-0 flex-1">
                {testResult.ok ? (
                  <>
                    <div className="font-medium">
                      连接成功 ✓{testResult.mock ? '（Mock 模式，未调用远程）' : ''} 模型回复：
                      {testResult.reply}
                    </div>
                    <div className="mt-0.5 opacity-80">
                      实际模型：{testResult.model}
                      {typeof testResult.latency_ms === 'number' ? ` · 耗时 ${testResult.latency_ms}ms` : ''}
                      {testResult.api_format ? ` · API 格式：${testResult.api_format}` : ''}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-medium">连接失败：{testResult.error}</div>
                    {(testResult.status || testResult.api_format) && (
                      <div className="mt-0.5 opacity-80">
                        {testResult.status ? `HTTP ${testResult.status}` : ''}
                        {testResult.api_format ? ` · API 格式：${testResult.api_format}` : ''}
                      </div>
                    )}
                    {/* T48：最终请求 URL 与原始 error body 是排查的命根子，必须原样展示 */}
                    {testResult.final_url && (
                      <div className="mt-0.5 break-all opacity-80" data-testid="test-final-url">
                        最终请求 URL：{testResult.final_url}
                      </div>
                    )}
                    {testResult.body && (
                      <pre
                        className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-white/60 p-2 text-[11px]"
                        data-testid="test-error-body"
                      >
                        {testResult.body}
                      </pre>
                    )}
                  </>
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
