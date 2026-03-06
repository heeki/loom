import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
const NO_CREDENTIAL = "__none__";

interface InvokePanelProps {
  qualifiers: string[];
  sessions: SessionResponse[];
  isStreaming: boolean;
  modelId?: string | null;
  onInvoke: (prompt: string, qualifier: string, sessionId?: string, credentialId?: number) => void;
  onCancel: () => void;
}

export function InvokePanel({ qualifiers, sessions, isStreaming, modelId, onInvoke, onCancel }: InvokePanelProps) {
  const [prompt, setPrompt] = useState("");
  const [qualifier, setQualifier] = useState(qualifiers[0] ?? "DEFAULT");
  const [selectedSession, setSelectedSession] = useState(NEW_SESSION);
  const [selectedCredential, setSelectedCredential] = useState(NO_CREDENTIAL);
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isStreaming) return;
    const sessionId = selectedSession === NEW_SESSION ? undefined : selectedSession;
    const credentialId = selectedCredential === NO_CREDENTIAL ? undefined : Number(selectedCredential);
    onInvoke(prompt.trim(), qualifier, sessionId, credentialId);
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
            {allCredentials.length > 0 && (
              <Select value={selectedCredential} onValueChange={setSelectedCredential}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="No credential" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CREDENTIAL}>No credential</SelectItem>
                  {allCredentials.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.authorizer_name} / {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
