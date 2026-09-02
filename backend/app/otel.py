"""OpenTelemetry 初始化：OTLP HTTP → Jaeger（v2.2 §10，半天接入）。

生成链路 span 命名（与算法角色约定一致）：
intent_parse / template_match / param_fill / compliance_check
"""
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from .config import get_settings

_SERVICE_NAME = "ai-native-design-backend"


def init_otel() -> None:
    settings = get_settings()
    if not settings.otel_exporter_otlp_endpoint:
        return  # 未配置则不启用，避免本地开发噪音
    provider = TracerProvider(
        resource=Resource.create({"service.name": _SERVICE_NAME})
    )
    exporter = OTLPSpanExporter(endpoint=f"{settings.otel_exporter_otlp_endpoint}/v1/traces")
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)


def get_tracer():
    return trace.get_tracer(_SERVICE_NAME)
