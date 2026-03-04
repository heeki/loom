import { useState, useEffect, useCallback } from "react";
import type { AgentResponse } from "@/api/types";
import * as agentsApi from "@/api/agents";

export function useAgents() {
  const [agents, setAgents] = useState<AgentResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const registerAgent = useCallback(
    async (arn: string) => {
      const agent = await agentsApi.registerAgent({ arn });
      await fetchAgents();
      return agent;
    },
    [fetchAgents],
  );

  const deployAgent = useCallback(
    async (name: string, codeUri: string, config?: Record<string, string>) => {
      const agent = await agentsApi.deployAgent({ name, code_uri: codeUri, config });
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
    async (id: number) => {
      await agentsApi.deleteAgent(id);
      await fetchAgents();
    },
    [fetchAgents],
  );

  return { agents, loading, error, fetchAgents, registerAgent, deployAgent, redeployAgent, refreshAgent, deleteAgent };
}
