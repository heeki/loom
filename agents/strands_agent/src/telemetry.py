"""OpenTelemetry instrumentation for the Loom Strands agent.

Provides tracing, metrics, and structured logging with trace context
using AWS Distro for OpenTelemetry (ADOT). Operates in noop mode when
OTEL_EXPORTER_OTLP_ENDPOINT is not configured.
"""

import logging
import os
from contextlib import contextmanager
from typing import Generator, Optional

from opentelemetry import trace, metrics
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.trace import Span, StatusCode

logger = logging.getLogger(__name__)

_SERVICE_NAME_DEFAULT = "loom-agent"
_TRACER_SCOPE = "loom.strands_agent"
_METER_SCOPE = "loom.strands_agent"
_telemetry_initialized = False


class _TraceContextFilter(logging.Filter):
    """Injects trace context into log records."""

    def filter(self, record: logging.LogRecord) -> bool:
        span = trace.get_current_span()
        ctx = span.get_span_context()
        if ctx and ctx.is_valid:
            record.trace_id = format(ctx.trace_id, "032x")
            record.span_id = format(ctx.span_id, "016x")
            record.trace_flags = format(ctx.trace_flags, "02x")
        else:
            record.trace_id = "0" * 32
            record.span_id = "0" * 16
            record.trace_flags = "00"
        return True


def setup_telemetry() -> None:
    """Initialise OpenTelemetry tracing, metrics, and logging.

    Reads configuration from environment variables:
      - ``OTEL_SERVICE_NAME`` – logical service name (default ``loom-agent``)
      - ``OTEL_EXPORTER_OTLP_ENDPOINT`` – OTLP gRPC endpoint

    When the endpoint is not set the function configures noop providers so
    that call-sites can use the same API without branching.
    """
    global _telemetry_initialized
    if _telemetry_initialized:
        return

    service_name = os.environ.get("OTEL_SERVICE_NAME", _SERVICE_NAME_DEFAULT)
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")

    resource = Resource.create({"service.name": service_name})

    if endpoint:
        _setup_active(resource, endpoint)
        logger.info("OpenTelemetry initialised (endpoint=%s, service=%s)", endpoint, service_name)
    else:
        logger.info("OTEL_EXPORTER_OTLP_ENDPOINT not set; telemetry in noop mode")

    _install_log_filter()
    _telemetry_initialized = True


def _setup_active(resource: Resource, endpoint: str) -> None:
    """Wire up real exporters for traces and metrics."""
    # Traces
    tracer_provider = TracerProvider(resource=resource)
    span_exporter = OTLPSpanExporter(endpoint=endpoint, insecure=True)
    tracer_provider.add_span_processor(BatchSpanProcessor(span_exporter))
    trace.set_tracer_provider(tracer_provider)

    # Metrics
    metric_exporter = OTLPMetricExporter(endpoint=endpoint, insecure=True)
    reader = PeriodicExportingMetricReader(metric_exporter)
    meter_provider = MeterProvider(resource=resource, metric_readers=[reader])
    metrics.set_meter_provider(meter_provider)


def _install_log_filter() -> None:
    """Add trace-context filter to the root logger."""
    root = logging.getLogger()
    root.addFilter(_TraceContextFilter())


def get_tracer() -> trace.Tracer:
    """Return a tracer scoped to the strands agent."""
    return trace.get_tracer(_TRACER_SCOPE)


def get_meter() -> metrics.Meter:
    """Return a meter scoped to the strands agent."""
    return metrics.get_meter(_METER_SCOPE)


# ---------------------------------------------------------------------------
# Convenience context managers for common span patterns
# ---------------------------------------------------------------------------

@contextmanager
def trace_invocation(
    invocation_id: Optional[str] = None,
) -> Generator[Span, None, None]:
    """Create a span that wraps a full agent invocation.

    Args:
        invocation_id: Optional identifier for the invocation.

    Yields:
        The active ``Span`` so callers can annotate it further.
    """
    tracer = get_tracer()
    attributes: dict[str, str] = {}
    if invocation_id:
        attributes["agent.invocation_id"] = invocation_id

    with tracer.start_as_current_span(
        "agent.invocation", attributes=attributes
    ) as span:
        try:
            yield span
        except Exception as exc:
            span.set_status(StatusCode.ERROR, str(exc))
            span.record_exception(exc)
            raise


@contextmanager
def trace_tool_call(tool_name: str) -> Generator[Span, None, None]:
    """Create a child span for an MCP tool call.

    Args:
        tool_name: Name of the tool being invoked.

    Yields:
        The active ``Span``.
    """
    tracer = get_tracer()
    with tracer.start_as_current_span(
        "tool.call", attributes={"tool.name": tool_name}
    ) as span:
        try:
            yield span
        except Exception as exc:
            span.set_status(StatusCode.ERROR, str(exc))
            span.record_exception(exc)
            raise


@contextmanager
def trace_model_call(model_id: str) -> Generator[Span, None, None]:
    """Create a child span for a model / LLM call.

    Args:
        model_id: Identifier of the model being called.

    Yields:
        The active ``Span``.
    """
    tracer = get_tracer()
    with tracer.start_as_current_span(
        "model.call", attributes={"model.id": model_id}
    ) as span:
        try:
            yield span
        except Exception as exc:
            span.set_status(StatusCode.ERROR, str(exc))
            span.record_exception(exc)
            raise
