"""Agent invocation endpoints with SSE streaming support."""
import asyncio
import json
import time
import uuid
from datetime import datetime
from typing import List, AsyncGenerator
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

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
    created_at: str | None


class SessionResponse(BaseModel):
    """Response model for session details."""
    agent_id: int
    session_id: str
    qualifier: str
    status: str
    created_at: str | None
    invocations: List[InvocationResponse]


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
            yield format_sse_event("chunk", {"text": chunk})

        # Mark invocation complete
        client_done_time = time.time()
        invocation.client_done_time = client_done_time
        invocation.client_duration_ms = compute_client_duration(client_invoke_time, client_done_time)

        # Attempt to retrieve CloudWatch logs and compute cold_start_latency_ms
        try:
            log_group = derive_log_group(agent.runtime_id, session.qualifier)
            start_time_ms = int(client_invoke_time * 1000)

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
                agent_start_time = parse_agent_start_time(events)
                if agent_start_time is not None:
                    invocation.agent_start_time = agent_start_time
                    invocation.cold_start_latency_ms = compute_cold_start(
                        client_invoke_time,
                        agent_start_time
                    )
        except Exception:
            # If CloudWatch retrieval fails, continue without latency data
            pass

        invocation.status = "complete"
        session.status = "complete"
        db.commit()

        # Yield session_end event with all timing data
        session_end_data = {
            "session_id": session_id,
            "invocation_id": invocation_id,
            "qualifier": session.qualifier,
            "client_invoke_time": client_invoke_time,
            "client_done_time": client_done_time,
            "client_duration_ms": invocation.client_duration_ms,
        }

        # Include cold_start_latency_ms and agent_start_time if available
        if invocation.cold_start_latency_ms is not None:
            session_end_data["cold_start_latency_ms"] = invocation.cold_start_latency_ms
        if invocation.agent_start_time is not None:
            session_end_data["agent_start_time"] = invocation.agent_start_time

        yield format_sse_event("session_end", session_end_data)

    except Exception as e:
        # Handle errors
        invocation.status = "error"
        invocation.error_message = str(e)
        session.status = "error"
        db.commit()

        yield format_sse_event("error", {
            "message": f"Invocation failed: {str(e)}"
        })


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

    # Look up or create session for this agent+qualifier
    # For now, create a new session per invocation (can be modified later for session reuse)
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

    return [SessionResponse(**session.to_dict()) for session in sessions]


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

    return SessionResponse(**session.to_dict())


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
