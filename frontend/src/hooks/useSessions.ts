import { useState, useEffect, useCallback } from "react";
import type { SessionResponse } from "@/api/types";
import { listSessions } from "@/api/invocations";

export function useSessions(agentId: number | null) {
  const [sessions, setSessions] = useState<SessionResponse[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSessions = useCallback(async () => {
    if (agentId === null) {
      setSessions([]);
      return;
    }
    setLoading(true);
    try {
      const data = await listSessions(agentId);
      setSessions(data);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  return { sessions, loading, refetch: fetchSessions };
}
