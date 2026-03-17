"""Cost dashboard endpoints for aggregated cost data."""
import json
import logging
from datetime import datetime, timedelta
from typing import Any
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies.auth import UserInfo, require_scopes
from app.models.agent import Agent
from app.models.invocation import Invocation
from app.models.session import InvocationSession

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/dashboard", tags=["costs"])


@router.get("/costs")
def get_cost_dashboard(
    group: str | None = Query(None, description="Filter by loom:group tag"),
    days: int = Query(30, description="Number of days to aggregate (0 = all time)"),
    user: UserInfo = Depends(require_scopes("catalog:read")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Aggregate cost data across agents, optionally filtered by group tag."""
    # Non-super-admins can only see their own group
    if "super-admins" not in user.groups and group is None:
        # Determine user's group
        for g in user.groups:
            if g != "users":
                group = g
                break
        else:
            group = "users"

    # Build agent query
    agent_query = db.query(Agent)
    if group:
        agent_query = agent_query.filter(Agent.tags.like(f'%"loom:group": "{group}"%'))
    agents = agent_query.all()
    agent_ids = [a.id for a in agents]

    if not agent_ids:
        return {
            "group": group,
            "days": days,
            "total_invocations": 0,
            "total_input_tokens": 0,
            "total_output_tokens": 0,
            "total_estimated_cost": 0.0,
            "agents": [],
        }

    # Build invocation query with time filter
    inv_query = db.query(Invocation).join(
        InvocationSession, Invocation.session_id == InvocationSession.session_id
    ).filter(InvocationSession.agent_id.in_(agent_ids))

    if days > 0:
        cutoff = datetime.utcnow() - timedelta(days=days)
        inv_query = inv_query.filter(Invocation.created_at >= cutoff)

    # Aggregate per agent
    agent_costs: list[dict[str, Any]] = []
    total_invocations = 0
    total_input_tokens = 0
    total_output_tokens = 0
    total_estimated_cost = 0.0

    for agent in agents:
        agent_inv_query = inv_query.filter(InvocationSession.agent_id == agent.id)

        inv_count = agent_inv_query.count()
        input_sum = agent_inv_query.with_entities(func.sum(Invocation.input_tokens)).scalar() or 0
        output_sum = agent_inv_query.with_entities(func.sum(Invocation.output_tokens)).scalar() or 0
        cost_sum = agent_inv_query.with_entities(func.sum(Invocation.estimated_cost)).scalar() or 0.0

        if inv_count > 0:
            agent_costs.append({
                "agent_id": agent.id,
                "agent_name": agent.name,
                "model_id": None,  # Will be filled below
                "total_invocations": inv_count,
                "total_input_tokens": input_sum,
                "total_output_tokens": output_sum,
                "total_estimated_cost": round(cost_sum, 6),
                "avg_cost_per_invocation": round(cost_sum / inv_count, 6) if inv_count else 0,
            })

            # Extract model_id from config entries
            config_map = {e.key: e.value for e in agent.config_entries}
            config_json_str = config_map.get("AGENT_CONFIG_JSON", "")
            if config_json_str:
                try:
                    config = json.loads(config_json_str)
                    agent_costs[-1]["model_id"] = config.get("model_id")
                except (json.JSONDecodeError, TypeError):
                    pass

            total_invocations += inv_count
            total_input_tokens += input_sum
            total_output_tokens += output_sum
            total_estimated_cost += cost_sum

    return {
        "group": group,
        "days": days,
        "total_invocations": total_invocations,
        "total_input_tokens": total_input_tokens,
        "total_output_tokens": total_output_tokens,
        "total_estimated_cost": round(total_estimated_cost, 6),
        "agents": sorted(agent_costs, key=lambda x: x["total_estimated_cost"], reverse=True),
    }
