import { useState, useEffect, useCallback, useRef } from "react";
import type { AgentResponse, AgentDeployRequest } from "@/api/types";
import * as agentsApi from "@/api/agents";

const POLL_INTERVAL_MS = 5000;

function needsPolling(agent: AgentResponse): boolean {
  return (
    agent.source === "deploy" &&
    (agent.status === "CREATING" ||
      agent.deployment_status === "deploying" ||
      agent.deployment_status === "ENDPOINT_CREATING" ||
      agent.endpoint_status === "CREATING")
  );
}

export function useAgents() {
  const [agents, setAgents] = useState<AgentResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await agentsApi.listAgents();
      setAgents(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch agents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  // Status polling for agents that are still creating
  useEffect(() => {
    const agentsToWatch = agents.filter(needsPolling);
    if (agentsToWatch.length === 0) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    if (pollRef.current) {
      clearInterval(pollRef.current);
    }

    pollRef.current = setInterval(async () => {
      const currentAgents = agents.filter(needsPolling);
      if (currentAgents.length === 0) {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        return;
      }

      for (const agent of currentAgents) {
        try {
          const updated = await agentsApi.fetchAgentStatus(agent.id);
          setAgents((prev) =>
            prev.map((a) => (a.id === updated.id ? updated : a)),
          );
        } catch {
          // Ignore individual poll failures
        }
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [agents]);

  const registerAgent = useCallback(
    async (arn: string, modelId?: string) => {
      const agent = await agentsApi.registerAgent({ source: "register", arn, model_id: modelId });
      await fetchAgents();
      return agent;
    },
    [fetchAgents],
  );

  const deployAgent = useCallback(
    async (request: AgentDeployRequest) => {
      const agent = await agentsApi.deployAgent(request);
      await fetchAgents();
      return agent;
    },
    [fetchAgents],
  );

  const redeployAgent = useCallback(
    async (id: number) => {
      const agent = await agentsApi.redeployAgent(id);
      await fetchAgents();
      return agent;
    },
    [fetchAgents],
  );

  const refreshAgent = useCallback(
    async (id: number) => {
      const agent = await agentsApi.refreshAgent(id);
      await fetchAgents();
      return agent;
    },
    [fetchAgents],
  );

  const deleteAgent = useCallback(
    async (id: number, cleanupAws: boolean = false) => {
      await agentsApi.deleteAgent(id, cleanupAws);
      await fetchAgents();
    },
    [fetchAgents],
  );

  return { agents, loading, error, fetchAgents, registerAgent, deployAgent, redeployAgent, refreshAgent, deleteAgent };
}
