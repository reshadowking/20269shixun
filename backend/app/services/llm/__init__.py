"""LLM 客户端封装（v2.2 §2.2/§4.4）。

T48 起按**协议族**适配，而不是"只支持 OpenAI 兼容"：

- `chat` / `responses` → openai 族（同一个 SDK 客户端，请求体形状不同）
- `anthropic` → anthropic 族（独立 SDK；认证与版本头由 profile 数据决定）

厂商差异（base_url / 认证 / 参数策略 / 模型名）全部写在 `profiles.py`，
协议差异（system 位置、max token 字段名、temperature 范围）在 `normalizer.py`，
本模块只负责：预算与超时、失败重试与切备用模型、调用记账。

- mock 模式（LLM_MODE=mock / 无 key）：不调用网络，由调用方注入 mock 响应（断网兜底）
- real 模式：单次超时 LLM_TIMEOUT_SECONDS，失败重试 1 次后切备用模型
- chat_json：要求输出 JSON，解析失败重试一次（v2.2 §4.4：非 JSON 重试 1 次）

⚠️ 两条 monkeypatch 契约（改这个文件前先读）：
① 生成链路的测试替换的是 `app.services.llm.OpenAI`（包命名空间绑定）——`build_client`
   是 openai 族在本包内的**唯一**构造点，别把 `OpenAI` 挪进子模块，否则 patch 静默失效。
② 诊断端点（`routers/llm_config.py`）的测试替换的是 `openai.OpenAI`——那条路径靠
   **函数体内 import**，也不能挪进来。
"""
import hashlib
import json
import logging
import re
import time
from collections.abc import Callable
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

from openai import APIStatusError, APITimeoutError, OpenAI

from ...config import get_settings

if TYPE_CHECKING:  # 仅为类型注解，避免包初始化时的导入耦合
    from .profiles import ProviderProfile

logger = logging.getLogger(__name__)


def prompt_version(system: str) -> str:
    """T21：提示词版本 = system 文本 sha256 前 12 位（自动生成，禁止手工维护版本号）。"""
    return hashlib.sha256(system.encode("utf-8")).hexdigest()[:12]


def _repair_json_text(text: str) -> str:
    """轻量修复常见 JSON 语法错误（超长输出尾部易错）：

    - 尾随逗号：{"a": 1,} → {"a": 1}
    - 漏逗号（三类位置）：
      ① } 或 ] 后直接跟 " 或 {（对象键前 / 对象数组元素间）
      ② 属性值后换行直接跟 "（如 "padding": 16 换行 "margin"）
      ③ 数组元素间（数字/引号/}] 后换行跟 数字/引号/[/{）
    修复失败返回原文本（不影响原有判断）。"""
    fixed = re.sub(r",\s*([}\]])", r"\1", text)  # 尾随逗号
    # lookahead 不消费后字符：相邻多处缺逗号（[1\n2\n3]）可连续修复
    fixed = re.sub(r"([}\]])[\r\n]+(?=\s*[\"\{])", r"\1,\n", fixed)  # ① }/] 后缺逗号
    fixed = re.sub(
        r"([0-9a-zA-Z\u4e00-\u9fff\"\}\]])[\r\n]+(?=\s*[\"\[\{0-9])",
        r"\1,\n",
        fixed,  # ②③ 值后缺逗号：后跟 " { [ 数字
    )
    return fixed


def _try_load(candidate: str) -> dict | None:
    """提取候选文本中的最外层 JSON 并解析；失败尝试轻量修复后再解析。"""
    start, end = candidate.find("{"), candidate.rfind("}")
    if start < 0 or end <= start:
        return None
    fragment = candidate[start : end + 1]
    try:
        return json.loads(fragment)
    except json.JSONDecodeError:
        try:
            return json.loads(_repair_json_text(fragment))
        except json.JSONDecodeError:
            return None


def _extract_json(text: str) -> dict | None:
    """从 LLM 输出中提取 JSON（容忍 markdown 围栏、前后杂文本与常见语法错误）。

    注意：围栏提取必须用贪婪匹配（\\{.*\\}）——嵌套 JSON（完整 DesignNode 树）
    用非贪婪 \\{.*?\\} 会在第一个内层 } 处截断，解析必然失败（曾导致
    "参数填充未返回有效 JSON" 误报为限流/超时）。围栏失败再回退全文。
    """
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.DOTALL)
    for candidate in (fenced.group(1) if fenced else None, text):
        if candidate is None:
            continue
        parsed = _try_load(candidate)
        if parsed is not None:
            return parsed
    # 多围栏等复杂场景：逐围栏尝试
    if fenced:
        return _extract_json_from(text)
    return None


def _extract_json_from(text: str) -> dict | None:
    """回退提取：先全文最外层，再逐个 markdown 围栏尝试（多围栏场景）。"""
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass
    for block in re.findall(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL):
        start, end = block.find("{"), block.rfind("}")
        if start < 0 or end <= start:
            continue
        try:
            return json.loads(block[start : end + 1])
        except json.JSONDecodeError:
            continue
    return None


def describe_api_error(exc: Exception) -> str:
    """把 openai SDK 异常转成可排查的错误码描述（HTTP 状态码优先）。"""
    if isinstance(exc, LLMDeadlineExceeded):
        return "已超出生成时间预算"
    if isinstance(exc, APIStatusError):
        return f"HTTP {exc.status_code} {exc.message[:120]}"
    if isinstance(exc, APITimeoutError):
        return "请求超时（超过 LLM_TIMEOUT_SECONDS）"
    return f"{type(exc).__name__} {str(exc)[:120]}"


class LLMDeadlineExceeded(RuntimeError):
    """T20：本次调用开始前时间预算已耗尽（调用方据此走兜底，不再发请求）。"""


def _json_error_hint(text: str) -> str:
    """定位 JSON 解析失败点（供日志与修复重试使用）。"""
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return f"未找到 JSON 对象（输出长度 {len(text)}），开头: {text[:120]!r}"
    try:
        json.loads(text[start : end + 1])
        return "文本级解析通过（围栏/嵌套提取问题）"
    except json.JSONDecodeError as exc:
        ctx = text[max(0, exc.pos - 60) : exc.pos + 60].replace("\n", "⏎")
        return f"JSONDecodeError: {exc.msg} @{exc.pos} 附近: ...{ctx}..."


def _sanitize_history(history: list[dict] | None) -> list[dict]:
    """T24：会话历史只允许 user/assistant 且内容非空；任一项非法即**整段丢弃**（记 warning）。

    "整段丢弃"而非"跳过该项"：历史是与本次指令并列的上下文，掺半条不如不掺。
    """
    if not history:
        return []
    clean: list[dict] = []
    for item in history:
        role = item.get("role") if isinstance(item, dict) else None
        content = item.get("content") if isinstance(item, dict) else None
        if role not in ("user", "assistant") or not isinstance(content, str) or not content.strip():
            logger.warning("会话历史含非法轮次（role=%r），整段丢弃", role)
            return []
        clean.append({"role": role, "content": content})
    return clean


def build_client(
    profile: "ProviderProfile",
    api_format: str,
    *,
    api_key: str,
    base_url: str,
    timeout: float | None = None,
    http_client: Any | None = None,
) -> Any:
    """按协议族构造 SDK 客户端（**openai 族客户端在本包内的唯一构造点**）。

    两条 monkeypatch 契约（T48）：
    ① 生成链路 patch 的是 `app.services.llm.OpenAI` —— 这里的 OpenAI 必须保持
       **包命名空间的模块级绑定**。挪进子模块会让 patch 静默失效（测试改发真网络请求）；
    ② 诊断端点 patch 的是 `openai.OpenAI` —— 那条路径保持函数体内 import，不走本函数。

    认证方式与 anthropic-version 全部来自 profile 数据，这里没有厂商分支。
    `http_client` 是测试接缝（注入 httpx.MockTransport 做零网络表驱动测试）。
    """
    from .normalizer import merge_headers
    from .protocols.anthropic_msg import build_anthropic_client
    from .sdk_options import with_sdk_defaults

    headers = merge_headers(api_format, profile.header_overrides(api_format))
    if api_format == "anthropic":
        return build_anthropic_client(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
            auth=profile.auth(api_format),
            headers=headers,
            http_client=http_client,
        )
    kwargs: dict[str, Any] = {
        "base_url": base_url,
        "api_key": api_key,
        "default_headers": headers,
    }
    if timeout is not None:
        kwargs["timeout"] = timeout
    if http_client is not None:
        kwargs["http_client"] = http_client
    # T50：必须关掉 SDK 内部静默重试——重试策略由 LLMClient 统一负责（带预算感知、会写日志），
    # SDK 默认 max_retries=2 会把一次逻辑调用放大成 3 倍超时（实测 45s 预算跑出 137s）。
    return OpenAI(**with_sdk_defaults(kwargs))


class LLMClient:
    def __init__(self, mock_responder: Callable[[str, str], str] | None = None):
        self.settings = get_settings()
        self.mock_responder = mock_responder
        # T21：本次生成的全部模型调用记录（由调用方落库；不外发、不含用户文本）
        self.calls: list[dict] = []
        # T28：最近一次 JSON 解析失败的定位信息（供上层给出可排查的失败原因）
        self.last_json_error = ""
        # 运行时配置（前端 API 配置页保存）优先于 .env，立即生效
        from ...llm_runtime import get_runtime_config

        self.runtime = get_runtime_config()

    def note_skipped(self, kind: str, error_code: str) -> None:
        """T21/T22：没真正调用模型（预算耗尽 / 熔断打开）也记一条，保证"每次生成都有账"。"""
        self.calls.append(
            {
                "kind": kind,
                "model": "",
                "prompt_version": "",
                "tokens_in": 0,
                "tokens_out": 0,
                "latency_ms": 0,
                "ok": False,
                "error_code": error_code,
            }
        )

    def cfg(self, name: str):
        """读取配置：运行时（前端保存）> .env。"""
        value = self.runtime.get(name)
        if value not in (None, ""):
            return value
        return getattr(self.settings, name)

    @property
    def is_mock(self) -> bool:
        return self.cfg("llm_mode") != "real" or not self.cfg("llm_api_key")

    @property
    def target(self) -> tuple["ProviderProfile", str]:
        """当前生效的 (供应商预设, API 格式)。

        老配置缺这两个字段时，`llm_runtime.get_runtime_config` 已在读侧按 base_url
        反推补齐（现网 Kimi 档案由此拿到采样参数剔除策略）。
        """
        from .profiles import get_profile

        return get_profile(str(self.cfg("llm_provider") or "")), str(
            self.cfg("llm_api_format") or "chat"
        )

    def context_hint(self) -> str:
        """当前生效的「供应商 · 主机 · API 格式」。

        错误信息里带上它：曾经失败提示只有 `HTTP 401 …`，看不出**是哪家的 key 不对**
        （2026-09-18 实测踩过：地址是 DeepSeek、key 却属于别家，只能靠翻配置文件才定位）。
        """
        from .profiles import API_FORMAT_LABELS

        profile, api_format = self.target
        host = urlparse(str(self.cfg("llm_base_url") or "")).netloc or "未填地址"
        return f"{profile.label} · {host} · {API_FORMAT_LABELS.get(api_format, api_format)}"

    def _client_for(self, timeout: float | None) -> Any:
        """按当前预设/格式构造客户端——协议族决定用哪个 SDK（openai / anthropic）。"""
        profile, api_format = self.target
        return build_client(
            profile,
            api_format,
            api_key=str(self.cfg("llm_api_key") or ""),
            base_url=str(self.cfg("llm_base_url") or ""),
            timeout=timeout,
        )

    def _real_chat(
        self,
        system: str,
        user: str,
        temperature: float,
        history: list[dict] | None = None,
        deadline: Any | None = None,
        kind: str = "",
        prompt_version_override: str | None = None,
    ) -> str:
        # T20：单次调用超时不得超过剩余时间预算（预算耗尽则直接抛错，不再发请求）
        timeout = float(self.cfg("llm_timeout_seconds"))
        if deadline is not None:
            left = deadline.remaining()
            if left <= 0:
                raise LLMDeadlineExceeded("时间预算已耗尽")
            timeout = min(timeout, left)
        client = self._client_for(timeout)
        try:
            return self._create(client, self.cfg("llm_model"), system, user, temperature, history, kind, prompt_version_override=prompt_version_override)
        except APITimeoutError as exc:
            # 超时往往是一次性抖动：重试一次主模型，仍失败再切备用（备用超时减半，控制总时长）
            logger.warning("主模型超时（%s），重试一次", describe_api_error(exc))
            # 2026-09-17：重试前先看预算。原实现只在**入口**与备用超时上考虑预算，
            # 实测预算只剩 8s 时仍会发起 30s 的备用请求（最坏总耗时 8+8+30≈46s）。
            self._raise_if_expired(deadline)
            try:
                return self._create(client, self.cfg("llm_model"), system, user, temperature, history, kind, prompt_version_override=prompt_version_override)
            except Exception as exc2:  # noqa: BLE001
                logger.warning("重试仍失败，切备用模型: %s", describe_api_error(exc2))
                return self._create(
                    self._backup_client(deadline),
                    self.cfg("llm_backup_model"),
                    system,
                    user,
                    temperature,
                    history,
                    kind,
                    prompt_version_override=prompt_version_override,
                )
        except Exception as exc:  # noqa: BLE001 - 限流/鉴权等切备用模型
            logger.warning("主模型调用失败（%s），切备用模型", describe_api_error(exc))
            return self._create(
                self._backup_client(deadline),
                self.cfg("llm_backup_model"),
                system,
                user,
                temperature,
                history,
                kind,
            )

    @staticmethod
    def _raise_if_expired(deadline: Any | None) -> None:
        """预算耗尽就不再发起下一次请求（重试 / 备用同样受约束）。"""
        if deadline is not None and deadline.remaining() <= 0:
            raise LLMDeadlineExceeded("时间预算已耗尽")

    def _backup_client(self, deadline: Any | None = None) -> Any:
        """备用模型客户端：超时减半（如 60s → 30s），且**不得超过剩余预算**。

        2026-09-17 修：原来无论剩多少预算都固定用它（实测预算 8s 仍发 30s 的请求），
        与 `ai_gateway.GenerationDeadline` 的"整条链路时间预算"口径矛盾
        （也直接影响"生成耗时 ≤30s"这条指标）。
        """
        self._raise_if_expired(deadline)
        timeout = max(15.0, float(self.cfg("llm_timeout_seconds")) / 2)
        if deadline is not None:
            timeout = min(timeout, deadline.remaining())
        return self._client_for(timeout)

    def _create(
        self,
        client: Any,
        model: str,
        system: str,
        user: str,
        temperature: float,
        history: list[dict] | None = None,
        kind: str = "",
        *,
        profile: "ProviderProfile | None" = None,
        api_format: str | None = None,
        prompt_version_override: str | None = None,
    ) -> str:
        """发起一次调用并按当前 API 格式适配协议，成功/失败都记账。

        新增参数是 **keyword-only 带默认值**：既有调用点（含测试替身）的位置参数一字未变，
        不传时按当前配置解析（`_real_chat` 因此不必改调用点）。
        T24：多轮 = system + 历史轮次 + 本轮 user（历史为空则与旧行为逐字相同）。
        """
        from .dispatcher import resolve
        from .protocols.base import resolve_method

        if profile is None or api_format is None:
            resolved_profile, resolved_format = self.target
            profile = profile or resolved_profile
            api_format = api_format or resolved_format
        adapter, effective = resolve(profile, api_format)
        plan = adapter.build(
            profile=profile,
            model=model,
            system=system,
            user=user,
            history=history,
            temperature=temperature,
            max_tokens=self.cfg("llm_max_tokens"),  # 防输出截断导致 JSON 解析失败
        )
        started = time.perf_counter()
        try:
            invoke = resolve_method(client, plan.method)
            response = invoke(**plan.kwargs)
        except Exception as exc:  # 记账后原样抛出，由上层决定兜底/切备用
            self.calls.append(
                {
                    "kind": kind,
                    "model": model,
                    "prompt_version": prompt_version_override or prompt_version(system),
                    "tokens_in": 0,
                    "tokens_out": 0,
                    "latency_ms": int((time.perf_counter() - started) * 1000),
                    "ok": False,
                    "error_code": describe_api_error(exc),
                    # T48：内存键。三套机制相互独立——DB 写入按 _FIELDS 白名单取键（多余键
                    # 被忽略）；OTel span 是逐键 set_attribute，需另外显式加行才可见。
                    "api_format": effective,
                    "profile_id": profile.id,
                }
            )
            raise
        reply = adapter.parse(response)
        gen_logger = logging.getLogger("ai.gen")
        gen_logger.info(
            "LLM 返回 model=%s finish_reason=%s tokens=%s（输出 %d 字符）",
            reply.model or model,
            reply.finish_reason or "-",
            {"in": reply.tokens_in, "out": reply.tokens_out},
            len(reply.text),
        )
        self.calls.append(
            {
                "kind": kind,
                "model": reply.model or model,
                "prompt_version": prompt_version_override or prompt_version(system),
                "tokens_in": reply.tokens_in,
                "tokens_out": reply.tokens_out,
                "latency_ms": int((time.perf_counter() - started) * 1000),
                "ok": True,
                "error_code": "",
                "api_format": effective,
                "profile_id": profile.id,
            }
        )
        return reply.text

    def chat_text(
        self,
        system: str,
        user: str,
        temperature: float | None = None,
        history: list[dict] | None = None,
        deadline: Any | None = None,
        kind: str = "",
        prompt_version_override: str | None = None,
    ) -> str:
        if self.is_mock:
            return self.mock_responder(system, user) if self.mock_responder else ""
        # kind 用关键字传：测试替身只需接住已知参数 + **kwargs 即可，不必跟着改签名
        return self._real_chat(
            system,
            user,
            temperature or 0.3,
            _sanitize_history(history),
            deadline,
            kind=kind,
            prompt_version_override=prompt_version_override,
        )

    def chat_json(
        self,
        system: str,
        user: str,
        temperature: float | None = None,
        history: list[dict] | None = None,
        deadline: Any | None = None,
        kind: str = "",
        prompt_version_override: str | None = None,
    ) -> dict | None:
        """输出 JSON；解析失败重试 1 次，重试时把错误定位回传模型让其自纠（v2.2 §4.4）。"""
        clean_history = _sanitize_history(history)
        self.last_json_error = ""
        for attempt in range(2):
            text = self.chat_text(
                system, user, temperature, clean_history, deadline, kind, prompt_version_override
            )
            parsed = _extract_json(text)
            if parsed is not None:
                return parsed
            hint = _json_error_hint(text)
            self.last_json_error = hint
            logger.warning("LLM 输出非 JSON（第 %s 次）: %s", attempt + 1, hint)
            logger.warning("LLM 输出完整内容（%d 字符）: %s", len(text), text[:3000])
            if attempt == 1:
                # 两次都失败：完整输出落盘（分析长输出尾部的格式错误）
                from pathlib import Path

                dump = Path(get_settings().log_dir) / f"llm-output-{int(time.time())}.txt"
                try:
                    dump.write_text(text, encoding="utf-8")
                    logger.warning("两次输出均无法解析，完整输出已保存: %s", dump)
                except OSError:
                    pass
            if attempt == 0:
                # 第二次调用：告诉模型错误原因，要求只输出合法 JSON
                user = (
                    user
                    + f"\n\n注意：你上一次的输出不是合法 JSON（{hint}）。"
                    + "JSON 字符串中的引号必须正确转义（中文引号「」可直接使用，双引号 \" 必须转义为 \\\"）。"
                    + "请重新输出：只输出一个合法的 JSON 对象，不要任何其他内容。"
                )
        return None

    def any_response(self, system: str, user: str, temperature: float | None = None) -> str:
        """真实调用（mock 模式下返回空，由调用方走兜底）。"""
        if self.is_mock:
            return self.mock_responder(system, user) if self.mock_responder else ""
        return self._real_chat(system, user, temperature or 0.3)


def to_llm_dict(data: dict[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=False)
