import { useState, useRef, useCallback, useEffect } from "react";
import type { SSESessionStart, SSESessionEnd } from "@/api/types";
import { invokeAgentStream } from "@/api/invocations";

export function useInvoke() {
  const [streamedText, setStreamedText] = useState("");
  const [sessionStart, setSessionStart] = useState<SSESessionStart | null>(null);
  const [sessionEnd, setSessionEnd] = useState<SSESessionEnd | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const invoke = useCallback(
    async (agentId: number, prompt: string, qualifier = "DEFAULT", sessionId?: string, credentialId?: number) => {
      // Abort any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Reset state
      setStreamedText("");
      setSessionStart(null);
      setSessionEnd(null);
      setError(null);
      setIsStreaming(true);

      try {
        await invokeAgentStream(
          agentId,
          {
            prompt,
            qualifier,
            ...(sessionId ? { session_id: sessionId } : {}),
            ...(credentialId ? { credential_id: credentialId } : {}),
          },
          {
            onSessionStart: (data) => setSessionStart(data),
            onChunk: (data) => setStreamedText((prev) => prev + data.text),
            onSessionEnd: (data) => {
              setSessionEnd(data);
              setIsStreaming(false);
            },
            onError: (data) => {
              setError(data.message);
              setIsStreaming(false);
            },
          },
          controller.signal,
        );
        // Stream finished — ensure isStreaming is cleared even if no
        // session_end/error event was received (e.g., connection drop)
        setIsStreaming(false);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Invocation failed");
      } finally {
        setIsStreaming(false);
      }
    },
    [],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return { streamedText, sessionStart, sessionEnd, isStreaming, error, invoke, cancel };
}
