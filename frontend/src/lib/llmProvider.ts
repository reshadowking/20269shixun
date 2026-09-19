/**
 * 供应商预设与 API 格式：前端类型 + 即时校验（T48）。
 *
 * 分工（重要）：
 * - **请求构造在后端**（协议族 × profile）：URL 拼接、请求体形状、认证头都在那里。
 * - 前端只做两件事：① 渲染后端下发的预设数据（下拉选项、提示文案）；
 *   ② 用后端下发的后缀名单做即时拦截，别让用户点完「测试连接」才发现地址填错。
 *
 * **禁止**在前端做 URL 归一化、路径拼接，也不许维护规则副本：两份归一化逻辑必然漂移，
 * 最后会出现"前端显示对了、实际请求 404"这类最难查的问题。表单因此**不做最终 URL 预览**
 * ——权威值在「测试连接」返回的 final_url 里。
 */

export type ApiFormat = 'chat' | 'responses' | 'anthropic'

export interface ProviderParamPolicy {
  drop?: string[]
  clamp?: Record<string, number[]>
  rename?: Record<string, string>
}

export interface ProviderPreset {
  /** 既有三键（保持向后兼容） */
  name: string
  base_url: string
  model: string
  backup_model?: string
  /** T48 新增 */
  deprecated?: boolean
  default_api_format?: ApiFormat
  supported_formats?: ApiFormat[]
  base_url_by_format?: Partial<Record<ApiFormat, string>>
  /** 后端算好的最终 URL；空 base 的预设（自定义）为 null */
  final_url_by_format?: Partial<Record<ApiFormat, string | null>>
  hint_by_format?: Partial<Record<ApiFormat, string>>
  models?: { primary: string; fallback: string; flagship: string }
  param_policy?: Partial<Record<ApiFormat, ProviderParamPolicy>>
}

export interface ProviderCatalogData {
  providers?: Record<string, ProviderPreset>
  reserved_path_suffixes?: string[]
  reserved_path_message?: string
  api_format_labels?: Record<string, string>
}

export const DEFAULT_FORMAT: ApiFormat = 'chat'

/** 可选预设（跳过 deprecated 别名——旧键只为老 bundle 保留，不再渲染） */
export function visibleProviders(
  providers: Record<string, ProviderPreset> | undefined,
): Array<[string, ProviderPreset]> {
  return Object.entries(providers ?? {}).filter(([, preset]) => !preset.deprecated)
}

/**
 * BaseURL 即时校验：命中后端下发的禁用后缀即拦截。
 *
 * 空值合法（自定义预设默认就是空的）。名单与文案都来自后端——**后端没下发就不拦**
 * （没有规则就不做判断，而不是在前端补一份规则副本）。
 */
export function validateBaseUrl(
  baseUrl: string,
  suffixes: readonly string[] | undefined,
  message: string | undefined,
): string | null {
  const trimmed = (baseUrl ?? '').trim()
  if (!trimmed || !message) return null
  const hit = (suffixes ?? []).find((suffix) => suffix && trimmed.includes(suffix))
  return hit ? `${message}（检测到 ${hit}）` : null
}

/** 当前格式下的静态提示串（后端下发；自定义预设是专门文案） */
export function formatHint(preset: ProviderPreset | undefined, apiFormat: string): string {
  return preset?.hint_by_format?.[apiFormat as ApiFormat] ?? ''
}

/**
 * anthropic 格式 + base 以 /v1 结尾时的**非拦截**提示。
 *
 * 这里只做字符串判断决定要不要提示，**不参与请求构造**（请求 URL 由 SDK 拼）。
 */
export function anthropicV1Warning(baseUrl: string, apiFormat: string): string | null {
  if (apiFormat !== 'anthropic') return null
  const trimmed = (baseUrl ?? '').trim().replace(/\/+$/, '')
  if (!trimmed.toLowerCase().endsWith('/v1')) return null
  return 'Anthropic SDK 会自动拼 `/v1/messages`，你的 BaseURL 末尾 `/v1` 会变成 `/v1/v1/messages`，建议去掉末尾的 `/v1`。'
}

/** 该预设支持哪些格式（缺失时按 chat 兜底） */
export function supportedFormats(preset: ProviderPreset | undefined): ApiFormat[] {
  const list = preset?.supported_formats
  return list && list.length > 0 ? list : ['chat']
}

/**
 * API 格式下拉的选项：优先用后端下发的标签（顺序也由它定）；
 * 老后端没下发时退回当前预设支持的格式（不硬编码中文标签）。
 */
export function formatOptions(
  labels: Record<string, string> | undefined,
  preset: ProviderPreset | undefined,
): Array<{ value: string; label: string }> {
  const fromLabels = Object.entries(labels ?? {})
  if (fromLabels.length > 0) {
    return fromLabels.map(([value, label]) => ({ value, label }))
  }
  return supportedFormats(preset).map((value) => ({ value, label: value }))
}

/** 仅用于**匹配**的规整（去尾斜杠 + 小写）；不参与请求构造 */
function normalizeForMatch(url: string): string {
  return (url ?? '').trim().replace(/\/+$/, '').toLowerCase()
}

/**
 * 按地址反推预设 id —— 给 **T48 之前保存的老档案**用（那些档案没有 `llm_provider` 字段）。
 *
 * 匹配用的是**后端下发的 preset 数据**，前端不硬编码任何厂商规则；匹配不上 → `custom`。
 * 为什么必须反推而不是"保持上一个值"：老档案载入时若沿用旧 provider，
 * 就会造出"Kimi 的地址 + DeepSeek 的 provider"这种错配，并在下次保存时被固化进配置。
 */
export function inferProviderId(
  baseUrl: string,
  providers: Record<string, ProviderPreset> | undefined,
): string {
  const target = normalizeForMatch(baseUrl)
  if (!target) return 'custom'
  for (const [id, preset] of Object.entries(providers ?? {})) {
    if (preset.deprecated) continue
    const bases = Object.values(preset.base_url_by_format ?? {})
    if (bases.some((base) => normalizeForMatch(base ?? '') === target)) return id
  }
  return 'custom'
}

/** BaseURL 是否属于所选预设（不匹配时界面给提示：地址照用，但参数策略仍按该预设生效） */
export function baseUrlMatchesPreset(
  baseUrl: string,
  providerId: string,
  providers: Record<string, ProviderPreset> | undefined,
): boolean {
  if (providerId === 'custom') return true
  const target = normalizeForMatch(baseUrl)
  if (!target) return true
  const preset = providers?.[providerId]
  if (!preset) return true
  return Object.values(preset.base_url_by_format ?? {}).some(
    (base) => normalizeForMatch(base ?? '') === target,
  )
}

export interface FormState {
  mode: string
  baseUrl: string
  apiKey: string
  keyEdited: boolean
  model: string
  backupModel: string
  timeoutSec: string
  provider: string
  apiFormat: string
}

/**
 * 表单指纹：用来判断"有未保存改动"。
 *
 * 必须覆盖**所有**会改变请求结果的字段——漏一个就会出现"改了却不提示"，
 * 而这次的线上困惑正是"改了没保存却以为生效了"。
 */
export function formSignature(form: FormState): string {
  return JSON.stringify([
    form.mode,
    form.baseUrl,
    form.apiKey,
    form.keyEdited,
    form.model,
    form.backupModel,
    form.timeoutSec,
    form.provider,
    form.apiFormat,
  ])
}
