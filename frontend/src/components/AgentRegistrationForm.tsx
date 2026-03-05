import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import * as agentsApi from "@/api/agents";
import type { AgentDeployRequest, IamRole, CognitoPool, ModelOption } from "@/api/types";

function TagInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = input.trim();
      if (trimmed && !values.includes(trimmed)) {
        onChange([...values, trimmed]);
      }
      setInput("");
    }
  };

  const remove = (value: string) => {
    onChange(values.filter((v) => v !== value));
  };

  return (
    <div className="space-y-1.5">
      <Input
        placeholder={placeholder}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        className="text-sm"
      />
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded bg-accent px-2 py-0.5 text-xs"
            >
              {v}
              <button
                type="button"
                onClick={() => remove(v)}
                className="text-muted-foreground hover:text-foreground"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

type Mode = "register" | "deploy";
type AuthorizerType = "none" | "cognito" | "other";

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
  const [nameError, setNameError] = useState("");
  const [description, setDescription] = useState("");
  const [agentDescription, setAgentDescription] = useState("");
  const [behavioralGuidelines, setBehavioralGuidelines] = useState("");
  const [outputExpectations, setOutputExpectations] = useState("");
  const [modelId, setModelId] = useState("us.anthropic.claude-sonnet-4-6");
  const [roleArn, setRoleArn] = useState<string>("");
  const [protocol] = useState("HTTP");
  const [networkMode, setNetworkMode] = useState("PUBLIC");

  // Authorizer state
  const [authorizerType, setAuthorizerType] = useState<AuthorizerType>("none");
  const [authorizerPoolId, setAuthorizerPoolId] = useState<string>("");
  const [authorizerDiscoveryUrl, setAuthorizerDiscoveryUrl] = useState("");
  const [authorizerAllowedClients, setAuthorizerAllowedClients] = useState<string[]>([]);
  const [authorizerAllowedScopes, setAuthorizerAllowedScopes] = useState<string[]>([]);
  const [authorizerClientId, setAuthorizerClientId] = useState("");
  const [authorizerClientSecret, setAuthorizerClientSecret] = useState("");

  // Lifecycle state
  const [idleTimeout, setIdleTimeout] = useState("");
  const [maxLifetime, setMaxLifetime] = useState("");
  const [idleTimeoutError, setIdleTimeoutError] = useState("");
  const [maxLifetimeError, setMaxLifetimeError] = useState("");

  // Integrations state
  const [memoryEnabled] = useState(false);
  const [mcpServersEnabled] = useState(false);
  const [a2aAgentsEnabled] = useState(false);

  // Deploy elapsed timer
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isLoading && mode === "deploy") {
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isLoading, mode]);

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

  // Auto-populate discovery URL when Cognito pool selected
  useEffect(() => {
    if (authorizerType === "cognito" && authorizerPoolId) {
      const pool = cognitoPools.find((p) => p.pool_id === authorizerPoolId);
      if (pool) {
        const region = pool.pool_id.split("_")[0];
        setAuthorizerDiscoveryUrl(
          `https://cognito-idp.${region}.amazonaws.com/${pool.pool_id}/.well-known/openid-configuration`
        );
      }
    }
  }, [authorizerType, authorizerPoolId, cognitoPools]);

  const validateName = (value: string) => {
    if (!value) {
      setNameError("");
      return;
    }
    const pattern = /^[a-zA-Z][a-zA-Z0-9_]{0,47}$/;
    if (!pattern.test(value)) {
      setNameError("Must start with a letter, use only letters, digits, and underscores (max 48 chars)");
    } else {
      setNameError("");
    }
  };

  const validateLifecycle = (field: "idle" | "max", value: string) => {
    if (!value) {
      if (field === "idle") setIdleTimeoutError("");
      else setMaxLifetimeError("");
      return;
    }
    const num = parseInt(value, 10);
    const error = num < 60 || num > 28800 ? "Must be between 60 and 28800 seconds" : "";
    if (field === "idle") setIdleTimeoutError(error);
    else setMaxLifetimeError(error);
  };

  const handleIdleTimeoutChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value;
    if (idleTimeout === "" && value !== "") {
      value = "300";
      e.target.value = value;
    }
    setIdleTimeout(value);
    validateLifecycle("idle", value);
  };

  const handleMaxLifetimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value;
    if (maxLifetime === "" && value !== "") {
      value = "3600";
      e.target.value = value;
    }
    setMaxLifetime(value);
    validateLifecycle("max", value);
  };

  const hasValidationErrors = nameError !== "" || idleTimeoutError !== "" || maxLifetimeError !== "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "register") {
      if (!arn.trim()) return;
      await onRegister(arn.trim());
      setArn("");
    } else {
      if (!name.trim() || !onDeploy || hasValidationErrors) return;

      const request: AgentDeployRequest = {
        source: "deploy",
        name: name.trim(),
        description: description.trim(),
        agent_description: agentDescription.trim(),
        behavioral_guidelines: behavioralGuidelines.trim(),
        output_expectations: outputExpectations.trim(),
        model_id: modelId,
        role_arn: roleArn || null,
        protocol,
        network_mode: networkMode,
        idle_timeout: idleTimeout ? parseInt(idleTimeout, 10) : null,
        max_lifetime: maxLifetime ? parseInt(maxLifetime, 10) : null,
        authorizer_type: authorizerType === "none" ? null : authorizerType,
        authorizer_pool_id: authorizerType === "cognito" ? authorizerPoolId || null : null,
        authorizer_discovery_url:
          authorizerType === "other" ? authorizerDiscoveryUrl || null : null,
        authorizer_allowed_clients: authorizerAllowedClients,
        authorizer_allowed_scopes: authorizerAllowedScopes,
        authorizer_client_id: authorizerClientId || null,
        authorizer_client_secret: authorizerClientSecret || null,
        memory_enabled: memoryEnabled,
        mcp_servers: [],
        a2a_agents: [],
      };
      await onDeploy(request);
      setName("");
      setDescription("");
      setAgentDescription("");
      setBehavioralGuidelines("");
      setOutputExpectations("");
      setModelId("us.anthropic.claude-sonnet-4-6");
      setRoleArn("");
      setNetworkMode("PUBLIC");
      setAuthorizerType("none");
      setAuthorizerPoolId("");
      setAuthorizerDiscoveryUrl("");
      setAuthorizerAllowedClients([]);
      setAuthorizerAllowedScopes([]);
      setAuthorizerClientId("");
      setAuthorizerClientSecret("");
      setIdleTimeout("");
      setMaxLifetime("");
      setIdleTimeoutError("");
      setMaxLifetimeError("");
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
                <div className="flex gap-3">
                  <div className="w-1/3 min-w-0">
                    <Input
                      placeholder="Agent name"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        validateName(e.target.value);
                      }}
                      required
                      className={nameError ? "border-red-500" : ""}
                    />
                    {nameError && (
                      <p className="text-xs text-red-500 mt-1">{nameError}</p>
                    )}
                  </div>
                  <Input
                    placeholder="Description (optional)"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="flex-1 min-w-0"
                  />
                </div>
              </section>

              {/* Agent Behavior (System Prompt) */}
              <section className="space-y-3">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Agent Behavior (System Prompt)</h4>
                <div className="space-y-2">
                  <Textarea
                    placeholder="Persona or role definition (e.g., You are a helpful customer support agent that resolves billing inquiries for an e-commerce platform)"
                    value={agentDescription}
                    onChange={(e) => setAgentDescription(e.target.value)}
                    rows={2}
                    className="text-sm"
                  />
                  <Textarea
                    placeholder="Specific instructions or tasks (e.g., Look up the customer's order history, identify the issue, and provide a resolution within company policy)"
                    value={behavioralGuidelines}
                    onChange={(e) => setBehavioralGuidelines(e.target.value)}
                    rows={2}
                    className="text-sm"
                  />
                  <Textarea
                    placeholder="Behavioral guidelines and constraints (e.g., Use a friendly and professional tone, never share internal system details, and escalate to a human agent if the customer requests it)"
                    value={outputExpectations}
                    onChange={(e) => setOutputExpectations(e.target.value)}
                    rows={2}
                    className="text-sm"
                  />
                </div>
              </section>

              {/* Model, Protocol, Network, IAM Role */}
              <div className="flex gap-3">
                <section className="w-[20%] min-w-0 space-y-2">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Model</h4>
                  <Select value={modelId} onValueChange={setModelId}>
                    <SelectTrigger className="w-full text-sm">
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
                            <SelectItem value="us.anthropic.claude-sonnet-4-6">
                              Claude Sonnet 4.6
                            </SelectItem>
                          )}
                    </SelectContent>
                  </Select>
                </section>
                <section className="w-[10%] min-w-0 space-y-2">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Protocol</h4>
                  <Select value={protocol} onValueChange={() => {}}>
                    <SelectTrigger className="w-full text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HTTP">HTTP</SelectItem>
                      <SelectItem value="MCP" disabled>MCP (coming soon)</SelectItem>
                      <SelectItem value="A2A" disabled>A2A (coming soon)</SelectItem>
                    </SelectContent>
                  </Select>
                </section>
                <section className="w-[10%] min-w-0 space-y-2">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Network</h4>
                  <Select value={networkMode} onValueChange={setNetworkMode}>
                    <SelectTrigger className="w-full text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PUBLIC">PUBLIC</SelectItem>
                      <SelectItem value="VPC" disabled>VPC (coming soon)</SelectItem>
                    </SelectContent>
                  </Select>
                </section>
                <section className="flex-1 min-w-0 space-y-2">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">IAM Role</h4>
                  <SearchableSelect
                    options={roles.map((r) => ({
                      value: r.role_arn,
                      label: r.role_name,
                    }))}
                    value={roleArn}
                    onValueChange={setRoleArn}
                    placeholder="Search roles..."
                  />
                </section>
              </div>

              {/* Authorizer */}
              <section className="space-y-3">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Authorizer</h4>
                <Select
                  value={authorizerType}
                  onValueChange={(v) => {
                    setAuthorizerType(v as AuthorizerType);
                    setAuthorizerPoolId("");
                    setAuthorizerDiscoveryUrl("");
                    setAuthorizerAllowedClients([]);
                    setAuthorizerAllowedScopes([]);
                    setAuthorizerClientId("");
                    setAuthorizerClientSecret("");
                  }}
                >
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="Select authorizer type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="cognito">Cognito</SelectItem>
                    <SelectItem value="other">Other provider</SelectItem>
                  </SelectContent>
                </Select>

                {authorizerType === "cognito" && (
                  <div className="space-y-3 rounded border border-dashed p-3">
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">Cognito User Pool</label>
                      <SearchableSelect
                        options={cognitoPools.map((p) => ({
                          value: p.pool_id,
                          label: p.pool_name,
                        }))}
                        value={authorizerPoolId}
                        onValueChange={setAuthorizerPoolId}
                        placeholder="Search and select a Cognito pool..."
                        className="w-[30%]"
                      />
                    </div>
                    {authorizerPoolId && (
                      <>
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground">Discovery URL (auto-populated)</label>
                          <Input
                            value={authorizerDiscoveryUrl}
                            readOnly
                            className="text-sm bg-muted/50"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <label className="text-xs text-muted-foreground">Allowed Clients (optional — press Enter to add)</label>
                            <TagInput
                              values={authorizerAllowedClients}
                              onChange={setAuthorizerAllowedClients}
                              placeholder="Enter a client ID and press Enter"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs text-muted-foreground">Allowed Scopes (optional — press Enter to add)</label>
                            <TagInput
                              values={authorizerAllowedScopes}
                              onChange={setAuthorizerAllowedScopes}
                              placeholder="Enter a scope and press Enter"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <label className="text-xs text-muted-foreground">App Client ID (for token retrieval)</label>
                            <Input
                              placeholder="Cognito app client ID"
                              value={authorizerClientId}
                              onChange={(e) => setAuthorizerClientId(e.target.value)}
                              className="text-sm"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs text-muted-foreground">App Client Secret (for token retrieval)</label>
                            <Input
                              type="password"
                              placeholder="Cognito app client secret"
                              value={authorizerClientSecret}
                              onChange={(e) => setAuthorizerClientSecret(e.target.value)}
                              className="text-sm"
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {authorizerType === "other" && (
                  <div className="space-y-3 rounded border border-dashed p-3">
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">Discovery URL</label>
                      <Input
                        placeholder="https://your-provider.com/.well-known/openid-configuration"
                        value={authorizerDiscoveryUrl}
                        onChange={(e) => setAuthorizerDiscoveryUrl(e.target.value)}
                        className="text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground">Allowed Clients (optional — press Enter to add)</label>
                        <TagInput
                          values={authorizerAllowedClients}
                          onChange={setAuthorizerAllowedClients}
                          placeholder="Enter a client ID and press Enter"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground">Allowed Scopes (optional — press Enter to add)</label>
                        <TagInput
                          values={authorizerAllowedScopes}
                          onChange={setAuthorizerAllowedScopes}
                          placeholder="Enter a scope and press Enter"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {/* Lifecycle */}
              <section className="space-y-3">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Lifecycle</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Idle Timeout (seconds)</label>
                    <Input
                      type="number"
                      placeholder="Defaults to 300 (5 min)"
                      value={idleTimeout}
                      onChange={handleIdleTimeoutChange}
                      min={60}
                      max={28800}
                      step={60}
                    />
                    {idleTimeoutError && (
                      <p className="text-[10px] text-destructive">{idleTimeoutError}</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Max Lifetime (seconds)</label>
                    <Input
                      type="number"
                      placeholder="Defaults to 3600 (1 hr)"
                      value={maxLifetime}
                      onChange={handleMaxLifetimeChange}
                      min={60}
                      max={28800}
                      step={60}
                    />
                    {maxLifetimeError && (
                      <p className="text-[10px] text-destructive">{maxLifetimeError}</p>
                    )}
                  </div>
                </div>
              </section>

              {/* Integrations */}
              <section className="space-y-3">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Integrations</h4>
                <div className="space-y-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" disabled checked={memoryEnabled} className="h-3.5 w-3.5" />
                    <span>Memory</span>
                    <span className="text-[10px] italic">Coming soon</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" disabled checked={mcpServersEnabled} className="h-3.5 w-3.5" />
                    <span>MCP Servers</span>
                    <span className="text-[10px] italic">Coming soon</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" disabled checked={a2aAgentsEnabled} className="h-3.5 w-3.5" />
                    <span>A2A Agents</span>
                    <span className="text-[10px] italic">Coming soon</span>
                  </div>
                </div>
              </section>

              <Button
                type="submit"
                disabled={isLoading || !name.trim() || !onDeploy || hasValidationErrors}
                className="w-full"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Deploying... ({elapsedSeconds}s)
                  </span>
                ) : (
                  "Deploy Agent"
                )}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
