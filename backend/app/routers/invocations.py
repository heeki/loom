"""Agent invocation endpoints with SSE streaming support."""
import asyncio
import json
import logging
import os
import time
import uuid
from datetime import datetime
from typing import Any, List, AsyncGenerator
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

import threading

from app.db import get_db, SessionLocal
from app.dependencies.auth import UserInfo, require_scopes
from app.models.agent import Agent
from app.models.session import InvocationSession
from app.models.invocation import Invocation
from app.models.authorizer_config import AuthorizerConfig
from app.models.authorizer_credential import AuthorizerCredential

from app.services.agentcore import invoke_agent
from app.services.cloudwatch import (
    get_log_events, get_usage_log_events,
    parse_agent_start_time, parse_agentcore_request_id,
    parse_memory_telemetry, parse_usage_telemetry,
)
from app.services.cognito import get_cognito_token
from app.services.latency import compute_client_duration, compute_cold_start
from app.services.secrets import get_secret
from app.services.tokens import count_input_tokens, count_output_tokens
from app.routers.agents import derive_log_group


router = APIRouter(prefix="/api/agents", tags=["invocations"])


# Pydantic models
class InvokeRequest(BaseModel):
    """Request body for agent invocation."""
    prompt: str = Field(..., description="Prompt to send to the agent")
    qualifier: str = Field(default="DEFAULT", description="Endpoint qualifier to use")
    session_id: str | None = Field(default=None, description="Existing session ID to reuse (runtimeSessionId)")
    credential_id: int | None = Field(default=None, description="Authorizer credential ID for token generation")
    bearer_token: str | None = Field(default=None, description="Manual bearer token for agent invocation")


class InvocationResponse(BaseModel):
    """Response model for invocation details."""
    id: int
    session_id: str
    invocation_id: str
    request_id: str | None = None
    client_invoke_time: float | None
    client_done_time: float | None
    agent_start_time: float | None
    cold_start_latency_ms: float | None
    client_duration_ms: float | None
    status: str
    error_message: str | None
    input_tokens: int | None = None
    output_tokens: int | None = None
    estimated_cost: float | None = None
    compute_cost: float | None = None
    compute_cpu_cost: float | None = None
    compute_memory_cost: float | None = None
    idle_timeout_cost: float | None = None
    idle_cpu_cost: float | None = None
    idle_memory_cost: float | None = None
    memory_retrievals: int | None = None
    memory_events_sent: int | None = None
    memory_estimated_cost: float | None = None
    stm_cost: float | None = None
    ltm_cost: float | None = None
    cost_source: str | None = None
    prompt_text: str | None = None
    thinking_text: str | None = None
    response_text: str | None = None
    created_at: str | None


class SessionResponse(BaseModel):
    """Response model for session details."""
    agent_id: int
    session_id: str
    qualifier: str
    status: str
    live_status: str
    created_at: str | None
    invocations: List[InvocationResponse]


def compute_live_status(session: InvocationSession, db: Session) -> str:
    """
    Compute the live status of a session based on its status and timing data.

    Returns "pending", "streaming", "active", or "expired".

    Sessions stuck in ``pending`` or ``streaming`` longer than the idle
    timeout are automatically transitioned to ``error`` so they do not
    remain in a stale state indefinitely.
    """
    timeout_seconds = int(os.getenv("LOOM_SESSION_IDLE_TIMEOUT_SECONDS", "300"))

    if session.status in ("pending", "streaming"):
        # If the session has been pending/streaming longer than the idle
        # timeout, it is stuck — transition to error.
        if session.created_at:
            age = (datetime.utcnow() - session.created_at).total_seconds()
            if age > timeout_seconds:
                logger.warning(
                    "Session %s stuck in '%s' for %.0fs; marking as error",
                    session.session_id, session.status, age,
                )
                session.status = "error"
                # Also mark any pending/streaming invocations as error
                stuck_invocations = db.query(Invocation).filter(
                    Invocation.session_id == session.session_id,
                    Invocation.status.in_(("pending", "streaming")),
                ).all()
                for inv in stuck_invocations:
                    inv.status = "error"
                    inv.error_message = "Session timed out in pending/streaming state"
                db.commit()
                return "expired"
        return session.status

    max_done_time = db.query(func.max(Invocation.client_done_time)).filter(
        Invocation.session_id == session.session_id
    ).scalar()

    if max_done_time is not None:
        if (time.time() - max_done_time) < timeout_seconds:
            return "active"
        return "expired"

    # No client_done_time — fall back to created_at
    if session.created_at:
        if (datetime.utcnow() - session.created_at).total_seconds() < timeout_seconds:
            return "active"
    return "expired"


def _get_io_discount(db: Session) -> float:
    """Get the configured CPU I/O wait discount."""
    from app.routers.settings import get_cpu_io_wait_discount
    return get_cpu_io_wait_discount(db)


def _apply_view_time_costs(inv_dict: dict, io_discount: float) -> dict:
    """Recompute runtime costs at view time using current pricing defaults.

    When client_duration_ms is available, CPU and memory costs are recomputed
    from duration so that pricing constant changes affect all historical data.
    Falls back to applying only the I/O wait discount on stored CPU cost.
    """
    from app.routers.agents import AGENTCORE_RUNTIME_PRICING
    duration_ms = inv_dict.get("client_duration_ms")
    if duration_ms is not None and duration_ms > 0:
        hours = duration_ms / 1000 / 3600
        raw_cpu = hours * AGENTCORE_RUNTIME_PRICING["default_vcpu"] * AGENTCORE_RUNTIME_PRICING["cpu_per_vcpu_hour"]
        inv_dict["compute_cpu_cost"] = round(raw_cpu * (1.0 - io_discount), 6)
        inv_dict["compute_memory_cost"] = round(hours * AGENTCORE_RUNTIME_PRICING["default_memory_gb"] * AGENTCORE_RUNTIME_PRICING["memory_per_gb_hour"], 6)
    else:
        raw = inv_dict.get("compute_cpu_cost")
        if raw is not None:
            inv_dict["compute_cpu_cost"] = round(raw * (1.0 - io_discount), 6)
    return inv_dict


def _backfill_idle_costs(session: InvocationSession, live_status: str, db: Session) -> None:
    """Backfill idle memory cost on invocations. Idle cost is memory-only.

    Two scenarios:
      1. Between invocations: a completed invoke is followed by another invoke
         before the session times out. Idle duration = next.client_invoke_time
         minus current.client_done_time, capped at idle_timeout_seconds.
      2. Last invocation + session expired: the session has fully idled out.
         Idle duration = idle_timeout_seconds.
    """
    invocations = db.query(Invocation).filter(
        Invocation.session_id == session.session_id,
        Invocation.status.in_(("complete", "streaming", "pending")),
    ).order_by(Invocation.client_done_time.asc().nullslast()).all()

    completed = [inv for inv in invocations if inv.status == "complete" and inv.client_done_time]
    if not completed:
        return

    from app.routers.agents import AGENTCORE_RUNTIME_PRICING
    idle_timeout_seconds = int(os.getenv(
        "LOOM_SESSION_IDLE_TIMEOUT_SECONDS",
        str(AGENTCORE_RUNTIME_PRICING["default_idle_timeout_seconds"]),
    ))
    mem_rate = (
        AGENTCORE_RUNTIME_PRICING["default_memory_gb"]
        * AGENTCORE_RUNTIME_PRICING["memory_per_gb_hour"]
        / 3600
    )

    changed = False

    # Scenario 2: gap between consecutive completed invocations
    for i in range(len(completed) - 1):
        current = completed[i]
        next_inv = completed[i + 1]
        if next_inv.client_invoke_time:
            gap_seconds = next_inv.client_invoke_time - current.client_done_time
            if gap_seconds > 0:
                idle_seconds = min(gap_seconds, idle_timeout_seconds)
                new_cost = round(idle_seconds * mem_rate, 6)
                if current.idle_memory_cost != new_cost:
                    current.idle_cpu_cost = 0.0
                    current.idle_memory_cost = new_cost
                    current.idle_timeout_cost = new_cost
                    changed = True

    # Scenario 1: last completed invocation and session has expired
    last = completed[-1]
    if live_status == "expired":
        new_cost = round(idle_timeout_seconds * mem_rate, 6)
        if last.idle_memory_cost != new_cost:
            last.idle_cpu_cost = 0.0
            last.idle_memory_cost = new_cost
            last.idle_timeout_cost = new_cost
            changed = True

    if changed:
        db.commit()
        logger.info("Recomputed idle memory costs for session %s", session.session_id)


def _estimate_compute_costs(
    duration_seconds: float,
) -> tuple[float, float, float]:
    """Estimate raw CPU and memory costs from measured invocation duration.

    Uses the default resource allocation from AGENTCORE_RUNTIME_PRICING.
    CPU cost is stored at full rate (no I/O wait discount).  The configurable
    discount is applied at view time so changing the setting retroactively
    affects all historical data.

    Returns (cpu_cost, memory_cost, total_cost) all rounded to 6 decimals.
    """
    from app.routers.agents import AGENTCORE_RUNTIME_PRICING

    hours = duration_seconds / 3600
    cpu_cost = round(
        hours * AGENTCORE_RUNTIME_PRICING["default_vcpu"]
        * AGENTCORE_RUNTIME_PRICING["cpu_per_vcpu_hour"], 6,
    )
    memory_cost = round(
        hours * AGENTCORE_RUNTIME_PRICING["default_memory_gb"]
        * AGENTCORE_RUNTIME_PRICING["memory_per_gb_hour"], 6,
    )
    return cpu_cost, memory_cost, round(cpu_cost + memory_cost, 6)


def format_sse_event(event: str, data: dict) -> str:
    """
    Format a Server-Sent Event message.

    Format:
        event: {event_name}
        data: {json_data}

        (blank line)
    """
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _finalize_invocation(
    invocation_id: str,
    session_id: str,
    runtime_id: str,
    qualifier: str,
    region: str,
    agent_model_id: str | None,
    prompt: str,
    response_chunks: list[str],
    thinking_chunks: list[str],
    client_invoke_time: float,
    chunk_generator: Any | None = None,
) -> None:
    """Finalize an invocation: drain remaining chunks, compute metrics, update DB.

    Designed to run in a background thread so that metrics are captured even
    when the client disconnects mid-stream.
    """
    # Drain any remaining chunks from the agent stream
    if chunk_generator is not None:
        try:
            for chunk in chunk_generator:
                if chunk.get("type") == "text":
                    response_chunks.append(chunk["content"])
                elif chunk.get("type") == "structured":
                    structured = chunk["content"]
                    if isinstance(structured, dict):
                        data = structured.get("data")
                        if isinstance(data, str) and data:
                            response_chunks.append(data)
                        thinking = structured.get("thinking") or structured.get("reasoning")
                        if thinking:
                            thinking_chunks.append(str(thinking))
        except Exception as e:
            logger.warning("Error draining agent stream for invocation %s: %s", invocation_id, e)

    client_done_time = time.time()

    # CloudWatch log retrieval
    agent_start_time_val = None
    memory_retrievals = None
    memory_events_sent = None
    memory_estimated_cost = None
    try:
        log_group = derive_log_group(runtime_id, qualifier)
        start_time_ms = int(client_invoke_time * 1000)
        logger.info("[finalize] Fetching CloudWatch logs: log_group=%s session_id=%s", log_group, session_id)

        events = get_log_events(
            log_group=log_group,
            session_id=session_id,
            region=region,
            start_time_ms=start_time_ms,
            limit=100,
            max_retries=6,
            retry_interval=5.0,
            required_marker="LOOM_MEMORY_TELEMETRY",
        )

        if events:
            logger.info("[finalize] Found %d CloudWatch log events for session %s", len(events), session_id)

            # Extract AgentCore request ID
            agentcore_req_id = parse_agentcore_request_id(events)

            agent_start_time_val = parse_agent_start_time(events)

            mem_telemetry = parse_memory_telemetry(events)
            if mem_telemetry["retrievals"] > 0 or mem_telemetry["events_sent"] > 0:
                memory_retrievals = mem_telemetry["retrievals"]
                memory_events_sent = mem_telemetry["events_sent"]
                stm_cost = mem_telemetry["events_sent"] / 1000 * 0.25
                ltm_retrieval_cost = mem_telemetry["retrievals"] / 1000 * 0.50
                memory_estimated_cost = round(stm_cost + ltm_retrieval_cost, 6)
        else:
            agentcore_req_id = None
            logger.warning("[finalize] No CloudWatch log events found for session %s", session_id)
    except Exception as cw_err:
        logger.exception("[finalize] CloudWatch retrieval failed for session %s: %s", session_id, cw_err)

    # Token counting
    output_text = "".join(response_chunks) if response_chunks else ""
    if agent_model_id:
        input_tokens = count_input_tokens(agent_model_id, prompt, region)
        output_tokens = count_output_tokens(agent_model_id, output_text, region)
    else:
        input_tokens = max(1, len(prompt) // 4)
        output_tokens = max(1, len(output_text) // 4)
        logger.info("[finalize] Token count via heuristic (no model_id): input=%d output=%d", input_tokens, output_tokens)

    # Cost calculation
    estimated_cost = None
    if agent_model_id:
        from app.routers.agents import SUPPORTED_MODELS
        model_pricing = next((m for m in SUPPORTED_MODELS if m["model_id"] == agent_model_id), None)
        if model_pricing:
            input_price = model_pricing.get("input_price_per_1k_tokens", 0)
            output_price = model_pricing.get("output_price_per_1k_tokens", 0)
            estimated_cost = round(
                (input_tokens / 1000 * input_price) + (output_tokens / 1000 * output_price),
                6,
            )

    # Compute cost: estimate from measured duration using default resource allocation.
    duration_seconds = client_done_time - client_invoke_time
    compute_cpu_cost, compute_memory_cost, compute_cost = _estimate_compute_costs(duration_seconds)
    cost_source = "estimated"
    logger.info("[finalize] Estimated compute cost from %.1fs duration: cpu=$%s mem=$%s total=$%s",
                duration_seconds, compute_cpu_cost, compute_memory_cost, compute_cost)

    # Memory cost breakdown (STM create events + LTM retrieve records)
    stm_cost = None
    ltm_cost = None
    if memory_events_sent is not None and memory_events_sent > 0:
        stm_cost = round(memory_events_sent / 1000 * 0.25, 6)
    if memory_retrievals is not None and memory_retrievals > 0:
        ltm_cost = round(memory_retrievals / 1000 * 0.50, 6)

    # Persist to DB using a fresh session
    # Note: idle costs are NOT set here — they are backfilled when the session
    # enters idle state (see _backfill_idle_costs).
    db = SessionLocal()
    try:
        inv = db.query(Invocation).filter(Invocation.invocation_id == invocation_id).first()
        sess = db.query(InvocationSession).filter(InvocationSession.session_id == session_id).first()
        if inv:
            inv.client_done_time = client_done_time
            inv.client_duration_ms = compute_client_duration(client_invoke_time, client_done_time)
            if agent_start_time_val is not None:
                inv.agent_start_time = agent_start_time_val
                inv.cold_start_latency_ms = compute_cold_start(client_invoke_time, agent_start_time_val)
            inv.response_text = "".join(response_chunks) if response_chunks else None
            inv.thinking_text = "\n".join(thinking_chunks) if thinking_chunks else None
            inv.input_tokens = input_tokens
            inv.output_tokens = output_tokens
            inv.estimated_cost = estimated_cost
            inv.compute_cost = compute_cost
            inv.compute_cpu_cost = compute_cpu_cost
            inv.compute_memory_cost = compute_memory_cost
            inv.cost_source = cost_source
            inv.memory_retrievals = memory_retrievals
            inv.memory_events_sent = memory_events_sent
            inv.memory_estimated_cost = memory_estimated_cost
            inv.stm_cost = stm_cost
            inv.ltm_cost = ltm_cost
            if agentcore_req_id:
                inv.request_id = agentcore_req_id
            inv.status = "complete"
        if sess:
            sess.status = "complete"
        db.commit()
        logger.info("[finalize] Completed finalization for invocation %s (cost_source=%s input=%d output=%d cost=%s)",
                     invocation_id, cost_source, input_tokens, output_tokens, estimated_cost)
    except Exception as e:
        db.rollback()
        logger.exception("[finalize] DB update failed for invocation %s: %s", invocation_id, e)
    finally:
        db.close()


async def invoke_agent_stream(
    agent: Agent,
    session: InvocationSession,
    invocation: Invocation,
    db: Session,
    client_invoke_time: float,
    prompt: str,
    access_token: str | None = None,
    token_source: str | None = None,
) -> AsyncGenerator[str, None]:
    """
    Invoke the agent and yield SSE events as the response streams.

    If the client disconnects mid-stream, a background thread drains the
    remaining agent response and completes metrics computation so that
    token counts and costs are always captured.

    Yields:
        SSE formatted events: session_start, chunk, session_end, error
    """
    session_id = session.session_id
    invocation_id = invocation.invocation_id

    # Extract model_id and runtime context for finalization
    config_map = {e.key: e.value for e in agent.config_entries}
    import json as _json
    agent_model_id = None
    config_json_str = config_map.get("AGENT_CONFIG_JSON", "")
    if config_json_str:
        try:
            agent_model_id = _json.loads(config_json_str).get("model_id")
        except (json.JSONDecodeError, TypeError):
            pass

    runtime_id = agent.runtime_id
    qualifier = session.qualifier
    region = agent.region

    # Update invocation with invoke time
    invocation.client_invoke_time = client_invoke_time
    invocation.status = "streaming"
    session.status = "streaming"
    finalized = False
    db.commit()

    # Yield session_start event
    session_start_data: dict[str, Any] = {
        "session_id": session_id,
        "invocation_id": invocation_id,
        "client_invoke_time": client_invoke_time,
    }
    if token_source:
        session_start_data["token_source"] = token_source
    if access_token:
        session_start_data["has_token"] = True
    yield format_sse_event("session_start", session_start_data)

    # Shared state between streaming and finalization
    response_chunks: list[str] = []
    thinking_chunks: list[str] = []
    chunk_generator = None
    stream_drained = False
    aws_request_id: str | None = None

    try:
        # Call invoke_agent service (returns a synchronous generator)
        chunk_generator = invoke_agent(
            arn=agent.arn,
            qualifier=qualifier,
            session_id=session_id,
            prompt=prompt,
            region=region,
            access_token=access_token,
        )

        # Stream chunks to frontend. Each next() call on the synchronous
        # generator blocks while waiting for boto3's StreamingBody. Running
        # it in a thread via asyncio.to_thread keeps the event loop free so
        # uvicorn can flush each SSE event to the client in real-time.
        _sentinel = object()

        def _next_chunk():
            return next(chunk_generator, _sentinel)

        while True:
            chunk = await asyncio.to_thread(_next_chunk)
            if chunk is _sentinel:
                break

            if chunk.get("type") == "text":
                text_content = chunk["content"]
                response_chunks.append(text_content)
                yield format_sse_event("chunk", {"text": text_content})
            elif chunk.get("type") == "structured":
                structured = chunk["content"]
                if isinstance(structured, dict):
                    # Strands SDK text delta: {"data": "token"}
                    data = structured.get("data")
                    if isinstance(data, str) and data:
                        response_chunks.append(data)
                        yield format_sse_event("chunk", {"text": data})
                    # Extract thinking/reasoning data
                    thinking = structured.get("thinking") or structured.get("reasoning")
                    if thinking:
                        thinking_chunks.append(str(thinking))

        stream_drained = True

        # Client is still connected — run finalization inline using the
        # request DB session (avoids cross-session issues with SQLite).
        client_done_time = time.time()
        invocation.client_done_time = client_done_time
        invocation.client_duration_ms = compute_client_duration(client_invoke_time, client_done_time)

        # Retrieve CloudWatch logs for cold start latency and memory telemetry
        try:
            log_group = derive_log_group(runtime_id, qualifier)
            start_time_ms = int(client_invoke_time * 1000)
            logger.info("Fetching CloudWatch logs: log_group=%s session_id=%s start_time_ms=%d",
                        log_group, session_id, start_time_ms)

            events = await asyncio.to_thread(
                lambda: get_log_events(
                    log_group=log_group,
                    session_id=session_id,
                    region=region,
                    start_time_ms=start_time_ms,
                    limit=100,
                    max_retries=6,
                    retry_interval=5.0,
                    required_marker="LOOM_MEMORY_TELEMETRY",
                )
            )

            if events:
                logger.info("Found %d CloudWatch log events for session %s", len(events), session_id)

                # Extract AgentCore request ID for correlation
                agentcore_req_id = parse_agentcore_request_id(events)
                if agentcore_req_id:
                    aws_request_id = agentcore_req_id
                    invocation.request_id = agentcore_req_id
                    logger.info("Parsed AgentCore request_id=%s for invocation %s", agentcore_req_id, invocation_id)

                agent_start_time = parse_agent_start_time(events)
                if agent_start_time is not None:
                    invocation.agent_start_time = agent_start_time
                    invocation.cold_start_latency_ms = compute_cold_start(client_invoke_time, agent_start_time)
                    logger.info("Computed cold_start_latency_ms=%.1f agent_start_time=%.3f",
                                invocation.cold_start_latency_ms, agent_start_time)

                mem_telemetry = parse_memory_telemetry(events)
                if mem_telemetry["retrievals"] > 0 or mem_telemetry["events_sent"] > 0:
                    invocation.memory_retrievals = mem_telemetry["retrievals"]
                    invocation.memory_events_sent = mem_telemetry["events_sent"]
                    stm_cost = mem_telemetry["events_sent"] / 1000 * 0.25
                    ltm_retrieval_cost = mem_telemetry["retrievals"] / 1000 * 0.50
                    invocation.memory_estimated_cost = round(stm_cost + ltm_retrieval_cost, 6)
            else:
                logger.warning("No CloudWatch log events found for session %s after retries", session_id)
        except Exception as cw_err:
            logger.exception("CloudWatch retrieval failed for session %s: %s", session_id, cw_err)

        # Persist accumulated content
        invocation.response_text = "".join(response_chunks) if response_chunks else None
        invocation.thinking_text = "\n".join(thinking_chunks) if thinking_chunks else None

        # Token counting via Bedrock CountTokens API (falls back to heuristic)
        output_text = "".join(response_chunks) if response_chunks else ""
        if agent_model_id:
            input_tokens = await asyncio.to_thread(count_input_tokens, agent_model_id, prompt, region)
            output_tokens = await asyncio.to_thread(count_output_tokens, agent_model_id, output_text, region)
        else:
            input_tokens = max(1, len(prompt) // 4)
            output_tokens = max(1, len(output_text) // 4)
            logger.info("Token count via heuristic (no model_id): input=%d output=%d", input_tokens, output_tokens)

        # Cost calculation
        estimated_cost = None
        if agent_model_id:
            from app.routers.agents import SUPPORTED_MODELS
            model_pricing = next((m for m in SUPPORTED_MODELS if m["model_id"] == agent_model_id), None)
            if model_pricing:
                input_price = model_pricing.get("input_price_per_1k_tokens", 0)
                output_price = model_pricing.get("output_price_per_1k_tokens", 0)
                estimated_cost = round(
                    (input_tokens / 1000 * input_price) + (output_tokens / 1000 * output_price), 6,
                )

        # Compute cost: estimate from measured duration using default resource allocation.
        duration_seconds = client_done_time - client_invoke_time
        compute_cpu_cost, compute_memory_cost, compute_cost = _estimate_compute_costs(duration_seconds)
        cost_source = "estimated"
        logger.info("Estimated compute cost from %.1fs duration: cpu=$%s mem=$%s total=$%s",
                     duration_seconds, compute_cpu_cost, compute_memory_cost, compute_cost)

        # Memory cost breakdown (STM create events + LTM retrieve records)
        stm_cost = invocation.stm_cost
        ltm_cost = invocation.ltm_cost
        if invocation.memory_events_sent and invocation.memory_events_sent > 0:
            stm_cost = round(invocation.memory_events_sent / 1000 * 0.25, 6)
        if invocation.memory_retrievals and invocation.memory_retrievals > 0:
            ltm_cost = round(invocation.memory_retrievals / 1000 * 0.50, 6)

        # Note: idle costs are NOT set here — they are backfilled when the
        # session enters idle state (see _backfill_idle_costs).
        invocation.input_tokens = input_tokens
        invocation.output_tokens = output_tokens
        invocation.estimated_cost = estimated_cost
        invocation.compute_cost = compute_cost
        invocation.compute_cpu_cost = compute_cpu_cost
        invocation.compute_memory_cost = compute_memory_cost
        invocation.cost_source = cost_source
        invocation.stm_cost = stm_cost
        invocation.ltm_cost = ltm_cost
        invocation.status = "complete"
        session.status = "complete"
        finalized = True
        db.commit()

        yield format_sse_event("session_end", {
            "session_id": session_id,
            "invocation_id": invocation_id,
            "request_id": aws_request_id,
            "qualifier": qualifier,
            "client_invoke_time": client_invoke_time,
            "client_done_time": client_done_time,
            "client_duration_ms": invocation.client_duration_ms,
            "cold_start_latency_ms": invocation.cold_start_latency_ms,
            "agent_start_time": invocation.agent_start_time,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "estimated_cost": estimated_cost,
            "compute_cost": compute_cost,
            "compute_cpu_cost": round(compute_cpu_cost * (1.0 - _get_io_discount(db)), 6),
            "compute_memory_cost": compute_memory_cost,
            "memory_retrievals": invocation.memory_retrievals,
            "memory_events_sent": invocation.memory_events_sent,
            "memory_estimated_cost": invocation.memory_estimated_cost,
            "stm_cost": stm_cost,
            "ltm_cost": ltm_cost,
        })

    except Exception as e:
        # Handle errors — include full exception details for debugging
        error_detail = str(e)
        if hasattr(e, "response"):
            try:
                error_detail = f"{error_detail} | Response: {e.response}"
            except Exception:
                pass
        logger.error("Invocation failed for agent %s session %s (token_source=%s): %s",
                      agent.id, session_id, token_source, error_detail)
        invocation.status = "error"
        invocation.error_message = error_detail
        session.status = "error"
        finalized = True
        db.commit()

        yield format_sse_event("error", {
            "message": f"Invocation failed: {error_detail}"
        })

    finally:
        # If finalization hasn't run (client disconnected mid-stream or
        # during post-processing), spawn a background thread to drain
        # remaining chunks and compute metrics.
        if not finalized:
            remaining_gen = chunk_generator if not stream_drained else None
            logger.info("Client disconnected for invocation %s; spawning background finalization", invocation_id)
            thread = threading.Thread(
                target=_finalize_invocation,
                args=(
                    invocation_id, session_id, runtime_id, qualifier, region,
                    agent_model_id, prompt, response_chunks, thinking_chunks,
                    client_invoke_time, remaining_gen,
                ),
                daemon=True,
            )
            thread.start()


@router.post("/{agent_id}/invoke")
async def invoke_agent_endpoint(
    agent_id: int,
    request_body: InvokeRequest,
    request: Request,
    user: UserInfo = Depends(require_scopes("invoke")),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """
    Invoke an agent and stream the response via Server-Sent Events.

    Returns a text/event-stream with events: session_start, chunk, session_end, error
    """
    # Look up agent
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Agent with ID {agent_id} not found"
        )

    # Validate qualifier
    available_qualifiers = agent.get_available_qualifiers()
    if request_body.qualifier not in available_qualifiers:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Qualifier '{request_body.qualifier}' not available. Available: {available_qualifiers}"
        )

    # ---- Group-based invoke restriction ----
    # super-admins can invoke any agent.
    # Other users can only invoke agents tagged with their groups.
    # Check this BEFORE creating any session/invocation records.
    if "super-admins" not in user.groups:
        agent_group = agent.get_tags().get("loom:group", "")
        allowed_groups = [g for g in user.groups if g != "users"]
        # users group members match agents tagged "users"
        if "users" in user.groups:
            allowed_groups.append("users")
        if agent_group not in allowed_groups:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"You can only invoke agents within your group (agent group: {agent_group})",
            )

    # Record client invoke time before session creation
    client_invoke_time = time.time()

    # Reuse existing session or create a new one
    if request_body.session_id:
        session = db.query(InvocationSession).filter(
            InvocationSession.agent_id == agent.id,
            InvocationSession.session_id == request_body.session_id,
        ).first()
        if not session:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session {request_body.session_id} not found for agent {agent_id}"
            )
        if session.qualifier != request_body.qualifier:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Qualifier mismatch: session uses '{session.qualifier}', request uses '{request_body.qualifier}'"
            )
        session.status = "pending"
        db.commit()
    else:
        session = InvocationSession(
            agent_id=agent.id,
            session_id=str(uuid.uuid4()),
            qualifier=request_body.qualifier,
            status="pending",
            created_at=datetime.utcnow(),
        )
        db.add(session)
        db.commit()
        db.refresh(session)

    # Create invocation record within the session
    invocation = Invocation(
        session_id=session.session_id,
        invocation_id=str(uuid.uuid4()),
        status="pending",
        prompt_text=request_body.prompt,
        created_at=datetime.utcnow(),
    )
    db.add(invocation)
    db.commit()
    db.refresh(invocation)

    # ---- Resolve access token ----
    # Priority: manual token > credential_id (M2M) > user login token > agent config M2M
    # The frontend and agent share the same authorization server, so the user's
    # login token is the primary path. M2M credentials are for future integrations
    # (MCP, A2A) that need service-to-service tokens.
    access_token = None
    token_source = None

    # Priority 0: Use manually provided bearer token
    if request_body.bearer_token:
        access_token = request_body.bearer_token
        token_source = "manual"
        logger.info("Using manually provided bearer token for agent invocation")

    # Priority 1: Use credential_id if provided (M2M for integrations)
    if not access_token and request_body.credential_id:
        cred = db.query(AuthorizerCredential).filter(AuthorizerCredential.id == request_body.credential_id).first()
        if cred and cred.client_secret_arn:
            auth = db.query(AuthorizerConfig).filter(AuthorizerConfig.id == cred.authorizer_config_id).first()
            if auth and auth.pool_id:
                try:
                    import json as _json
                    region = os.getenv("AWS_REGION", "us-east-1")
                    client_secret = get_secret(cred.client_secret_arn, region)
                    allowed_scopes = _json.loads(auth.allowed_scopes) if auth.allowed_scopes else None
                    token_response = get_cognito_token(
                        pool_id=auth.pool_id,
                        client_id=cred.client_id,
                        client_secret=client_secret,
                        scopes=allowed_scopes or None,
                    )
                    access_token = token_response.get("access_token")
                    token_source = cred.label
                except Exception as e:
                    logger.warning("Failed to get token via credential %s: %s", request_body.credential_id, e)

    # Priority 2: Forward user's login token (same auth server as agent)
    # Only applies when the agent has an authorizer; non-OAuth agents use SigV4.
    if not access_token:
        agent_auth_config = agent.get_authorizer_config()
        if agent_auth_config and agent_auth_config.get("type"):
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                access_token = auth_header[7:]
                token_source = "user"
                logger.info("Using user login token for agent invocation")

    # Priority 3: Fall back to agent config M2M flow
    if not access_token:
        auth_config = agent.get_authorizer_config()
        if auth_config and auth_config.get("type") == "cognito" and auth_config.get("pool_id"):
            config_map = {e.key: e.value for e in agent.config_entries}
            client_id = config_map.get("COGNITO_CLIENT_ID", "")
            secret_arn = config_map.get("COGNITO_CLIENT_SECRET_ARN", "")
            if client_id and secret_arn:
                try:
                    client_secret = get_secret(secret_arn, agent.region)
                    token_response = get_cognito_token(
                        pool_id=auth_config["pool_id"],
                        client_id=client_id,
                        client_secret=client_secret,
                        scopes=auth_config.get("allowed_scopes") or None,
                    )
                    access_token = token_response.get("access_token")
                    token_source = "agent-config"
                except Exception as e:
                    logger.warning("Failed to get Cognito token for agent %s: %s", agent_id, e)

    logger.info("Invoking agent %s with token_source=%s, has_token=%s",
                agent_id, token_source, bool(access_token))

    # Return streaming response
    return StreamingResponse(
        invoke_agent_stream(agent, session, invocation, db, client_invoke_time, request_body.prompt, access_token, token_source),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable buffering in nginx
        }
    )


@router.post("/{agent_id}/token")
def get_agent_token(
    agent_id: int,
    user: UserInfo = Depends(require_scopes("invoke")),
    db: Session = Depends(get_db),
) -> dict:
    """Get an access token for an agent with a Cognito authorizer.

    Reads COGNITO_CLIENT_ID and COGNITO_CLIENT_SECRET from the agent's
    config entries and exchanges them for a token via the client credentials grant.
    """
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found")

    auth_config = agent.get_authorizer_config()
    if not auth_config or auth_config.get("type") != "cognito" or not auth_config.get("pool_id"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Agent does not have a Cognito authorizer configured",
        )

    config_map = {e.key: e.value for e in agent.config_entries}
    client_id = config_map.get("COGNITO_CLIENT_ID", "")
    secret_arn = config_map.get("COGNITO_CLIENT_SECRET_ARN", "")
    if not client_id or not secret_arn:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="COGNITO_CLIENT_ID and COGNITO_CLIENT_SECRET_ARN must be set in agent configuration",
        )

    try:
        client_secret = get_secret(secret_arn, agent.region)
        token_response = get_cognito_token(
            pool_id=auth_config["pool_id"],
            client_id=client_id,
            client_secret=client_secret,
            scopes=auth_config.get("allowed_scopes") or None,
        )
        return {
            "access_token": token_response["access_token"],
            "token_type": token_response.get("token_type", "Bearer"),
            "expires_in": token_response.get("expires_in"),
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to get token from Cognito: {str(e)}",
        )


@router.get("/{agent_id}/sessions", response_model=List[SessionResponse])
def list_sessions(
    agent_id: int,
    user: UserInfo = Depends(require_scopes("agent:read")),
    db: Session = Depends(get_db),
) -> List[SessionResponse]:
    """List all invocation sessions for an agent with their invocations."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Agent with ID {agent_id} not found"
        )

    sessions = db.query(InvocationSession).filter(
        InvocationSession.agent_id == agent_id
    ).order_by(InvocationSession.created_at.desc()).all()

    from app.routers.settings import get_cpu_io_wait_discount
    io_discount = get_cpu_io_wait_discount(db)

    result = []
    for session in sessions:
        live_status = compute_live_status(session, db)
        _backfill_idle_costs(session, live_status, db)
        sdict = session.to_dict()
        sdict["invocations"] = [_apply_view_time_costs(inv, io_discount) for inv in sdict.get("invocations", [])]
        result.append(SessionResponse(**sdict, live_status=live_status))
    return result


@router.get("/{agent_id}/sessions/{session_id}", response_model=SessionResponse)
def get_session(
    agent_id: int,
    session_id: str,
    user: UserInfo = Depends(require_scopes("agent:read")),
    db: Session = Depends(get_db),
) -> SessionResponse:
    """Get a specific session with all its invocations."""
    session = db.query(InvocationSession).filter(
        InvocationSession.agent_id == agent_id,
        InvocationSession.session_id == session_id
    ).first()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found for agent {agent_id}"
        )

    live_status = compute_live_status(session, db)
    _backfill_idle_costs(session, live_status, db)
    from app.routers.settings import get_cpu_io_wait_discount
    io_discount = get_cpu_io_wait_discount(db)
    sdict = session.to_dict()
    sdict["invocations"] = [_apply_view_time_costs(inv, io_discount) for inv in sdict.get("invocations", [])]
    return SessionResponse(**sdict, live_status=live_status)


@router.get("/{agent_id}/sessions/{session_id}/invocations/{invocation_id}", response_model=InvocationResponse)
def get_invocation(
    agent_id: int,
    session_id: str,
    invocation_id: str,
    user: UserInfo = Depends(require_scopes("agent:read")),
    db: Session = Depends(get_db),
) -> InvocationResponse:
    """Get a specific invocation within a session."""
    # Look up session first to validate agent_id
    session = db.query(InvocationSession).filter(
        InvocationSession.agent_id == agent_id,
        InvocationSession.session_id == session_id
    ).first()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found for agent {agent_id}"
        )

    # Look up invocation
    invocation = db.query(Invocation).filter(
        Invocation.session_id == session.session_id,
        Invocation.invocation_id == invocation_id
    ).first()

    if not invocation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Invocation {invocation_id} not found in session {session_id}"
        )

    from app.routers.settings import get_cpu_io_wait_discount
    io_discount = get_cpu_io_wait_discount(db)
    return InvocationResponse(**_apply_view_time_costs(invocation.to_dict(), io_discount))
