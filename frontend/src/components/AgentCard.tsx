import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
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

  const showCleanupOption = existsInAgentCore(agent);

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-accent/50 py-3 gap-1"
      onClick={() => onSelect(agent.id)}
    >
      <CardHeader className="gap-1 pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-medium">
              {agent.name ?? agent.runtime_id}
            </CardTitle>
            {agent.protocol && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {agent.protocol}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {isCreating(agent) && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
            {agent.active_session_count > 0 && (
              <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-medium">
                {agent.active_session_count}
              </span>
            )}
            <Badge variant={statusVariant(agent.status)}>
              {agent.status ?? "unknown"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-0.5 text-xs text-muted-foreground">
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
        <div className="pt-3" onClick={(e) => e.stopPropagation()}>
          <div className="h-4 mb-1.5 flex items-center justify-end">
            {confirmingRemove && showCleanupOption && (
              <label className="flex items-center gap-1.5 text-[11px] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={cleanupAws}
                  onChange={(e) => setCleanupAws(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                Remove in AgentCore
              </label>
            )}
          </div>
          <div className="flex justify-between gap-2">
            <Button size="sm" variant="outline" onClick={() => onRefresh(agent.id)}>
              Refresh
            </Button>
            <div className="flex items-center gap-2">
              {confirmingRemove ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
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
                    onClick={() => {
                      onDelete(agent.id, cleanupAws);
                      setConfirmingRemove(false);
                      setCleanupAws(false);
                    }}
                  >
                    Confirm
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmingRemove(true)}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
