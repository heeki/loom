"""Tests for telemetry module."""

import unittest
from typing import Sequence
from unittest.mock import patch, MagicMock

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider, ReadableSpan
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, SpanExporter, SpanExportResult
from opentelemetry.trace import StatusCode

import src.telemetry as telemetry_module
from src.telemetry import (
    setup_telemetry,
    trace_invocation,
    trace_tool_call,
    trace_model_call,
    TelemetryHook,
)


class _InMemorySpanExporter(SpanExporter):
    """Simple in-memory exporter that collects finished spans."""

    def __init__(self) -> None:
        self._spans: list[ReadableSpan] = []

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        self._spans.extend(spans)
        return SpanExportResult.SUCCESS

    def get_finished_spans(self) -> list[ReadableSpan]:
        return list(self._spans)

    def shutdown(self) -> None:
        self._spans.clear()


class _OtelTestBase(unittest.TestCase):
    """Base class that patches get_tracer to use a test TracerProvider."""

    def setUp(self) -> None:
        telemetry_module._telemetry_initialized = False
        self.exporter = _InMemorySpanExporter()
        self.provider = TracerProvider()
        self.provider.add_span_processor(SimpleSpanProcessor(self.exporter))
        # Patch get_tracer so the telemetry module uses our test provider
        self._patcher = patch.object(
            telemetry_module, "get_tracer",
            return_value=self.provider.get_tracer("test"),
        )
        self._patcher.start()

    def tearDown(self) -> None:
        self._patcher.stop()
        self.provider.shutdown()
        telemetry_module._telemetry_initialized = False


class TestSetupTelemetry(unittest.TestCase):
    """Tests for setup_telemetry()."""

    def setUp(self) -> None:
        telemetry_module._telemetry_initialized = False

    def tearDown(self) -> None:
        telemetry_module._telemetry_initialized = False

    def test_setup_succeeds(self) -> None:
        """setup_telemetry() installs the log filter without error."""
        setup_telemetry()
        self.assertTrue(telemetry_module._telemetry_initialized)

    def test_idempotency(self) -> None:
        """Calling setup_telemetry() twice should be a no-op the second time."""
        setup_telemetry()
        self.assertTrue(telemetry_module._telemetry_initialized)

        with patch.object(telemetry_module, "_install_log_filter") as mock_filter:
            setup_telemetry()
            mock_filter.assert_not_called()


class TestTraceInvocation(_OtelTestBase):
    """Tests for trace_invocation context manager."""

    def test_creates_span_with_invocation_id(self) -> None:
        with trace_invocation(invocation_id="test-123") as span:
            self.assertIsNotNone(span)

        spans = self.exporter.get_finished_spans()
        self.assertEqual(len(spans), 1)
        self.assertEqual(spans[0].name, "agent.invocation")
        self.assertEqual(spans[0].attributes["agent.invocation_id"], "test-123")

    def test_creates_span_without_invocation_id(self) -> None:
        with trace_invocation() as span:
            self.assertIsNotNone(span)

        spans = self.exporter.get_finished_spans()
        self.assertEqual(len(spans), 1)
        self.assertNotIn("agent.invocation_id", spans[0].attributes)

    def test_records_exception_on_error(self) -> None:
        with self.assertRaises(RuntimeError):
            with trace_invocation(invocation_id="err-1"):
                raise RuntimeError("boom")

        spans = self.exporter.get_finished_spans()
        self.assertEqual(len(spans), 1)
        self.assertEqual(spans[0].status.status_code, StatusCode.ERROR)


class TestTraceToolCall(_OtelTestBase):
    """Tests for trace_tool_call context manager."""

    def test_creates_span_with_tool_name(self) -> None:
        with trace_tool_call("my_tool") as span:
            self.assertIsNotNone(span)

        spans = self.exporter.get_finished_spans()
        self.assertEqual(len(spans), 1)
        self.assertEqual(spans[0].name, "tool.call")
        self.assertEqual(spans[0].attributes["tool.name"], "my_tool")

    def test_records_exception_on_error(self) -> None:
        with self.assertRaises(ValueError):
            with trace_tool_call("bad_tool"):
                raise ValueError("tool failed")

        spans = self.exporter.get_finished_spans()
        self.assertEqual(spans[0].status.status_code, StatusCode.ERROR)


class TestTraceModelCall(_OtelTestBase):
    """Tests for trace_model_call context manager."""

    def test_creates_span_with_model_id(self) -> None:
        with trace_model_call("claude-v3") as span:
            self.assertIsNotNone(span)

        spans = self.exporter.get_finished_spans()
        self.assertEqual(len(spans), 1)
        self.assertEqual(spans[0].name, "model.call")
        self.assertEqual(spans[0].attributes["model.id"], "claude-v3")


class TestTelemetryHook(_OtelTestBase):
    """Tests for TelemetryHook class."""

    def test_before_after_tool_use_creates_span(self) -> None:
        hook = TelemetryHook()
        hook.before_tool_use("calculator")
        hook.after_tool_use("calculator", result="42")

        spans = self.exporter.get_finished_spans()
        self.assertEqual(len(spans), 1)
        self.assertEqual(spans[0].name, "tool.call")
        self.assertEqual(spans[0].attributes["tool.name"], "calculator")

    def test_after_tool_use_with_error_sets_error_status(self) -> None:
        hook = TelemetryHook()
        err = RuntimeError("tool exploded")
        hook.before_tool_use("bad_tool")
        hook.after_tool_use("bad_tool", error=err)

        spans = self.exporter.get_finished_spans()
        self.assertEqual(len(spans), 1)
        self.assertEqual(spans[0].status.status_code, StatusCode.ERROR)

    def test_before_after_model_invoke_creates_span(self) -> None:
        hook = TelemetryHook()
        hook.before_model_invoke(model_id="claude-v3")
        hook.after_model_invoke(result="response")

        spans = self.exporter.get_finished_spans()
        self.assertEqual(len(spans), 1)
        self.assertEqual(spans[0].name, "model.call")
        self.assertEqual(spans[0].attributes["model.id"], "claude-v3")

    def test_after_model_invoke_with_error_sets_error_status(self) -> None:
        hook = TelemetryHook()
        hook.before_model_invoke(model_id="claude-v3")
        hook.after_model_invoke(error=RuntimeError("model failed"))

        spans = self.exporter.get_finished_spans()
        self.assertEqual(len(spans), 1)
        self.assertEqual(spans[0].status.status_code, StatusCode.ERROR)

    def test_after_tool_use_without_before_is_safe(self) -> None:
        hook = TelemetryHook()
        hook.after_tool_use("unknown_tool", result="ok")

    def test_after_model_invoke_without_before_is_safe(self) -> None:
        hook = TelemetryHook()
        hook.after_model_invoke(result="ok")


class TestNoopOperations(unittest.TestCase):
    """Verify tracing operations succeed even without setup (noop mode)."""

    def setUp(self) -> None:
        telemetry_module._telemetry_initialized = False

    def tearDown(self) -> None:
        telemetry_module._telemetry_initialized = False

    def test_trace_invocation_noop(self) -> None:
        with trace_invocation(invocation_id="noop-1") as span:
            self.assertIsNotNone(span)

    def test_trace_tool_call_noop(self) -> None:
        with trace_tool_call("noop_tool") as span:
            self.assertIsNotNone(span)

    def test_trace_model_call_noop(self) -> None:
        with trace_model_call("noop_model") as span:
            self.assertIsNotNone(span)


if __name__ == "__main__":
    unittest.main()
