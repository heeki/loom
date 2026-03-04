"""Agent ORM model for storing registered AgentCore Runtime metadata."""
import json
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.orm import relationship
from app.db import Base


class DateTimeEncoder(json.JSONEncoder):
    """JSON encoder that handles datetime objects from AWS API responses."""
    def default(self, o: object) -> str:
        if isinstance(o, datetime):
            return o.isoformat()
        return super().default(o)


class Agent(Base):
    """
    Represents a registered AgentCore Runtime agent.

    ARN format: arn:aws:bedrock-agentcore:{region}:{account_id}:runtime/{runtime_id}
    """
    __tablename__ = "agents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    arn = Column(String, unique=True, nullable=False, index=True)
    runtime_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=True)
    status = Column(String, nullable=True)
    region = Column(String, nullable=False)
    account_id = Column(String, nullable=False)
    log_group = Column(String, nullable=True)
    available_qualifiers = Column(Text, nullable=True)  # JSON array as text
    raw_metadata = Column(Text, nullable=True)  # Full JSON from AgentCore API
    registered_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_refreshed_at = Column(DateTime, nullable=True)

    # Relationship to invocation sessions
    sessions = relationship("InvocationSession", back_populates="agent", cascade="all, delete-orphan")

    def get_available_qualifiers(self) -> list[str]:
        """Parse available_qualifiers from JSON text."""
        if not self.available_qualifiers:
            return ["DEFAULT"]
        try:
            return json.loads(self.available_qualifiers)
        except json.JSONDecodeError:
            return ["DEFAULT"]

    def set_available_qualifiers(self, qualifiers: list[str]) -> None:
        """Serialize available_qualifiers to JSON text."""
        self.available_qualifiers = json.dumps(qualifiers)

    def get_raw_metadata(self) -> dict:
        """Parse raw_metadata from JSON text."""
        if not self.raw_metadata:
            return {}
        try:
            return json.loads(self.raw_metadata)
        except json.JSONDecodeError:
            return {}

    def set_raw_metadata(self, metadata: dict) -> None:
        """Serialize raw_metadata to JSON text."""
        self.raw_metadata = json.dumps(metadata, cls=DateTimeEncoder)

    def to_dict(self) -> dict:
        """Convert agent to dictionary for API responses."""
        return {
            "id": self.id,
            "arn": self.arn,
            "runtime_id": self.runtime_id,
            "name": self.name,
            "status": self.status,
            "region": self.region,
            "account_id": self.account_id,
            "log_group": self.log_group,
            "available_qualifiers": self.get_available_qualifiers(),
            "registered_at": (self.registered_at.isoformat() + "Z") if self.registered_at else None,
            "last_refreshed_at": (self.last_refreshed_at.isoformat() + "Z") if self.last_refreshed_at else None,
        }
