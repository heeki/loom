import { useState, useEffect, useCallback, useRef } from "react";
import type { SSESessionStart, SSESessionEnd } from "@/api/types";
import { invokeAgentStream } from "@/api/invocations";
import { friendlyInvokeError } from "@/lib/errors";

/**
 * Module-level store so that in-flight streams survive component
 * unmount/remount (e.g. navigating away from the agent detail page
 * and coming back).  Keyed by agentId.
 */

interface InvokeSnapshot {
  streamedText: string;
  sessionStart: SSESessionStart | null;
  sessionEnd: SSESessionEnd | null;
  isStreaming: boolean;
  error: string | null;
  rawError: string | null;
}

const EMPTY: InvokeSnapshot = {
  streamedText: "",
  sessionStart: null,
  sessionEnd: null,
  isStreaming: false,
  error: null,
  rawError: null,
};

type Listener = () => void;

const _state = new Map<number, InvokeSnapshot>();
const _controllers = new Map<number, AbortController>();
const _listeners = new Map<number, Set<Listener>>();

function _get(agentId: number): InvokeSnapshot {
  return _state.get(agentId) ?? EMPTY;
}

function _update(agentId: number, partial: Partial<InvokeSnapshot>) {
  const current = _state.get(agentId) ?? { ...EMPTY };
  _state.set(agentId, { ...current, ...partial });
  _listeners.get(agentId)?.forEach((fn) => fn());
}

function _subscribe(agentId: number, listener: Listener): () => void {
  if (!_listeners.has(agentId)) _listeners.set(agentId, new Set());
  _listeners.get(agentId)!.add(listener);
  return () => {
    _listeners.get(agentId)?.delete(listener);
  };
}

async function _startInvoke(
  agentId: number,
  prompt: string,
  qualifier: string,
  authorizerName: string | undefined,
  sessionId?: string,
  credentialId?: number,
  bearerToken?: string,
) {
  // Abort any in-flight stream for this agent
  _controllers.get(agentId)?.abort();
  const controller = new AbortController();
  _controllers.set(agentId, controller);

  _update(agentId, {
    streamedText: "",
    sessionStart: null,
    sessionEnd: null,
    isStreaming: true,
    error: null,
    rawError: null,
  });

  try {
    await invokeAgentStream(
      agentId,
      {
        prompt,
        qualifier,
        ...(sessionId ? { session_id: sessionId } : {}),
        ...(credentialId ? { credential_id: credentialId } : {}),
        ...(bearerToken ? { bearer_token: bearerToken } : {}),
      },
      {
        onSessionStart: (data) => _update(agentId, { sessionStart: data }),
        onChunk: (data) => {
          const cur = _get(agentId);
          _update(agentId, { streamedText: cur.streamedText + data.text });
        },
        onSessionEnd: (data) => {
          _update(agentId, { sessionEnd: data, isStreaming: false });
        },
        onError: (data) => {
          _update(agentId, {
            error: friendlyInvokeError(data.message, authorizerName),
            rawError: data.message,
            isStreaming: false,
          });
        },
      },
      controller.signal,
    );
    // Stream finished — clear isStreaming even if no session_end was received
    _update(agentId, { isStreaming: false });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    const msg = e instanceof Error ? e.message : "Invocation failed";
    _update(agentId, {
      error: friendlyInvokeError(msg, authorizerName),
      rawError: msg,
      isStreaming: false,
    });
  }
}

function _cancel(agentId: number) {
  _controllers.get(agentId)?.abort();
  _update(agentId, { isStreaming: false });
}

// ---------------------------------------------------------------------------
// React hook — subscribes to the module-level store for a given agentId.
// The stream runs independently of component lifecycle.
// ---------------------------------------------------------------------------

export function useInvoke(agentId: number, authorizerName?: string) {
  const [snapshot, setSnapshot] = useState<InvokeSnapshot>(() => _get(agentId));
  const authorizerRef = useRef(authorizerName);
  authorizerRef.current = authorizerName;

  useEffect(() => {
    // Sync immediately in case state changed while unmounted
    setSnapshot(_get(agentId));
    return _subscribe(agentId, () => setSnapshot({ ..._get(agentId) }));
  }, [agentId]);

  const invoke = useCallback(
    async (prompt: string, qualifier: string, sessionId?: string, credentialId?: number, bearerToken?: string) => {
      await _startInvoke(agentId, prompt, qualifier, authorizerRef.current, sessionId, credentialId, bearerToken);
    },
    [agentId],
  );

  const cancel = useCallback(() => {
    _cancel(agentId);
  }, [agentId]);

  return {
    streamedText: snapshot.streamedText,
    sessionStart: snapshot.sessionStart,
    sessionEnd: snapshot.sessionEnd,
    isStreaming: snapshot.isStreaming,
    error: snapshot.error,
    rawError: snapshot.rawError,
    invoke,
    cancel,
  };
}
