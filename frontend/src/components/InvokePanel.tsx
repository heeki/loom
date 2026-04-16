import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listAuthorizerConfigs, listAuthorizerCredentials } from "@/api/security";
import { fetchModels } from "@/api/agents";
import type { SessionResponse, AuthorizerCredential, ModelOption } from "@/api/types";

const NEW_SESSION = "__new__";
const USER_TOKEN = "__user__";
const NO_CREDENTIAL = "__none__";
const MANUAL_TOKEN = "__manual__";

interface InvokePanelProps {
  agentId: number;
  qualifiers: string[];
  sessions: SessionResponse[];
  isStreaming: boolean;
  modelId?: string | null;
  allowedModelIds?: string[];
  authorizerName?: string;
  currentUserId?: string;
  onInvoke: (prompt: string, qualifier: string, sessionId?: string, credentialId?: number, bearerToken?: string, modelId?: string) => void;
  onCancel: () => void;
}

export function InvokePanel({ agentId, qualifiers, sessions, isStreaming, modelId, allowedModelIds = [], authorizerName, currentUserId, onInvoke, onCancel }: InvokePanelProps) {
  const promptKey = `loom:invokePrompt:${agentId}`;
  const [prompt, setPrompt] = useState(() => sessionStorage.getItem(promptKey) ?? "");

  useEffect(() => {
    if (prompt) {
      sessionStorage.setItem(promptKey, prompt);
    } else {
      sessionStorage.removeItem(promptKey);
    }
  }, [prompt, promptKey]);
  const [qualifier, setQualifier] = useState(qualifiers[0] ?? "DEFAULT");
  const [selectedSession, setSelectedSession] = useState(NEW_SESSION);
  const [selectedCredential, setSelectedCredential] = useState(authorizerName ? USER_TOKEN : NO_CREDENTIAL);
  const [bearerToken, setBearerToken] = useState("");
  const [allCredentials, setAllCredentials] = useState<(AuthorizerCredential & { authorizer_name: string })[]>([]);
  const [selectedModel, setSelectedModel] = useState(modelId ?? "");
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);

  useEffect(() => {
    setSelectedModel(modelId ?? "");
  }, [modelId, agentId]);

  useEffect(() => {
    if (!modelId) return;
    let cancelled = false;
    fetchModels().then((models) => {
      if (!cancelled) setModelOptions(models);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [modelId]);

  const filteredModels = allowedModelIds.length > 0
    ? modelOptions.filter((m) => allowedModelIds.includes(m.model_id))
    : modelId
      ? modelOptions.filter((m) => m.model_id === modelId)
      : [];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const configs = await listAuthorizerConfigs();
        const results: (AuthorizerCredential & { authorizer_name: string })[] = [];
        for (const config of configs) {
          const creds = await listAuthorizerCredentials(config.id);
          for (const cred of creds) {
            if (cred.has_secret) {
              results.push({ ...cred, authorizer_name: config.name });
            }
          }
        }
        if (!cancelled) setAllCredentials(results);
      } catch {
        // Silently fail — credentials are optional
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Filter sessions that match the selected qualifier, are not expired,
  // and belong to the current user (or have no owner recorded yet)
  const matchingSessions = sessions.filter(
    (s) => s.qualifier === qualifier &&
      s.live_status !== "expired" &&
      (!s.user_id || !currentUserId || s.user_id === currentUserId)
  );

  // Track the baseline session IDs so we can detect genuinely new ones
  const prevSessionIdsRef = useRef<Set<string>>(new Set<string>());
  // True until the first session batch for this agent has been seen
  const initialLoadDoneRef = useRef(false);

  // Reset state when the agent changes
  useEffect(() => {
    setSelectedSession(NEW_SESSION);
    prevSessionIdsRef.current = new Set();
    initialLoadDoneRef.current = false;
  }, [agentId]);

  // Auto-select only a genuinely new session (created by an invocation), not
  // sessions that were already there when the component first rendered.
  useEffect(() => {
    if (!initialLoadDoneRef.current) {
      // First batch: populate the baseline without triggering auto-select
      prevSessionIdsRef.current = new Set(matchingSessions.map((s) => s.session_id));
      initialLoadDoneRef.current = true;
      return;
    }
    const prevIds = prevSessionIdsRef.current;
    const newSession = matchingSessions.find((s) => !prevIds.has(s.session_id));
    if (newSession && selectedSession === NEW_SESSION) {
      setSelectedSession(newSession.session_id);
    }
    prevSessionIdsRef.current = new Set(matchingSessions.map((s) => s.session_id));
  }, [matchingSessions, selectedSession]);

  // If the currently selected session expires and is filtered out, reset to NEW_SESSION
  useEffect(() => {
    if (
      selectedSession !== NEW_SESSION &&
      matchingSessions.length > 0 &&
      !matchingSessions.some((s) => s.session_id === selectedSession)
    ) {
      setSelectedSession(NEW_SESSION);
    }
  }, [matchingSessions, selectedSession]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isStreaming) return;
    const sessionId = selectedSession === NEW_SESSION ? undefined : selectedSession;
    const credentialId = selectedCredential === USER_TOKEN || selectedCredential === NO_CREDENTIAL || selectedCredential === MANUAL_TOKEN
      ? undefined : Number(selectedCredential);
    const token = selectedCredential === MANUAL_TOKEN && bearerToken.trim()
      ? bearerToken.trim() : undefined;
    const runtimeModelId = selectedModel && selectedModel !== modelId ? selectedModel : undefined;
    onInvoke(prompt.trim(), qualifier, sessionId, credentialId, token, runtimeModelId);
  };

  const handleQualifierChange = (value: string) => {
    setQualifier(value);
    // Reset session selection when qualifier changes
    setSelectedSession(NEW_SESSION);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-medium">Invoke Agent</CardTitle>
          {filteredModels.length > 1 ? (
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger className="w-56 h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {filteredModels.map((m) => (
                  <SelectItem key={m.model_id} value={m.model_id}>
                    {m.display_name}{m.model_id === modelId ? " (default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : filteredModels.length === 1 ? (
            <Badge variant="outline" className="border-border bg-input-bg text-xs font-normal">
              {filteredModels[0]!.display_name}
            </Badge>
          ) : modelId ? (
            <Badge variant="outline" className="border-border bg-input-bg text-xs font-normal">
              {modelId}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Textarea
            placeholder="Enter your prompt..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
          />
          <div className="flex gap-3 flex-wrap">
            {qualifiers.length > 0 && (
              <Select value={qualifier} onValueChange={handleQualifierChange}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {qualifiers.map((q) => (
                    <SelectItem key={q} value={q}>
                      {q}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={selectedSession} onValueChange={setSelectedSession}>
              <SelectTrigger className="w-80">
                <SelectValue placeholder="New session" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_SESSION}>New session</SelectItem>
                {matchingSessions.map((s) => (
                  <SelectItem key={s.session_id} value={s.session_id}>
                    <span className="font-mono text-xs">{s.session_id}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedCredential} onValueChange={(v) => { setSelectedCredential(v); if (v !== MANUAL_TOKEN) setBearerToken(""); }}>
              <SelectTrigger className="w-96">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {authorizerName ? (
                  <>
                    <SelectItem value={USER_TOKEN}>{authorizerName} / current user&apos;s token</SelectItem>
                    {allCredentials.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.authorizer_name} / {c.label}
                      </SelectItem>
                    ))}
                    <SelectItem value={MANUAL_TOKEN}>{authorizerName} / manual token</SelectItem>
                  </>
                ) : (
                  <SelectItem value={NO_CREDENTIAL}>No credentials (SigV4)</SelectItem>
                )}
              </SelectContent>
            </Select>
            {selectedCredential === MANUAL_TOKEN && (
              <Input
                type="password"
                placeholder="Paste bearer token..."
                value={bearerToken}
                onChange={(e) => setBearerToken(e.target.value)}
                className="w-80"
              />
            )}
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={isStreaming || !prompt.trim()}>
              {isStreaming ? "Streaming..." : "Invoke"}
            </Button>
            {isStreaming && (
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
