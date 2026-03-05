import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import * as agentsApi from "@/api/agents";
import type { AgentDeployRequest, IamRole, CognitoPool, ModelOption } from "@/api/types";

type Mode = "register" | "deploy";

interface AgentRegistrationFormProps {
  onRegister: (arn: string) => Promise<void>;
  onDeploy?: (request: AgentDeployRequest) => Promise<void>;
  isLoading: boolean;
}

export function AgentRegistrationForm({ onRegister, onDeploy, isLoading }: AgentRegistrationFormProps) {
  const [mode, setMode] = useState<Mode>("register");

  // Register state
  const [arn, setArn] = useState("");

  // Deploy state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agentDescription, setAgentDescription] = useState("");
  const [behavioralGuidelines, setBehavioralGuidelines] = useState("");
  const [outputExpectations, setOutputExpectations] = useState("");
  const [modelId, setModelId] = useState("us.anthropic.claude-sonnet-4-20250514");
  const [roleArn, setRoleArn] = useState<string>("__new__");
  const [protocol, setProtocol] = useState("HTTP");
  const [networkMode, setNetworkMode] = useState("PUBLIC");
  const [authorizerPoolId, setAuthorizerPoolId] = useState<string>("__none__");
  const [idleTimeout, setIdleTimeout] = useState("");
  const [maxLifetime, setMaxLifetime] = useState("");

  // Discovery data
  const [models, setModels] = useState<ModelOption[]>([]);
  const [roles, setRoles] = useState<IamRole[]>([]);
  const [cognitoPools, setCognitoPools] = useState<CognitoPool[]>([]);

  useEffect(() => {
    if (mode === "deploy") {
      void agentsApi.fetchModels().then(setModels).catch(() => {});
      void agentsApi.fetchRoles().then(setRoles).catch(() => {});
      void agentsApi.fetchCognitoPools().then(setCognitoPools).catch(() => {});
    }
  }, [mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "register") {
      if (!arn.trim()) return;
      await onRegister(arn.trim());
      setArn("");
    } else {
      if (!name.trim() || !onDeploy) return;
      const request: AgentDeployRequest = {
        source: "deploy",
        name: name.trim(),
        description: description.trim(),
        agent_description: agentDescription.trim(),
        behavioral_guidelines: behavioralGuidelines.trim(),
        output_expectations: outputExpectations.trim(),
        model_id: modelId,
        role_arn: roleArn === "__new__" ? null : roleArn,
        protocol,
        network_mode: networkMode,
        idle_timeout: idleTimeout ? parseInt(idleTimeout, 10) : null,
        max_lifetime: maxLifetime ? parseInt(maxLifetime, 10) : null,
        authorizer_pool_id: authorizerPoolId === "__none__" ? null : authorizerPoolId,
        memory_enabled: false,
        mcp_servers: [],
        a2a_agents: [],
      };
      await onDeploy(request);
      setName("");
      setDescription("");
      setAgentDescription("");
      setBehavioralGuidelines("");
      setOutputExpectations("");
      setModelId("us.anthropic.claude-sonnet-4-20250514");
      setRoleArn("__new__");
      setProtocol("HTTP");
      setNetworkMode("PUBLIC");
      setAuthorizerPoolId("__none__");
      setIdleTimeout("");
      setMaxLifetime("");
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">
            {mode === "register" ? "Register Agent" : "Deploy Agent"}
          </CardTitle>
          <div className="flex rounded-md border text-xs" role="tablist" aria-label="Agent creation mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "register"}
              aria-controls="panel-register"
              className={`px-3 py-1 rounded-l-md transition-colors ${
                mode === "register"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              }`}
              onClick={() => setMode("register")}
            >
              Register
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "deploy"}
              aria-controls="panel-deploy"
              className={`px-3 py-1 rounded-r-md transition-colors ${
                mode === "deploy"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              }`}
              onClick={() => setMode("deploy")}
            >
              Deploy
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "register" ? (
            <div id="panel-register" role="tabpanel" className="flex gap-2">
              <Input
                placeholder="arn:aws:bedrock-agentcore:region:account:runtime/id"
                value={arn}
                onChange={(e) => setArn(e.target.value)}
                className="flex-1"
              />
              <Button type="submit" disabled={isLoading || !arn.trim()}>
                {isLoading ? "Registering..." : "Register"}
              </Button>
            </div>
          ) : (
            <div id="panel-deploy" role="tabpanel" className="space-y-5">
              {/* Agent Identity */}
              <section className="space-y-3">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Agent Identity</h4>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    placeholder="Agent name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                  <Input
                    placeholder="Description (optional)"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </section>

              {/* Agent Behavior */}
              <section className="space-y-3">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Agent Behavior (System Prompt)</h4>
                <div className="space-y-2">
                  <Textarea
                    placeholder="What does this agent do?"
                    value={agentDescription}
                    onChange={(e) => setAgentDescription(e.target.value)}
                    rows={2}
                    className="text-sm"
                  />
                  <Textarea
                    placeholder="How should it behave?"
                    value={behavioralGuidelines}
                    onChange={(e) => setBehavioralGuidelines(e.target.value)}
                    rows={2}
                    className="text-sm"
                  />
                  <Textarea
                    placeholder="What output format/style?"
                    value={outputExpectations}
                    onChange={(e) => setOutputExpectations(e.target.value)}
                    rows={2}
                    className="text-sm"
                  />
                </div>
              </section>

              {/* Model & Role */}
              <section className="space-y-3">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Model & IAM Role</h4>
                <div className="grid grid-cols-2 gap-3">
                  <Select value={modelId} onValueChange={setModelId}>
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="Select model" />
                    </SelectTrigger>
                    <SelectContent>
                      {models.length > 0
                        ? models.map((m) => (
                            <SelectItem key={m.model_id} value={m.model_id}>
                              {m.display_name}
                            </SelectItem>
                          ))
                        : (
                            <SelectItem value="us.anthropic.claude-sonnet-4-20250514">
                              Claude Sonnet 4
                            </SelectItem>
                          )}
                    </SelectContent>
                  </Select>
                  <Select value={roleArn} onValueChange={setRoleArn}>
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="Select IAM role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__new__">Create new role (least privilege)</SelectItem>
                      {roles.map((r) => (
                        <SelectItem key={r.role_arn} value={r.role_arn}>
                          {r.role_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </section>

              {/* Protocol & Network */}
              <section className="space-y-3">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Protocol & Network</h4>
                <div className="grid grid-cols-2 gap-3">
                  <Select value={protocol} onValueChange={setProtocol}>
                    <SelectTrigger className="text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HTTP">HTTP</SelectItem>
                      <SelectItem value="MCP">MCP</SelectItem>
                      <SelectItem value="A2A">A2A</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={networkMode} onValueChange={setNetworkMode}>
                    <SelectTrigger className="text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PUBLIC">PUBLIC</SelectItem>
                      <SelectItem value="VPC" disabled>VPC (coming soon)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </section>

              {/* Authorizer */}
              <section className="space-y-3">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Authorizer</h4>
                <Select value={authorizerPoolId} onValueChange={setAuthorizerPoolId}>
                  <SelectTrigger className="text-sm w-full">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {cognitoPools.map((p) => (
                      <SelectItem key={p.pool_id} value={p.pool_id}>
                        {p.pool_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </section>

              {/* Lifecycle */}
              <section className="space-y-3">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Lifecycle</h4>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    type="number"
                    placeholder="Idle timeout (e.g., 300)"
                    value={idleTimeout}
                    onChange={(e) => setIdleTimeout(e.target.value)}
                    min={0}
                  />
                  <Input
                    type="number"
                    placeholder="Max lifetime (e.g., 3600)"
                    value={maxLifetime}
                    onChange={(e) => setMaxLifetime(e.target.value)}
                    min={0}
                  />
                </div>
              </section>

              {/* Integrations (placeholders) */}
              <section className="space-y-3">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Integrations</h4>
                <div className="space-y-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" disabled className="h-3.5 w-3.5" />
                    <span>Memory</span>
                    <span className="text-[10px] italic">Coming soon</span>
                  </div>
                  <div className="rounded border border-dashed p-2 opacity-50">
                    MCP Servers — Coming soon
                  </div>
                  <div className="rounded border border-dashed p-2 opacity-50">
                    A2A Agents — Coming soon
                  </div>
                </div>
              </section>

              <Button
                type="submit"
                disabled={isLoading || !name.trim() || !onDeploy}
                className="w-full"
              >
                {isLoading ? "Deploying..." : "Deploy Agent"}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
