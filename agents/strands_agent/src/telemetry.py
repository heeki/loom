"""OpenTelemetry instrumentation for the Loom Strands agent.

Provides application-level tracing spans for invocations, tool calls,
and model calls.  Provider configuration (exporters, resource, etc.)
is handled by the ``opentelemetry-instrument`` CLI wrapper that
AgentCore Runtime uses as the process entry point.  When running
locally without the wrapper the OpenTelemetry API falls back to
noop providers automatically.

The ``setup_telemetry()`` function only installs the log-context
filter — it does NOT create its own TracerProvider/MeterProvider
because that would conflict with the providers already configured
by ``opentelemetry-instrument``.
"""

import logging
from contextlib import contextmanager
from typing import Any, Generator, Optional

from opentelemetry import trace
from opentelemetry.trace import Span, StatusCode

logger = logging.getLogger(__name__)

_TRACER_SCOPE = "loom.strands_agent"
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
    """Install the trace-context log filter.

    Provider configuration (TracerProvider, MeterProvider, exporters)
    is handled externally by the ``opentelemetry-instrument`` wrapper
    that AgentCore Runtime uses as the process entry point.  This
    function only adds the log filter for trace context propagation.

    Safe to call multiple times — subsequent calls are no-ops.
    """
    global _telemetry_initialized
    if _telemetry_initialized:
        return

    _install_log_filter()
    _telemetry_initialized = True
    logger.info("Telemetry log filter installed")


def _install_log_filter() -> None:
    """Add trace-context filter to the root logger."""
    root = logging.getLogger()
    root.addFilter(_TraceContextFilter())


def get_tracer() -> trace.Tracer:
    """Return a tracer scoped to the strands agent."""
    return trace.get_tracer(_TRACER_SCOPE)


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


# ---------------------------------------------------------------------------
# Strands Agent telemetry hook
# ---------------------------------------------------------------------------

class TelemetryHook:
    """Strands Agent hook that creates OTEL spans for tool and model calls."""

    def __init__(self) -> None:
        self._tool_spans: dict[str, Span] = {}
        self._model_spans: dict[int, Span] = {}
        self._model_call_counter: int = 0

    def before_tool_use(self, tool_name: str, **kwargs: Any) -> None:
        tracer = get_tracer()
        span = tracer.start_span("tool.call", attributes={"tool.name": tool_name})
        self._tool_spans[tool_name] = span

    def after_tool_use(self, tool_name: str, result: Any = None, error: Exception | None = None, **kwargs: Any) -> None:
        span = self._tool_spans.pop(tool_name, None)
        if span:
            if error:
                span.set_status(StatusCode.ERROR, str(error))
                span.record_exception(error)
            span.end()

    def before_model_invoke(self, **kwargs: Any) -> None:
        tracer = get_tracer()
        model_id = kwargs.get("model_id", "unknown")
        self._model_call_counter += 1
        span = tracer.start_span("model.call", attributes={"model.id": model_id})
        self._model_spans[self._model_call_counter] = span

    def after_model_invoke(self, result: Any = None, error: Exception | None = None, **kwargs: Any) -> None:
        if self._model_spans:
            key = max(self._model_spans.keys())
            span = self._model_spans.pop(key, None)
            if span:
                if error:
                    span.set_status(StatusCode.ERROR, str(error))
                    span.record_exception(error)
                span.end()
