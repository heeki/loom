"""Invocation ORM model for storing individual agent invocation records."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.db import Base


class Invocation(Base):
    """
    Represents a single agent invocation within a session.

    Stores timing measurements and status for each individual invocation.
    """
    __tablename__ = "invocations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String, ForeignKey("invocation_sessions.session_id", ondelete="CASCADE"), nullable=False, index=True)
    invocation_id = Column(String, nullable=False, unique=True, index=True)
    # Timing measurements (Unix timestamps in seconds)
    client_invoke_time = Column(Float, nullable=True)
    client_done_time = Column(Float, nullable=True)
    agent_start_time = Column(Float, nullable=True)  # Parsed from CloudWatch logs

    # Computed latencies (milliseconds)
    cold_start_latency_ms = Column(Float, nullable=True)
    client_duration_ms = Column(Float, nullable=True)

    # Invocation status
    status = Column(String, nullable=False, default="pending")  # pending, streaming, complete, error
    error_message = Column(Text, nullable=True)

    # Content storage
    prompt_text = Column(Text, nullable=True)
    thinking_text = Column(Text, nullable=True)
    response_text = Column(Text, nullable=True)

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)

    # Relationship to session
    session = relationship("InvocationSession", back_populates="invocations")

    def to_dict(self) -> dict:
        """Convert invocation to dictionary for API responses."""
        return {
            "id": self.id,
            "session_id": self.session_id,
            "invocation_id": self.invocation_id,
            "client_invoke_time": self.client_invoke_time,
            "client_done_time": self.client_done_time,
            "agent_start_time": self.agent_start_time,
            "cold_start_latency_ms": self.cold_start_latency_ms,
            "client_duration_ms": self.client_duration_ms,
            "status": self.status,
            "error_message": self.error_message,
            "prompt_text": self.prompt_text,
            "thinking_text": self.thinking_text,
            "response_text": self.response_text,
            "created_at": (self.created_at.isoformat() + "Z") if self.created_at else None,
        }
