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
import type { SessionResponse, AuthorizerCredential } from "@/api/types";

const NEW_SESSION = "__new__";
const USER_TOKEN = "__user__";
const NO_CREDENTIAL = "__none__";
const MANUAL_TOKEN = "__manual__";

interface InvokePanelProps {
  qualifiers: string[];
  sessions: SessionResponse[];
  isStreaming: boolean;
  modelId?: string | null;
  authorizerName?: string;
  onInvoke: (prompt: string, qualifier: string, sessionId?: string, credentialId?: number, bearerToken?: string) => void;
  onCancel: () => void;
}

export function InvokePanel({ qualifiers, sessions, isStreaming, modelId, authorizerName, onInvoke, onCancel }: InvokePanelProps) {
  const [prompt, setPrompt] = useState("");
  const [qualifier, setQualifier] = useState(qualifiers[0] ?? "DEFAULT");
  const [selectedSession, setSelectedSession] = useState(NEW_SESSION);
  const [selectedCredential, setSelectedCredential] = useState(authorizerName ? USER_TOKEN : NO_CREDENTIAL);
  const [bearerToken, setBearerToken] = useState("");
  const [allCredentials, setAllCredentials] = useState<(AuthorizerCredential & { authorizer_name: string })[]>([]);

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

  // Filter sessions that match the selected qualifier and are not expired
  const matchingSessions = sessions.filter(
    (s) => s.qualifier === qualifier && s.live_status !== "expired"
  );

  // Auto-select the newest session after an invocation creates one
  const prevSessionIdsRef = useRef<Set<string>>(new Set(matchingSessions.map((s) => s.session_id)));
  useEffect(() => {
    const prevIds = prevSessionIdsRef.current;
    const newSession = matchingSessions.find((s) => !prevIds.has(s.session_id));
    if (newSession && selectedSession === NEW_SESSION) {
      setSelectedSession(newSession.session_id);
    }
    prevSessionIdsRef.current = new Set(matchingSessions.map((s) => s.session_id));
  }, [matchingSessions, selectedSession]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isStreaming) return;
    const sessionId = selectedSession === NEW_SESSION ? undefined : selectedSession;
    const credentialId = selectedCredential === USER_TOKEN || selectedCredential === NO_CREDENTIAL || selectedCredential === MANUAL_TOKEN
      ? undefined : Number(selectedCredential);
    const token = selectedCredential === MANUAL_TOKEN && bearerToken.trim()
      ? bearerToken.trim() : undefined;
    onInvoke(prompt.trim(), qualifier, sessionId, credentialId, token);
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
          {modelId && (
            <Badge variant="outline" className="border-border bg-input-bg text-xs font-normal">
              {modelId}
            </Badge>
          )}
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
