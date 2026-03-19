import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { useTimezone } from "@/contexts/TimezoneContext";
import { formatTimestamp } from "@/lib/format";
import { statusVariant } from "@/lib/status";
import type { AgentResponse } from "@/api/types";

interface DeploymentPanelProps {
  agent: AgentResponse;
  onRedeploy: (id: number) => Promise<void>;
}

const DEPLOY_IN_PROGRESS = new Set([
  "initializing",
  "creating_credentials",
  "creating_role",
  "building_artifact",
  "deploying",
  "ENDPOINT_CREATING",
]);

function isCreating(agent: AgentResponse): boolean {
  return (
    agent.status === "CREATING" ||
    DEPLOY_IN_PROGRESS.has(agent.deployment_status ?? "") ||
    agent.endpoint_status === "CREATING"
  );
}

export function DeploymentPanel({ agent }: DeploymentPanelProps) {
  const { timezone } = useTimezone();

  return (
    <Card className="py-3 gap-1">
      <CardHeader className="gap-1 pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Deployment</CardTitle>
          {isCreating(agent) && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-0.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span>Runtime Status:</span>
          <Badge variant={statusVariant(agent.status)} className="text-[10px] px-1.5 py-0">
            {agent.status ?? "—"}
          </Badge>
        </div>
        <div>Protocol: {agent.protocol ?? "—"}</div>
        <div>Network: {agent.network_mode ?? "—"}</div>
        <div className="truncate">Execution Role: {agent.execution_role_arn ?? "—"}</div>
        {agent.deployed_at && (
          <div>Deployed: {formatTimestamp(agent.deployed_at, timezone)}</div>
        )}
      </CardContent>
    </Card>
  );
}
