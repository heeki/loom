import { useState, useCallback } from "react";
import type { LogEvent, LogStreamInfo } from "@/api/types";
import { getSessionLogs, listLogStreams, getAgentLogs } from "@/api/logs";

export function useLogs() {
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [streams, setStreams] = useState<LogStreamInfo[]>([]);
  const [streamsLoading, setStreamsLoading] = useState(false);
  const [activeStream, setActiveStream] = useState<string>("");

  const fetchSessionLogs = useCallback(
    async (agentId: number, sessionId: string, qualifier = "DEFAULT") => {
      setLoading(true);
      try {
        const data = await getSessionLogs(agentId, sessionId, qualifier);
        setLogs(data.events);
        setActiveStream("");
      } catch {
        setLogs([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const fetchLogStreams = useCallback(
    async (agentId: number, qualifier = "DEFAULT") => {
      setStreamsLoading(true);
      try {
        const data = await listLogStreams(agentId, qualifier);
        setStreams(data.streams);
      } catch {
        setStreams([]);
      } finally {
        setStreamsLoading(false);
      }
    },
    [],
  );

  const fetchStreamLogs = useCallback(
    async (agentId: number, qualifier = "DEFAULT", streamName: string) => {
      setLoading(true);
      try {
        const data = await getAgentLogs(agentId, qualifier, { stream: streamName });
        setLogs(data.events);
        setActiveStream(streamName);
      } catch {
        setLogs([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return {
    logs,
    loading,
    streams,
    streamsLoading,
    activeStream,
    fetchSessionLogs,
    fetchLogStreams,
    fetchStreamLogs,
  };
}
