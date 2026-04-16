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
  currentToolName: string | null;
  error: string | null;
  rawError: string | null;
}

const EMPTY: InvokeSnapshot = {
  streamedText: "",
  sessionStart: null,
  sessionEnd: null,
  isStreaming: false,
  currentToolName: null,
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
  modelId?: string,
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
    currentToolName: null,
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
        ...(modelId ? { model_id: modelId } : {}),
      },
      {
        onSessionStart: (data) => _update(agentId, { sessionStart: data }),
        onChunk: (data) => {
          const cur = _get(agentId);
          _update(agentId, { streamedText: cur.streamedText + data.text, currentToolName: null });
        },
        onToolUse: (data) => {
          _update(agentId, { currentToolName: data.name });
        },
        onSessionEnd: (data) => {
          _update(agentId, { sessionEnd: data, isStreaming: false, currentToolName: null });
        },
        onError: (data) => {
          _update(agentId, {
            error: friendlyInvokeError(data.message, authorizerName),
            rawError: data.message,
            isStreaming: false,
            currentToolName: null,
          });
        },
      },
      controller.signal,
    );
    // Stream finished — clear isStreaming even if no session_end was received
    _update(agentId, { isStreaming: false, currentToolName: null });
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

export function clearInvokeState(agentId: number) {
  _controllers.get(agentId)?.abort();
  _controllers.delete(agentId);
  // Reset state to EMPTY and notify subscribers — do NOT delete listeners so
  // the component stays subscribed and sees subsequent invocations.
  _update(agentId, { ...EMPTY });
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
    const current = _get(agentId);
    // Clear error when switching to a new agent
    if (current.error) {
      _update(agentId, { error: null, rawError: null });
    }
    setSnapshot(_get(agentId));
    return _subscribe(agentId, () => setSnapshot({ ..._get(agentId) }));
  }, [agentId]);

  const invoke = useCallback(
    async (prompt: string, qualifier: string, sessionId?: string, credentialId?: number, bearerToken?: string, modelId?: string) => {
      await _startInvoke(agentId, prompt, qualifier, authorizerRef.current, sessionId, credentialId, bearerToken, modelId);
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
    currentToolName: snapshot.currentToolName,
    error: snapshot.error,
    rawError: snapshot.rawError,
    invoke,
    cancel,
  };
}
