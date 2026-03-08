import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Eraser, RefreshCw } from "lucide-react";
import { useTimezone } from "@/contexts/TimezoneContext";
import { formatTimestamp } from "@/lib/format";
import { statusVariant } from "@/lib/status";
import type { AgentResponse } from "@/api/types";

interface AgentCardProps {
  agent: AgentResponse;
  onSelect: (id: number) => void;
  onRefresh: (id: number) => void;
  onDelete: (id: number, cleanupAws: boolean) => void;
}

function isCreating(agent: AgentResponse): boolean {
  return (
    agent.status === "CREATING" ||
    agent.deployment_status === "deploying" ||
    agent.deployment_status === "ENDPOINT_CREATING" ||
    agent.endpoint_status === "CREATING"
  );
}

function existsInAgentCore(agent: AgentResponse): boolean {
  return !!agent.runtime_id;
}

export function AgentCard({ agent, onSelect, onRefresh, onDelete }: AgentCardProps) {
  const { timezone } = useTimezone();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [cleanupAws, setCleanupAws] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const creating = isCreating(agent);

  useEffect(() => {
    if (creating) {
      if (!timerRef.current) {
        timerRef.current = setInterval(() => setNow(Date.now()), 1000);
      }
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [creating]);

  const elapsedSeconds = (() => {
    if (!creating) return 0;
    const ts = agent.deployed_at ?? agent.registered_at;
    if (!ts) return 0;
    return Math.max(0, Math.floor((now - new Date(ts).getTime()) / 1000));
  })();

  const showCleanupOption = existsInAgentCore(agent);

  return (
    <Card
      className="relative cursor-pointer transition-colors hover:bg-accent/50 py-3 gap-1"
      onClick={() => onSelect(agent.id)}
    >
      <CardHeader className="gap-1 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-medium">
              {agent.name ?? agent.runtime_id}
            </CardTitle>
            {agent.protocol && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {agent.protocol}
              </Badge>
            )}
            <Badge variant={statusVariant(agent.status)} className="text-[10px] px-1.5 py-0">
              {agent.status ?? "unknown"}
            </Badge>
            {creating && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">
                  ({elapsedSeconds}s)
                </span>
              </>
            )}
            {agent.active_session_count > 0 && (
              <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-medium">
                {agent.active_session_count}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                setRefreshing(true);
                try { onRefresh(agent.id); } finally { setRefreshing(false); }
              }}
              disabled={refreshing}
              className="text-muted-foreground/50 hover:text-foreground transition-colors"
              title="Refresh"
            >
              {refreshing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmingRemove(true);
              }}
              className="text-muted-foreground/50 hover:text-destructive transition-colors"
              title="Remove agent"
            >
              <Eraser className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-xs text-muted-foreground">
        <div className="rounded border bg-input-bg p-3 space-y-0.5">
          <div>Region: {agent.region}</div>
          <div>Account: {agent.account_id}</div>
          {agent.network_mode && (
            <div>Network: {agent.network_mode}</div>
          )}
          {agent.available_qualifiers.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span>Endpoint:</span>
              {agent.available_qualifiers.map((q) => (
                <Badge key={q} variant="outline" className="text-[10px] px-1.5 py-0">
                  {q}
                </Badge>
              ))}
            </div>
          )}
          {agent.registered_at && (
            <div>Registered: {formatTimestamp(agent.registered_at, timezone)}</div>
          )}
        </div>
        {confirmingRemove && (
          <div
            className="absolute inset-x-0 bottom-0 rounded-b-lg border-t bg-card px-4 py-2 space-y-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            {showCleanupOption && (
              <label className="flex items-end justify-end gap-2 cursor-pointer select-none">
                <span className="text-[11px] whitespace-nowrap">Also delete in AgentCore</span>
                <input
                  type="checkbox"
                  checked={cleanupAws}
                  onChange={(e) => setCleanupAws(e.target.checked)}
                  className="h-3.5 w-3.5 shrink-0 mb-0.5"
                />
              </label>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-xs"
                onClick={() => {
                  setConfirmingRemove(false);
                  setCleanupAws(false);
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-6 text-xs"
                onClick={() => {
                  onDelete(agent.id, cleanupAws);
                  setConfirmingRemove(false);
                  setCleanupAws(false);
                }}
              >
                Confirm
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
