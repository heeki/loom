import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useTimezone } from "@/contexts/TimezoneContext";
import { formatTimestamp } from "@/lib/format";
import { statusVariant, deploymentStatusVariant } from "@/lib/status";
import { toast } from "sonner";
import type { AgentResponse } from "@/api/types";

interface DeploymentPanelProps {
  agent: AgentResponse;
  onRedeploy: (id: number) => Promise<void>;
}

function isCreating(agent: AgentResponse): boolean {
  return (
    agent.status === "CREATING" ||
    agent.deployment_status === "deploying" ||
    agent.deployment_status === "ENDPOINT_CREATING" ||
    agent.endpoint_status === "CREATING"
  );
}

export function DeploymentPanel({ agent, onRedeploy }: DeploymentPanelProps) {
  const { timezone } = useTimezone();
  const [confirming, setConfirming] = useState(false);
  const [redeploying, setRedeploying] = useState(false);

  const handleRedeploy = async () => {
    setRedeploying(true);
    try {
      await onRedeploy(agent.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Redeploy failed");
    } finally {
      setRedeploying(false);
      setConfirming(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Deployment</CardTitle>
          <div className="flex items-center gap-2">
            {isCreating(agent) && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
            <Badge variant={deploymentStatusVariant(agent.deployment_status)}>
              {agent.deployment_status ?? "unknown"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">Runtime Status</span>
          <span>
            <Badge variant={statusVariant(agent.status)} className="text-xs">
              {agent.status ?? "\u2014"}
            </Badge>
          </span>
          <span className="text-muted-foreground">Endpoint Status</span>
          <span>
            {agent.endpoint_status ? (
              <Badge variant={statusVariant(agent.endpoint_status)} className="text-xs">
                {agent.endpoint_status}
              </Badge>
            ) : (
              "\u2014"
            )}
          </span>
          <span className="text-muted-foreground">Protocol</span>
          <span>{agent.protocol ?? "\u2014"}</span>
          <span className="text-muted-foreground">Network Mode</span>
          <span>{agent.network_mode ?? "\u2014"}</span>
          <span className="text-muted-foreground">Execution Role</span>
          <span className="font-mono truncate">{agent.execution_role_arn ?? "\u2014"}</span>
          <span className="text-muted-foreground">Config Hash</span>
          <span className="font-mono truncate">{agent.config_hash ?? "\u2014"}</span>
          <span className="text-muted-foreground">Deployed At</span>
          <span>{agent.deployed_at ? formatTimestamp(agent.deployed_at, timezone) : "\u2014"}</span>
        </div>
        <div className="flex gap-2 pt-1">
          {!confirming ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirming(true)}
              disabled={agent.deployment_status === "deploying" || agent.deployment_status === "removing"}
            >
              Redeploy
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleRedeploy}
                disabled={redeploying}
              >
                {redeploying ? "Redeploying..." : "Confirm Redeploy"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirming(false)}
                disabled={redeploying}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
