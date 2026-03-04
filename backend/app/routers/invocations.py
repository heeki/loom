"""Agent invocation endpoints with SSE streaming support."""
import asyncio
import json
import logging
import os
import time
import uuid
from datetime import datetime
from typing import List, AsyncGenerator
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from app.db import get_db
from app.models.agent import Agent
from app.models.session import InvocationSession
from app.models.invocation import Invocation

from app.services.agentcore import invoke_agent
from app.services.cloudwatch import get_log_events, parse_agent_start_time
from app.services.latency import compute_client_duration, compute_cold_start
from app.routers.agents import derive_log_group


router = APIRouter(prefix="/api/agents", tags=["invocations"])


# Pydantic models
class InvokeRequest(BaseModel):
    """Request body for agent invocation."""
    prompt: str = Field(..., description="Prompt to send to the agent")
    qualifier: str = Field(default="DEFAULT", description="Endpoint qualifier to use")
    session_id: str | None = Field(default=None, description="Existing session ID to reuse (runtimeSessionId)")


class InvocationResponse(BaseModel):
    """Response model for invocation details."""
    id: int
    session_id: str
    invocation_id: str
    client_invoke_time: float | None
    client_done_time: float | None
    agent_start_time: float | None
    cold_start_latency_ms: float | None
    client_duration_ms: float | None
    status: str
    error_message: str | None
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
    """
    if session.status == "pending":
        return "pending"
    if session.status == "streaming":
        return "streaming"

    timeout_minutes = int(os.getenv("SESSION_IDLE_TIMEOUT_MINUTES", "15"))
    timeout_seconds = timeout_minutes * 60

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


def format_sse_event(event: str, data: dict) -> str:
    """
    Format a Server-Sent Event message.

    Format:
        event: {event_name}
        data: {json_data}

        (blank line)
    """
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def invoke_agent_stream(
    agent: Agent,
    session: InvocationSession,
    invocation: Invocation,
    db: Session,
    client_invoke_time: float,
    prompt: str
) -> AsyncGenerator[str, None]:
    """
    Invoke the agent and yield SSE events as the response streams.

    Yields:
        SSE formatted events: session_start, chunk, session_end, error
    """
    session_id = session.session_id
    invocation_id = invocation.invocation_id

    # Update invocation with invoke time
    invocation.client_invoke_time = client_invoke_time
    invocation.status = "streaming"
    session.status = "streaming"
    completed = False
    db.commit()

    # Yield session_start event
    yield format_sse_event("session_start", {
        "session_id": session_id,
        "invocation_id": invocation_id,
        "client_invoke_time": client_invoke_time,
    })

    try:
        # Call invoke_agent service (returns a synchronous generator)
        chunk_generator = invoke_agent(
            arn=agent.arn,
            qualifier=session.qualifier,
            session_id=session_id,
            prompt=prompt,
            region=agent.region
        )

        # Accumulators for content storage
        response_chunks: list[str] = []
        thinking_chunks: list[str] = []

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
                # Extract thinking/reasoning data from structured payloads
                if isinstance(structured, dict):
                    thinking = structured.get("thinking") or structured.get("reasoning")
                    if thinking:
                        thinking_chunks.append(str(thinking))

        # Mark invocation complete
        client_done_time = time.time()
        invocation.client_done_time = client_done_time
        invocation.client_duration_ms = compute_client_duration(client_invoke_time, client_done_time)

        # Attempt to retrieve CloudWatch logs and compute cold_start_latency_ms
        try:
            log_group = derive_log_group(agent.runtime_id, session.qualifier)
            start_time_ms = int(client_invoke_time * 1000)
            logger.info("Fetching CloudWatch logs: log_group=%s session_id=%s start_time_ms=%d",
                        log_group, session_id, start_time_ms)

            # Run in thread to avoid blocking the event loop for up to 30s
            events = await asyncio.to_thread(
                lambda: get_log_events(
                    log_group=log_group,
                    session_id=session_id,
                    region=agent.region,
                    start_time_ms=start_time_ms,
                    limit=100,
                    max_retries=6,
                    retry_interval=5.0
                )
            )

            if events:
                logger.info("Found %d CloudWatch log events for session %s", len(events), session_id)
                agent_start_time = parse_agent_start_time(events)
                if agent_start_time is not None:
                    invocation.agent_start_time = agent_start_time
                    invocation.cold_start_latency_ms = compute_cold_start(
                        client_invoke_time,
                        agent_start_time
                    )
                    logger.info("Computed cold_start_latency_ms=%.1f agent_start_time=%.3f",
                                invocation.cold_start_latency_ms, agent_start_time)
                else:
                    logger.warning("Could not parse agent start time from %d log events for session %s",
                                   len(events), session_id)
            else:
                logger.warning("No CloudWatch log events found for session %s after retries", session_id)
        except Exception as cw_err:
            logger.exception("CloudWatch retrieval failed for session %s: %s", session_id, cw_err)

        # Persist accumulated content
        invocation.response_text = "".join(response_chunks) if response_chunks else None
        invocation.thinking_text = "\n".join(thinking_chunks) if thinking_chunks else None

        invocation.status = "complete"
        session.status = "complete"
        completed = True
        db.commit()

        # Yield session_end event with all timing data
        session_end_data = {
            "session_id": session_id,
            "invocation_id": invocation_id,
            "qualifier": session.qualifier,
            "client_invoke_time": client_invoke_time,
            "client_done_time": client_done_time,
            "client_duration_ms": invocation.client_duration_ms,
            "cold_start_latency_ms": invocation.cold_start_latency_ms,
            "agent_start_time": invocation.agent_start_time,
        }

        yield format_sse_event("session_end", session_end_data)

    except Exception as e:
        # Handle errors
        invocation.status = "error"
        invocation.error_message = str(e)
        session.status = "error"
        completed = True
        db.commit()

        yield format_sse_event("error", {
            "message": f"Invocation failed: {str(e)}"
        })

    finally:
        # Safety net: if the client disconnected (GeneratorExit) or the
        # generator was closed before completing, ensure DB status is not
        # left as "streaming".
        if not completed:
            try:
                db.refresh(invocation)
                db.refresh(session)
                if invocation.status == "streaming":
                    invocation.status = "error"
                    invocation.error_message = "Client disconnected"
                if session.status == "streaming":
                    session.status = "error"
                db.commit()
            except Exception:
                pass


@router.post("/{agent_id}/invoke")
async def invoke_agent_endpoint(
    agent_id: int,
    request: InvokeRequest,
    db: Session = Depends(get_db)
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
    if request.qualifier not in available_qualifiers:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Qualifier '{request.qualifier}' not available. Available: {available_qualifiers}"
        )

    # Record client invoke time before session creation
    client_invoke_time = time.time()

    # Reuse existing session or create a new one
    if request.session_id:
        session = db.query(InvocationSession).filter(
            InvocationSession.agent_id == agent.id,
            InvocationSession.session_id == request.session_id,
        ).first()
        if not session:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session {request.session_id} not found for agent {agent_id}"
            )
        if session.qualifier != request.qualifier:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Qualifier mismatch: session uses '{session.qualifier}', request uses '{request.qualifier}'"
            )
        session.status = "pending"
        db.commit()
    else:
        session = InvocationSession(
            agent_id=agent.id,
            session_id=str(uuid.uuid4()),
            qualifier=request.qualifier,
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
        prompt_text=request.prompt,
        created_at=datetime.utcnow(),
    )
    db.add(invocation)
    db.commit()
    db.refresh(invocation)

    # Return streaming response
    return StreamingResponse(
        invoke_agent_stream(agent, session, invocation, db, client_invoke_time, request.prompt),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable buffering in nginx
        }
    )


@router.get("/{agent_id}/sessions", response_model=List[SessionResponse])
def list_sessions(
    agent_id: int,
    db: Session = Depends(get_db)
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

    return [
        SessionResponse(**session.to_dict(), live_status=compute_live_status(session, db))
        for session in sessions
    ]


@router.get("/{agent_id}/sessions/{session_id}", response_model=SessionResponse)
def get_session(
    agent_id: int,
    session_id: str,
    db: Session = Depends(get_db)
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

    return SessionResponse(**session.to_dict(), live_status=compute_live_status(session, db))


@router.get("/{agent_id}/sessions/{session_id}/invocations/{invocation_id}", response_model=InvocationResponse)
def get_invocation(
    agent_id: int,
    session_id: str,
    invocation_id: str,
    db: Session = Depends(get_db)
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

    return InvocationResponse(**invocation.to_dict())
