import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SessionResponse } from "@/api/types";

const NEW_SESSION = "__new__";

interface InvokePanelProps {
  qualifiers: string[];
  sessions: SessionResponse[];
  isStreaming: boolean;
  onInvoke: (prompt: string, qualifier: string, sessionId?: string) => void;
  onCancel: () => void;
}

export function InvokePanel({ qualifiers, sessions, isStreaming, onInvoke, onCancel }: InvokePanelProps) {
  const [prompt, setPrompt] = useState("");
  const [qualifier, setQualifier] = useState(qualifiers[0] ?? "DEFAULT");
  const [selectedSession, setSelectedSession] = useState(NEW_SESSION);

  // Filter sessions that match the selected qualifier
  const matchingSessions = sessions.filter((s) => s.qualifier === qualifier);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isStreaming) return;
    const sessionId = selectedSession === NEW_SESSION ? undefined : selectedSession;
    onInvoke(prompt.trim(), qualifier, sessionId);
  };

  const handleQualifierChange = (value: string) => {
    setQualifier(value);
    // Reset session selection when qualifier changes
    setSelectedSession(NEW_SESSION);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Invoke Agent</CardTitle>
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
                <SelectValue placeholder="New Session" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_SESSION}>New Session</SelectItem>
                {matchingSessions.map((s) => (
                  <SelectItem key={s.session_id} value={s.session_id}>
                    <span className="font-mono text-xs">{s.session_id}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
