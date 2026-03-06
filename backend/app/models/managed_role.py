from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from app.db import Base


class ManagedRole(Base):
    __tablename__ = "managed_roles"
    id = Column(Integer, primary_key=True, autoincrement=True)
    role_name = Column(String, nullable=False)
    role_arn = Column(String, nullable=False, unique=True)
    description = Column(Text, default="")
    policy_document = Column(Text, default="{}")  # JSON string
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    def to_dict(self) -> dict:
        import json
        return {
            "id": self.id,
            "role_name": self.role_name,
            "role_arn": self.role_arn,
            "description": self.description,
            "policy_document": json.loads(self.policy_document) if self.policy_document else {},
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
