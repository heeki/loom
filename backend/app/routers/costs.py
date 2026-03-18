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

_ZERO_COSTS: dict[str, Any] = {
    "total_invocations": 0,
    "total_input_tokens": 0,
    "total_output_tokens": 0,
    "total_estimated_cost": 0.0,
    "total_compute_cpu_cost": 0.0,
    "total_compute_memory_cost": 0.0,
    "total_idle_cpu_cost": 0.0,
    "total_idle_memory_cost": 0.0,
    "total_stm_cost": 0.0,
    "total_ltm_cost": 0.0,
}


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
        return {"group": group, "days": days, **_ZERO_COSTS, "agents": []}

    # Build invocation query with time filter
    inv_query = db.query(Invocation).join(
        InvocationSession, Invocation.session_id == InvocationSession.session_id
    ).filter(InvocationSession.agent_id.in_(agent_ids))

    if days > 0:
        cutoff = datetime.utcnow() - timedelta(days=days)
        inv_query = inv_query.filter(Invocation.created_at >= cutoff)

    # Aggregate per agent
    agent_costs: list[dict[str, Any]] = []
    totals = {k: 0 if isinstance(v, int) else 0.0 for k, v in _ZERO_COSTS.items()}

    for agent in agents:
        q = inv_query.filter(InvocationSession.agent_id == agent.id)

        inv_count = q.count()
        if inv_count == 0:
            continue

        input_sum = q.with_entities(func.sum(Invocation.input_tokens)).scalar() or 0
        output_sum = q.with_entities(func.sum(Invocation.output_tokens)).scalar() or 0
        est_cost = q.with_entities(func.sum(Invocation.estimated_cost)).scalar() or 0.0
        compute_cpu = q.with_entities(func.sum(Invocation.compute_cpu_cost)).scalar() or 0.0
        compute_mem = q.with_entities(func.sum(Invocation.compute_memory_cost)).scalar() or 0.0
        idle_cpu = q.with_entities(func.sum(Invocation.idle_cpu_cost)).scalar() or 0.0
        idle_mem = q.with_entities(func.sum(Invocation.idle_memory_cost)).scalar() or 0.0
        stm = q.with_entities(func.sum(Invocation.stm_cost)).scalar() or 0.0
        ltm = q.with_entities(func.sum(Invocation.ltm_cost)).scalar() or 0.0

        # Derived totals — idle is memory only (no CPU during idle)
        rt_cpu = compute_cpu
        rt_mem = compute_mem + idle_mem
        rt_total = rt_cpu + rt_mem
        mem_total = stm + ltm
        grand_total = est_cost + rt_total + mem_total

        entry: dict[str, Any] = {
            "agent_id": agent.id,
            "agent_name": agent.name,
            "model_id": None,
            "total_invocations": inv_count,
            "total_input_tokens": input_sum,
            "total_output_tokens": output_sum,
            "total_estimated_cost": round(est_cost, 6),
            "total_compute_cpu_cost": round(compute_cpu, 6),
            "total_compute_memory_cost": round(compute_mem, 6),
            "total_idle_cpu_cost": round(idle_cpu, 6),
            "total_idle_memory_cost": round(idle_mem, 6),
            "total_stm_cost": round(stm, 6),
            "total_ltm_cost": round(ltm, 6),
            "avg_cost_per_invocation": round(grand_total / inv_count, 6) if inv_count else 0,
        }

        # Extract model_id from config entries
        config_map = {e.key: e.value for e in agent.config_entries}
        config_json_str = config_map.get("AGENT_CONFIG_JSON", "")
        if config_json_str:
            try:
                config = json.loads(config_json_str)
                entry["model_id"] = config.get("model_id")
            except (json.JSONDecodeError, TypeError):
                pass

        agent_costs.append(entry)

        totals["total_invocations"] += inv_count
        totals["total_input_tokens"] += input_sum
        totals["total_output_tokens"] += output_sum
        totals["total_estimated_cost"] += est_cost
        totals["total_compute_cpu_cost"] += compute_cpu
        totals["total_compute_memory_cost"] += compute_mem
        totals["total_idle_cpu_cost"] += idle_cpu
        totals["total_idle_memory_cost"] += idle_mem
        totals["total_stm_cost"] += stm
        totals["total_ltm_cost"] += ltm

    # Round float totals
    for k, v in totals.items():
        if isinstance(v, float):
            totals[k] = round(v, 6)

    return {
        "group": group,
        "days": days,
        **totals,
        "agents": sorted(agent_costs, key=lambda x: (
            x["total_estimated_cost"]
            + x["total_compute_cpu_cost"]
            + x["total_compute_memory_cost"] + x["total_idle_memory_cost"]
            + x["total_stm_cost"] + x["total_ltm_cost"]
        ), reverse=True),
    }
