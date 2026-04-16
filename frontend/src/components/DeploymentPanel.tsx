import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Pencil, Check, X } from "lucide-react";
import { useTimezone } from "@/contexts/TimezoneContext";
import { formatTimestamp } from "@/lib/format";
import { statusVariant } from "@/lib/status";
import { fetchModels } from "@/api/agents";
import type { AgentResponse, ModelOption } from "@/api/types";

interface DeploymentPanelProps {
  agent: AgentResponse;
  onRedeploy: (id: number) => Promise<void>;
  onPatchAgent?: (id: number, updates: { allowed_model_ids?: string[] }) => Promise<AgentResponse>;
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

export function DeploymentPanel({ agent, onPatchAgent }: DeploymentPanelProps) {
  const { timezone } = useTimezone();
  const [editingModels, setEditingModels] = useState(false);
  const [modelsDraft, setModelsDraft] = useState<string[]>([]);
  const [savingModels, setSavingModels] = useState(false);
  const [allModels, setAllModels] = useState<ModelOption[]>([]);

  useEffect(() => {
    fetchModels().then(setAllModels).catch(() => {});
  }, []);

  const handleEditModels = () => {
    setModelsDraft([...agent.allowed_model_ids]);
    setEditingModels(true);
  };

  const handleSaveModels = async () => {
    if (!onPatchAgent) return;
    setSavingModels(true);
    try {
      await onPatchAgent(agent.id, { allowed_model_ids: modelsDraft });
      setEditingModels(false);
    } finally {
      setSavingModels(false);
    }
  };

  const toggleModel = (modelId: string) => {
    if (modelId === agent.model_id) return;
    setModelsDraft((prev) =>
      prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId]
    );
  };

  const getDisplayName = (modelId: string) =>
    allModels.find((m) => m.model_id === modelId)?.display_name ?? modelId;

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
      <CardContent className="space-y-2 text-xs text-muted-foreground">
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

        {/* Allowed Models */}
        <div className="pt-1">
          <div className="flex items-center gap-1.5">
            <span className="font-medium">Allowed Models:</span>
            {!editingModels && onPatchAgent && (
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleEditModels}>
                <Pencil className="h-3 w-3" />
              </Button>
            )}
          </div>
          {editingModels ? (
            <div className="space-y-2 mt-1">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {allModels.map((m) => (
                  <label key={m.model_id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 shrink-0"
                      checked={modelsDraft.includes(m.model_id)}
                      disabled={m.model_id === agent.model_id}
                      onChange={() => toggleModel(m.model_id)}
                    />
                    <span>{m.display_name}</span>
                    {m.model_id === agent.model_id && (
                      <span className="text-[10px] text-muted-foreground bg-accent px-1 rounded">default</span>
                    )}
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="h-6 text-xs" onClick={() => void handleSaveModels()} disabled={savingModels}>
                  <Check className="h-3 w-3 mr-1" />
                  Save
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setEditingModels(false)} disabled={savingModels}>
                  <X className="h-3 w-3 mr-1" />
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {agent.allowed_model_ids.length > 0 ? (
                agent.allowed_model_ids.map((id) => (
                  <Badge key={id} variant="outline" className="text-[10px] px-1.5 py-0">
                    {getDisplayName(id)}{id === agent.model_id ? " (default)" : ""}
                  </Badge>
                ))
              ) : agent.model_id ? (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {getDisplayName(agent.model_id)} (default)
                </Badge>
              ) : (
                <span className="italic">None configured</span>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
