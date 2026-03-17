"""MCP server management endpoints."""
import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies.auth import UserInfo, require_scopes
from app.models.mcp import McpServer, McpTool, McpServerAccess
from app.services.mcp import test_mcp_connection as svc_test_connection
from app.services.mcp import fetch_mcp_tools as svc_fetch_tools
from app.services.mcp import invoke_mcp_tool as svc_invoke_tool

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/mcp/servers", tags=["mcp"])


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class McpServerCreateRequest(BaseModel):
    name: str = Field(..., description="Server display name")
    description: str | None = Field(None, description="Server description")
    endpoint_url: str = Field(..., description="MCP server endpoint URL")
    transport_type: str = Field(..., description="Transport type: 'sse' or 'streamable_http'")
    auth_type: str = Field(default="none", description="Auth type: 'none' or 'oauth2'")
    oauth2_well_known_url: str | None = Field(None, description="OAuth2 well-known URL")
    oauth2_client_id: str | None = Field(None, description="OAuth2 client ID")
    oauth2_client_secret: str | None = Field(None, description="OAuth2 client secret")
    oauth2_scopes: str | None = Field(None, description="OAuth2 scopes (space-separated)")

    @model_validator(mode="after")
    def validate_oauth2_fields(self):
        if self.auth_type == "oauth2":
            if not self.oauth2_well_known_url:
                raise ValueError("oauth2_well_known_url is required when auth_type is 'oauth2'")
            if not self.oauth2_client_id:
                raise ValueError("oauth2_client_id is required when auth_type is 'oauth2'")
        return self


class McpServerUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    endpoint_url: str | None = None
    transport_type: str | None = None
    status: str | None = None
    auth_type: str | None = None
    oauth2_well_known_url: str | None = None
    oauth2_client_id: str | None = None
    oauth2_client_secret: str | None = None
    oauth2_scopes: str | None = None


class McpServerResponse(BaseModel):
    id: int
    name: str
    description: str | None = None
    endpoint_url: str
    transport_type: str
    status: str
    auth_type: str
    oauth2_well_known_url: str | None = None
    oauth2_client_id: str | None = None
    oauth2_scopes: str | None = None
    has_oauth2_secret: bool = False
    created_at: str | None = None
    updated_at: str | None = None


class McpToolResponse(BaseModel):
    id: int
    server_id: int
    tool_name: str
    description: str | None = None
    input_schema: dict | None = None
    last_refreshed_at: str | None = None


class McpAccessRuleResponse(BaseModel):
    id: int
    server_id: int
    persona_id: int
    access_level: str
    allowed_tool_names: list[str] | None = None
    created_at: str | None = None
    updated_at: str | None = None


class McpAccessRuleInput(BaseModel):
    persona_id: int
    access_level: str
    allowed_tool_names: list[str] | None = None


class McpAccessUpdateRequest(BaseModel):
    rules: list[McpAccessRuleInput]


class TestConnectionResponse(BaseModel):
    success: bool
    message: str


class ToolInvokeRequest(BaseModel):
    tool_name: str = Field(..., description="Name of the tool to invoke")
    arguments: dict = Field(default_factory=dict, description="Arguments to pass to the tool")


class ToolInvokeResponse(BaseModel):
    success: bool
    request: dict
    result: dict | None = None
    error: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _get_server_or_404(server_id: int, db: Session) -> McpServer:
    server = db.query(McpServer).filter(McpServer.id == server_id).first()
    if not server:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"MCP server with id {server_id} not found",
        )
    return server


# ---------------------------------------------------------------------------
# CRUD endpoints
# ---------------------------------------------------------------------------
@router.post("", response_model=McpServerResponse, status_code=status.HTTP_201_CREATED)
def create_mcp_server(
    request: McpServerCreateRequest,
    user: UserInfo = Depends(require_scopes("mcp:write")),
    db: Session = Depends(get_db),
) -> McpServerResponse:
    server = McpServer(
        name=request.name,
        description=request.description,
        endpoint_url=request.endpoint_url,
        transport_type=request.transport_type,
        auth_type=request.auth_type,
        oauth2_well_known_url=request.oauth2_well_known_url,
        oauth2_client_id=request.oauth2_client_id,
        oauth2_client_secret=request.oauth2_client_secret,
        oauth2_scopes=request.oauth2_scopes,
    )
    db.add(server)
    db.commit()
    db.refresh(server)
    return McpServerResponse(**server.to_dict())


@router.get("", response_model=list[McpServerResponse])
def list_mcp_servers(
    user: UserInfo = Depends(require_scopes("mcp:read")),
    db: Session = Depends(get_db),
) -> list[McpServerResponse]:
    servers = db.query(McpServer).order_by(McpServer.created_at.desc()).all()
    return [McpServerResponse(**s.to_dict()) for s in servers]


@router.get("/{server_id}", response_model=McpServerResponse)
def get_mcp_server(
    server_id: int,
    user: UserInfo = Depends(require_scopes("mcp:read")),
    db: Session = Depends(get_db),
) -> McpServerResponse:
    server = _get_server_or_404(server_id, db)
    return McpServerResponse(**server.to_dict())


@router.put("/{server_id}", response_model=McpServerResponse)
def update_mcp_server(
    server_id: int,
    request: McpServerUpdateRequest,
    user: UserInfo = Depends(require_scopes("mcp:write")),
    db: Session = Depends(get_db),
) -> McpServerResponse:
    server = _get_server_or_404(server_id, db)

    update_data = request.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(server, field, value)

    server.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(server)
    return McpServerResponse(**server.to_dict())


@router.delete("/{server_id}", response_model=McpServerResponse)
def delete_mcp_server(
    server_id: int,
    user: UserInfo = Depends(require_scopes("mcp:write")),
    db: Session = Depends(get_db),
) -> McpServerResponse:
    server = _get_server_or_404(server_id, db)
    result = McpServerResponse(**server.to_dict())
    db.delete(server)
    db.commit()
    return result


# ---------------------------------------------------------------------------
# Connection test
# ---------------------------------------------------------------------------
class TestConnectionRequest(BaseModel):
    endpoint_url: str = Field(..., description="MCP server endpoint URL")
    transport_type: str = Field(default="sse", description="Transport type: 'sse' or 'streamable_http'")
    auth_type: str = Field(default="none", description="Auth type: 'none' or 'oauth2'")
    oauth2_well_known_url: str | None = None
    oauth2_client_id: str | None = None
    oauth2_client_secret: str | None = None
    oauth2_scopes: str | None = None


@router.post("/test-connection", response_model=TestConnectionResponse)
def test_connection_pre_create(
    request: TestConnectionRequest,
    user: UserInfo = Depends(require_scopes("mcp:write")),
) -> TestConnectionResponse:
    result = svc_test_connection(request)
    return TestConnectionResponse(**result)


@router.post("/{server_id}/test-connection", response_model=TestConnectionResponse)
def test_connection(
    server_id: int,
    user: UserInfo = Depends(require_scopes("mcp:write")),
    db: Session = Depends(get_db),
) -> TestConnectionResponse:
    server = _get_server_or_404(server_id, db)
    result = svc_test_connection(server)
    return TestConnectionResponse(**result)


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------
@router.get("/{server_id}/tools", response_model=list[McpToolResponse])
def get_mcp_tools(
    server_id: int,
    user: UserInfo = Depends(require_scopes("mcp:read")),
    db: Session = Depends(get_db),
) -> list[McpToolResponse]:
    _get_server_or_404(server_id, db)
    tools = db.query(McpTool).filter(McpTool.server_id == server_id).all()
    return [McpToolResponse(**t.to_dict()) for t in tools]


@router.post("/{server_id}/tools/refresh", response_model=list[McpToolResponse])
def refresh_mcp_tools(
    server_id: int,
    user: UserInfo = Depends(require_scopes("mcp:write")),
    db: Session = Depends(get_db),
) -> list[McpToolResponse]:
    server = _get_server_or_404(server_id, db)

    fetched_tools = svc_fetch_tools(server)

    # Clear existing tools
    db.query(McpTool).filter(McpTool.server_id == server_id).delete()

    now = datetime.utcnow()
    new_tools = []
    for tool_data in fetched_tools:
        tool = McpTool(
            server_id=server_id,
            tool_name=tool_data.get("name", ""),
            description=tool_data.get("description"),
            last_refreshed_at=now,
        )
        schema = tool_data.get("input_schema")
        if schema:
            tool.set_input_schema(schema)
        db.add(tool)
        new_tools.append(tool)

    db.commit()
    for t in new_tools:
        db.refresh(t)

    return [McpToolResponse(**t.to_dict()) for t in new_tools]


@router.post("/{server_id}/tools/invoke", response_model=ToolInvokeResponse)
def invoke_mcp_tool(
    server_id: int,
    request: ToolInvokeRequest,
    user: UserInfo = Depends(require_scopes("mcp:write")),
    db: Session = Depends(get_db),
) -> ToolInvokeResponse:
    server = _get_server_or_404(server_id, db)
    result = svc_invoke_tool(server, request.tool_name, request.arguments)
    return ToolInvokeResponse(**result)


# ---------------------------------------------------------------------------
# Access rules
# ---------------------------------------------------------------------------
@router.get("/{server_id}/access", response_model=list[McpAccessRuleResponse])
def get_access_rules(
    server_id: int,
    user: UserInfo = Depends(require_scopes("mcp:read")),
    db: Session = Depends(get_db),
) -> list[McpAccessRuleResponse]:
    _get_server_or_404(server_id, db)
    rules = db.query(McpServerAccess).filter(McpServerAccess.server_id == server_id).all()
    return [McpAccessRuleResponse(**r.to_dict()) for r in rules]


@router.put("/{server_id}/access", response_model=list[McpAccessRuleResponse])
def update_access_rules(
    server_id: int,
    request: McpAccessUpdateRequest,
    user: UserInfo = Depends(require_scopes("mcp:write")),
    db: Session = Depends(get_db),
) -> list[McpAccessRuleResponse]:
    _get_server_or_404(server_id, db)

    # Replace all existing rules
    db.query(McpServerAccess).filter(McpServerAccess.server_id == server_id).delete()

    now = datetime.utcnow()
    new_rules = []
    for rule_input in request.rules:
        rule = McpServerAccess(
            server_id=server_id,
            persona_id=rule_input.persona_id,
            access_level=rule_input.access_level,
            created_at=now,
            updated_at=now,
        )
        if rule_input.allowed_tool_names is not None:
            rule.set_allowed_tool_names(rule_input.allowed_tool_names)
        db.add(rule)
        new_rules.append(rule)

    db.commit()
    for r in new_rules:
        db.refresh(r)

    return [McpAccessRuleResponse(**r.to_dict()) for r in new_rules]
