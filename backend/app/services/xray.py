"""AWS X-Ray trace retrieval service."""
import logging
from datetime import datetime
from typing import Any

import boto3

logger = logging.getLogger(__name__)


def get_trace_summaries(
    region: str,
    start_time: datetime,
    end_time: datetime,
    filter_expression: str | None = None,
) -> list[dict[str, Any]]:
    """Query X-Ray trace summaries within a time window.

    Args:
        region: AWS region.
        start_time: Start of the time window.
        end_time: End of the time window.
        filter_expression: Optional X-Ray filter expression.

    Returns:
        List of trace summary dicts from X-Ray.
    """
    client = boto3.client("xray", region_name=region)
    params: dict[str, Any] = {
        "StartTime": start_time,
        "EndTime": end_time,
    }
    if filter_expression:
        params["FilterExpression"] = filter_expression

    summaries: list[dict[str, Any]] = []
    try:
        response = client.get_trace_summaries(**params)
        summaries.extend(response.get("TraceSummaries", []))
        while response.get("NextToken"):
            params["NextToken"] = response["NextToken"]
            response = client.get_trace_summaries(**params)
            summaries.extend(response.get("TraceSummaries", []))
    except Exception:
        logger.exception("Failed to query X-Ray trace summaries")

    return summaries


def get_trace_summaries_for_invocations(
    region: str,
    invocation_ids: list[str],
    start_time: datetime,
    end_time: datetime,
) -> list[dict[str, Any]]:
    """Query X-Ray trace summaries matching a list of invocation IDs.

    Uses the ``annotation.agent_invocation_id`` filter which corresponds
    to the OTEL attribute set in ``telemetry.py``.

    Args:
        region: AWS region.
        invocation_ids: Invocation IDs to search for.
        start_time: Start of the time window.
        end_time: End of the time window.

    Returns:
        Deduplicated list of trace summaries.
    """
    seen_trace_ids: set[str] = set()
    results: list[dict[str, Any]] = []

    for inv_id in invocation_ids:
        filter_expr = f'annotation.agent_invocation_id = "{inv_id}"'
        summaries = get_trace_summaries(region, start_time, end_time, filter_expr)
        for s in summaries:
            tid = s.get("Id", "")
            if tid and tid not in seen_trace_ids:
                seen_trace_ids.add(tid)
                results.append(s)

    return results


def batch_get_traces(
    region: str,
    trace_ids: list[str],
) -> list[dict[str, Any]]:
    """Retrieve full trace data for a list of trace IDs.

    Args:
        region: AWS region.
        trace_ids: X-Ray trace IDs to retrieve.

    Returns:
        List of trace dicts with segments.
    """
    if not trace_ids:
        return []

    client = boto3.client("xray", region_name=region)
    traces: list[dict[str, Any]] = []

    # X-Ray batch_get_traces accepts up to 5 IDs at a time
    for i in range(0, len(trace_ids), 5):
        batch = trace_ids[i : i + 5]
        try:
            response = client.batch_get_traces(TraceIds=batch)
            traces.extend(response.get("Traces", []))
            while response.get("NextToken"):
                response = client.batch_get_traces(
                    TraceIds=batch, NextToken=response["NextToken"]
                )
                traces.extend(response.get("Traces", []))
        except Exception:
            logger.exception("Failed to retrieve traces: %s", batch)

    return traces


def _classify_span_type(name: str) -> str:
    """Classify a span name into a type category."""
    if name == "agent.invocation":
        return "invocation"
    if name == "model.call":
        return "model"
    if name == "tool.call":
        return "tool"
    return "other"


def parse_trace_to_spans(
    trace: dict[str, Any],
) -> list[dict[str, Any]]:
    """Parse an X-Ray trace into a flat list of span dicts.

    X-Ray traces contain segments, each of which may have nested
    subsegments. This flattens the tree into a list with parent
    references.

    Args:
        trace: A single trace dict from ``batch_get_traces``.

    Returns:
        Flat list of span dicts with keys:
        span_id, parent_span_id, name, span_type, start_time,
        end_time, duration_ms, status, attributes.
    """
    import json

    spans: list[dict[str, Any]] = []

    for segment_doc in trace.get("Segments", []):
        raw = segment_doc.get("Document")
        if not raw:
            continue
        try:
            seg = json.loads(raw) if isinstance(raw, str) else raw
        except (json.JSONDecodeError, TypeError):
            continue

        _flatten_segment(seg, parent_id=None, spans=spans)

    return spans


def _flatten_segment(
    segment: dict[str, Any],
    parent_id: str | None,
    spans: list[dict[str, Any]],
) -> None:
    """Recursively flatten a segment and its subsegments."""
    span_id = segment.get("id", "")
    name = segment.get("name", "unknown")
    start = segment.get("start_time", 0.0)
    end = segment.get("end_time", 0.0)
    duration_ms = round((end - start) * 1000, 2)

    has_error = segment.get("error", False) or segment.get("fault", False)
    status = "error" if has_error else "ok"

    # Merge annotations and metadata into attributes
    attributes: dict[str, str] = {}
    for k, v in segment.get("annotations", {}).items():
        attributes[k] = str(v)
    for ns_data in segment.get("metadata", {}).values():
        if isinstance(ns_data, dict):
            for k, v in ns_data.items():
                attributes[k] = str(v)

    spans.append({
        "span_id": span_id,
        "parent_span_id": parent_id,
        "name": name,
        "span_type": _classify_span_type(name),
        "start_time": start,
        "end_time": end,
        "duration_ms": duration_ms,
        "status": status,
        "attributes": attributes,
    })

    for sub in segment.get("subsegments", []):
        _flatten_segment(sub, parent_id=span_id, spans=spans)
