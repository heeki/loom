import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTimezone } from "@/contexts/TimezoneContext";
import { formatTimestamp } from "@/lib/format";
import type { AgentResponse } from "@/api/types";

interface AgentCardProps {
  agent: AgentResponse;
  onSelect: (id: number) => void;
  onRefresh: (id: number) => void;
  onDelete: (id: number) => void;
}

function statusVariant(status: string | null): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "ACTIVE":
    case "READY":
      return "default";
    case "CREATING":
    case "UPDATING":
      return "secondary";
    case "FAILED":
      return "destructive";
    default:
      return "outline";
  }
}

export function AgentCard({ agent, onSelect, onRefresh, onDelete }: AgentCardProps) {
  const { timezone } = useTimezone();
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-accent/50"
      onClick={() => onSelect(agent.id)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <CardTitle className="text-sm font-medium">
            {agent.name ?? agent.runtime_id}
          </CardTitle>
          <Badge variant={statusVariant(agent.status)}>
            {agent.status ?? "unknown"}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          {agent.active_session_count > 0
            ? `${agent.active_session_count} active session(s)`
            : "No active sessions"}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-muted-foreground">
        <div>Region: {agent.region}</div>
        <div>Account: {agent.account_id}</div>
        {agent.available_qualifiers.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {agent.available_qualifiers.map((q) => (
              <Badge key={q} variant="outline" className="text-xs">
                {q}
              </Badge>
            ))}
          </div>
        )}
        {agent.registered_at && (
          <div>Registered: {formatTimestamp(agent.registered_at, timezone)}</div>
        )}
        <div className="flex justify-between gap-2 pt-2" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="outline" onClick={() => onRefresh(agent.id)}>
            Refresh
          </Button>
          <div className="flex gap-2">
            {confirmingRemove ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmingRemove(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    onDelete(agent.id);
                    setConfirmingRemove(false);
                  }}
                >
                  Confirm remove
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
      </CardContent>
    </Card>
  );
}
