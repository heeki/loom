import { useState, useCallback } from "react";
import type { LogEvent } from "@/api/types";
import { getSessionLogs } from "@/api/logs";

export function useLogs() {
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSessionLogs = useCallback(
    async (agentId: number, sessionId: string, qualifier = "DEFAULT") => {
      setLoading(true);
      try {
        const data = await getSessionLogs(agentId, sessionId, qualifier);
        setLogs(data.events);
      } catch {
        setLogs([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { logs, loading, fetchSessionLogs };
}
