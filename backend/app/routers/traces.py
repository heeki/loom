"""Trace retrieval endpoints for X-Ray observability data."""
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies.auth import UserInfo, require_scopes
from app.models.agent import Agent
from app.models.session import InvocationSession
from app.models.invocation import Invocation
from app.services.xray import (
    batch_get_traces,
    get_trace_summaries_for_invocations,
    parse_trace_to_spans,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agents", tags=["traces"])


# ---------------------------------------------------------------------------
# Pydantic response models
# ---------------------------------------------------------------------------

class SpanSummary(BaseModel):
    """A single span within a trace."""
    span_id: str
    parent_span_id: Optional[str]
    name: str
    span_type: str
    start_time_iso: str
    end_time_iso: str
    duration_ms: float
    status: str
    attributes: dict[str, str]


class TraceSummary(BaseModel):
    """Summary of a single trace."""
    trace_id: str
    root_span_name: str
    start_time_iso: str
    duration_ms: float
    span_count: int
    status: str
    invocation_id: Optional[str]


class TraceListResponse(BaseModel):
    """Response containing a list of trace summaries."""
    traces: List[TraceSummary]


class TraceDetailResponse(BaseModel):
    """Full trace detail with all spans."""
    trace_id: str
    root_span_name: str
    start_time_iso: str
    duration_ms: float
    span_count: int
    status: str
    spans: List[SpanSummary]


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _epoch_to_iso(epoch: float) -> str:
    """Convert epoch seconds to UTC ISO 8601 string."""
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()


def _xray_summary_to_trace_summary(
    summary: dict,
    invocation_id: str | None = None,
) -> TraceSummary:
    """Convert an X-Ray trace summary dict to a TraceSummary model."""
    start = summary.get("ResponseTime", summary.get("StartTime"))
    duration_s = summary.get("Duration", 0.0)
    has_error = summary.get("HasError", False) or summary.get("HasFault", False)

    # Extract invocation_id from annotations if available
    annotations = summary.get("Annotations", {})
    inv_id = invocation_id
    if not inv_id:
        ann_values = annotations.get("agent_invocation_id", [])
        if ann_values and isinstance(ann_values, list):
            for av in ann_values:
                if isinstance(av, dict) and "AnnotationValue" in av:
                    val = av["AnnotationValue"]
                    if isinstance(val, dict):
                        inv_id = val.get("StringValue", "")
                    else:
                        inv_id = str(val)
                    break

    root_name = "agent.invocation"
    # Attempt to get root segment name from service IDs
    service_ids = summary.get("ServiceIds", [])
    if service_ids and isinstance(service_ids[0], dict):
        root_name = service_ids[0].get("Name", root_name)

    start_iso = ""
    if isinstance(start, datetime):
        start_iso = start.isoformat()
    elif isinstance(start, (int, float)):
        start_iso = _epoch_to_iso(start)

    return TraceSummary(
        trace_id=summary.get("Id", ""),
        root_span_name=root_name,
        start_time_iso=start_iso,
        duration_ms=round(duration_s * 1000, 2),
        span_count=len(summary.get("EntryPoint", {}).get("ServiceIds", [])) or 1,
        status="error" if has_error else "ok",
        invocation_id=inv_id,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get(
    "/{agent_id}/sessions/{session_id}/traces",
    response_model=TraceListResponse,
)
def get_session_traces(
    agent_id: int,
    session_id: str,
    user: UserInfo = Depends(require_scopes("agent:read")),
    db: Session = Depends(get_db),
) -> TraceListResponse:
    """List traces for all invocations in a session."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found")

    session = (
        db.query(InvocationSession)
        .filter(InvocationSession.session_id == session_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    invocations = (
        db.query(Invocation)
        .filter(Invocation.session_id == session_id)
        .order_by(Invocation.created_at.asc())
        .all()
    )
    if not invocations:
        return TraceListResponse(traces=[])

    inv_ids = [inv.invocation_id for inv in invocations if inv.invocation_id]
    if not inv_ids:
        return TraceListResponse(traces=[])

    # Build time window from invocation timestamps with a buffer
    earliest = min(
        inv.client_invoke_time or inv.created_at.timestamp()
        for inv in invocations
    )
    latest = max(
        inv.client_done_time or inv.created_at.timestamp()
        for inv in invocations
    )
    start_dt = datetime.fromtimestamp(earliest - 60, tz=timezone.utc)
    end_dt = datetime.fromtimestamp(latest + 300, tz=timezone.utc)

    # Build invocation_id -> invocation_id mapping for correlation
    inv_id_set = set(inv_ids)

    summaries = get_trace_summaries_for_invocations(
        region=agent.region,
        invocation_ids=inv_ids,
        start_time=start_dt,
        end_time=end_dt,
    )

    traces = []
    for s in summaries:
        # Try to find which invocation this trace belongs to
        matched_inv_id: str | None = None
        annotations = s.get("Annotations", {})
        ann_values = annotations.get("agent_invocation_id", [])
        if ann_values and isinstance(ann_values, list):
            for av in ann_values:
                val_str = ""
                if isinstance(av, dict) and "AnnotationValue" in av:
                    av_inner = av["AnnotationValue"]
                    if isinstance(av_inner, dict):
                        val_str = av_inner.get("StringValue", "")
                    else:
                        val_str = str(av_inner)
                if val_str in inv_id_set:
                    matched_inv_id = val_str
                    break

        traces.append(_xray_summary_to_trace_summary(s, matched_inv_id))

    return TraceListResponse(traces=traces)


@router.get(
    "/{agent_id}/traces/{trace_id}",
    response_model=TraceDetailResponse,
)
def get_trace_detail(
    agent_id: int,
    trace_id: str,
    user: UserInfo = Depends(require_scopes("agent:read")),
    db: Session = Depends(get_db),
) -> TraceDetailResponse:
    """Get full trace detail with all spans."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found")

    raw_traces = batch_get_traces(region=agent.region, trace_ids=[trace_id])
    if not raw_traces:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trace not found")

    trace = raw_traces[0]
    flat_spans = parse_trace_to_spans(trace)

    if not flat_spans:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trace has no spans")

    # Find the root span (no parent or the earliest one)
    root = flat_spans[0]
    for s in flat_spans:
        if s["parent_span_id"] is None:
            root = s
            break

    total_duration = root["duration_ms"]
    has_error = any(s["status"] == "error" for s in flat_spans)

    span_models = [
        SpanSummary(
            span_id=s["span_id"],
            parent_span_id=s["parent_span_id"],
            name=s["name"],
            span_type=s["span_type"],
            start_time_iso=_epoch_to_iso(s["start_time"]),
            end_time_iso=_epoch_to_iso(s["end_time"]),
            duration_ms=s["duration_ms"],
            status=s["status"],
            attributes=s["attributes"],
        )
        for s in flat_spans
    ]

    return TraceDetailResponse(
        trace_id=trace_id,
        root_span_name=root["name"],
        start_time_iso=_epoch_to_iso(root["start_time"]),
        duration_ms=total_duration,
        span_count=len(flat_spans),
        status="error" if has_error else "ok",
        spans=span_models,
    )
