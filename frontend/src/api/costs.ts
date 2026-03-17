import { apiFetch } from "./client";
import type { CostDashboardResponse, ModelPricing } from "./types";

export async function fetchModelPricing(): Promise<ModelPricing[]> {
  return apiFetch<ModelPricing[]>("/api/agents/models/pricing");
}

export async function fetchCostDashboard(
  days: number = 30,
  group?: string
): Promise<CostDashboardResponse> {
  const params = new URLSearchParams({ days: String(days) });
  if (group) params.set("group", group);
  return apiFetch<CostDashboardResponse>(`/api/dashboard/costs?${params}`);
}
