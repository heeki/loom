import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PolicyViewer } from "@/components/PolicyViewer";
import * as agentsApi from "@/api/agents";
import * as securityApi from "@/api/security";
import * as settingsApi from "@/api/settings";
import type { AgentDeployRequest, ModelOption, ManagedRole, AuthorizerConfigResponse, TagPolicy } from "@/api/types";
import { toast } from "sonner";

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

// Module-level deploy start timestamp — survives component unmount/remount
let deployStartTime: number | null = null;

type Mode = "register" | "deploy";

interface AgentRegistrationFormProps {
  mode: Mode;
  onRegister: (arn: string, modelId?: string) => Promise<void>;
  onDeploy?: (request: AgentDeployRequest) => Promise<void>;
  isLoading: boolean;
}

export function AgentRegistrationForm({ mode, onRegister, onDeploy, isLoading }: AgentRegistrationFormProps) {

  // Register state
  const [arn, setArn] = useState("");

  // Deploy state
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [description, setDescription] = useState("");
  const [agentDescription, setAgentDescription] = useState("");
  const [behavioralGuidelines, setBehavioralGuidelines] = useState("");
  const [outputExpectations, setOutputExpectations] = useState("");
  const [modelId, setModelId] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");
  const [protocol] = useState("HTTP");
  const [networkMode, setNetworkMode] = useState("PUBLIC");

  // Security config state (pre-configured by Security Admin)
  const [selectedAuthConfigId, setSelectedAuthConfigId] = useState<string>("");

  // Permission request state
  const [showRolePerms, setShowRolePerms] = useState(true);
  const [showPermRequest, setShowPermRequest] = useState(false);
  const [permActions, setPermActions] = useState<string[]>([]);
  const [permResources, setPermResources] = useState<string[]>([]);
  const [permJustification, setPermJustification] = useState("");

  // Lifecycle state
  const [idleTimeout, setIdleTimeout] = useState("");
  const [maxLifetime, setMaxLifetime] = useState("");
  const [idleTimeoutError, setIdleTimeoutError] = useState("");
  const [maxLifetimeError, setMaxLifetimeError] = useState("");

  // Integrations state
  const [memoryEnabled] = useState(false);
  const [mcpServersEnabled] = useState(false);
  const [a2aAgentsEnabled] = useState(false);

  // Tag state
  const [tagPolicies, setTagPolicies] = useState<TagPolicy[]>([]);
  const [tagValues, setTagValues] = useState<Record<string, string>>({});

  // Deploy elapsed timer — persists across navigation via module-level timestamp
  const [elapsedSeconds, setElapsedSeconds] = useState(() => {
    if (deployStartTime) return Math.floor((Date.now() - deployStartTime) / 1000);
    return 0;
  });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isLoading && mode === "deploy") {
      if (!deployStartTime) deployStartTime = Date.now();
      setElapsedSeconds(Math.floor((Date.now() - deployStartTime) / 1000));
      timerRef.current = setInterval(() => {
        setElapsedSeconds(
          deployStartTime ? Math.floor((Date.now() - deployStartTime) / 1000) : 0,
        );
      }, 1000);
    } else {
      deployStartTime = null;
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
  const [managedRoles, setManagedRoles] = useState<ManagedRole[]>([]);
  const [authConfigs, setAuthConfigs] = useState<AuthorizerConfigResponse[]>([]);
  const [defaults, setDefaults] = useState<agentsApi.LoomDefaults>({ idle_timeout_seconds: 300, max_lifetime_seconds: 3600 });

  useEffect(() => {
    void agentsApi.fetchModels().then(setModels).catch(() => {});
    void agentsApi.fetchDefaults().then(setDefaults).catch(() => {});
    if (mode === "deploy") {
      void securityApi.listManagedRoles().then(setManagedRoles).catch(() => {});
      void securityApi.listAuthorizerConfigs().then(setAuthConfigs).catch(() => {});
      void settingsApi.listTagPolicies().then(setTagPolicies).catch(() => {});
    }
  }, [mode]);

  const selectedRole = managedRoles.find((r) => r.id.toString() === selectedRoleId);
  const selectedAuthConfig = authConfigs.find((c) => c.id.toString() === selectedAuthConfigId);

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
      value = String(defaults.idle_timeout_seconds);
      e.target.value = value;
    }
    setIdleTimeout(value);
    validateLifecycle("idle", value);
  };

  const handleMaxLifetimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value;
    if (maxLifetime === "" && value !== "") {
      value = String(defaults.max_lifetime_seconds);
      e.target.value = value;
    }
    setMaxLifetime(value);
    validateLifecycle("max", value);
  };

  const hasValidationErrors = nameError !== "" || idleTimeoutError !== "" || maxLifetimeError !== "";
  const hasRequiredTags = tagPolicies
    .filter(tp => tp.source === "build-time" && tp.required)
    .every(tp => tagValues[tp.key]?.trim());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "register") {
      if (!arn.trim()) return;
      await onRegister(arn.trim(), modelId || undefined);
      setArn("");
    } else {
      if (!name.trim() || !modelId || !selectedRoleId || !onDeploy || hasValidationErrors) return;

      // Resolve managed role to role_arn
      const roleArn = selectedRole?.role_arn ?? null;

      // Resolve authorizer config to raw fields
      const authConfig = selectedAuthConfig;
      const request: AgentDeployRequest = {
        source: "deploy",
        name: name.trim(),
        description: description.trim(),
        agent_description: agentDescription.trim(),
        behavioral_guidelines: behavioralGuidelines.trim(),
        output_expectations: outputExpectations.trim(),
        model_id: modelId,
        role_arn: roleArn,
        protocol,
        network_mode: networkMode,
        idle_timeout: idleTimeout ? parseInt(idleTimeout, 10) : defaults.idle_timeout_seconds,
        max_lifetime: maxLifetime ? parseInt(maxLifetime, 10) : defaults.max_lifetime_seconds,
        authorizer_type: authConfig?.authorizer_type ?? null,
        authorizer_pool_id: authConfig?.pool_id ?? null,
        authorizer_discovery_url: authConfig?.discovery_url ?? null,
        authorizer_allowed_clients: authConfig?.allowed_clients ?? [],
        authorizer_allowed_scopes: authConfig?.allowed_scopes ?? [],
        authorizer_client_id: authConfig?.client_id ?? null,
        authorizer_client_secret: null,
        memory_enabled: memoryEnabled,
        mcp_servers: [],
        a2a_agents: [],
        tags: Object.fromEntries(
          Object.entries(tagValues).filter(([, v]) => v.trim() !== "")
        ),
      };
      await onDeploy(request);
      setName("");
      setDescription("");
      setAgentDescription("");
      setBehavioralGuidelines("");
      setOutputExpectations("");
      setModelId("");
      setSelectedRoleId("");
      setNetworkMode("PUBLIC");
      setSelectedAuthConfigId("");
      setIdleTimeout("");
      setMaxLifetime("");
      setIdleTimeoutError("");
      setMaxLifetimeError("");
      setTagValues({});
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {mode === "register" ? (
            <div className="flex gap-3 items-end">
              <div className="flex-1 min-w-0">
                <label className="text-xs text-muted-foreground">AgentCore Runtime ARN</label>
                <Input
                  placeholder="arn:aws:bedrock-agentcore:region:account:runtime/id"
                  value={arn}
                  onChange={(e) => setArn(e.target.value)}
                />
              </div>
              <div className="w-1/4 min-w-0">
                <label className="text-xs text-muted-foreground">Model Used</label>
                <SearchableSelect
                  options={models.map((m) => ({ value: m.model_id, label: m.display_name, group: m.group }))}
                  value={modelId}
                  onValueChange={setModelId}
                  placeholder="Select model..."
                />
              </div>
              <Button type="submit" disabled={isLoading || !arn.trim()} className="min-w-[120px]">
                {isLoading ? "Registering..." : "Register"}
              </Button>
            </div>
      ) : (
          <div className="space-y-5">
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
                  <SearchableSelect
                    options={models.map((m) => ({ value: m.model_id, label: m.display_name, group: m.group }))}
                    value={modelId}
                    onValueChange={setModelId}
                    placeholder="Select model..."
                  />
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
                    options={managedRoles.map((r) => ({
                      value: r.id.toString(),
                      label: r.role_name,
                    }))}
                    value={selectedRoleId}
                    onValueChange={setSelectedRoleId}
                    placeholder="Select managed role..."
                  />
                </section>
              </div>

              {/* IAM Role Permissions (read-only) */}
              {selectedRole && (
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setShowRolePerms(!showRolePerms)}
                      className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase tracking-wide hover:text-foreground"
                    >
                      {showRolePerms ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      Role Permissions (read-only)
                    </button>
                    {showRolePerms && (
                      <button
                        type="button"
                        onClick={() => setShowPermRequest(!showPermRequest)}
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                      >
                        Request Additional Permissions
                        {showPermRequest ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </button>
                    )}
                  </div>
                  {showRolePerms && (
                    <div className="rounded border p-3 bg-muted/30">
                      <p className="text-xs text-muted-foreground mb-2">{selectedRole.role_arn}</p>
                      <PolicyViewer policy={selectedRole.policy_document} />
                    </div>
                  )}
                  {showRolePerms && showPermRequest && (
                    <div className="rounded border border-dashed p-3 space-y-3">
                      <h5 className="text-xs font-medium text-muted-foreground">Request Additional Permissions</h5>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground">AWS Actions (press Enter to add)</label>
                          <TagInput
                            values={permActions}
                            onChange={setPermActions}
                            placeholder="e.g. s3:PutObject"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground">Resource ARNs (press Enter to add)</label>
                          <TagInput
                            values={permResources}
                            onChange={setPermResources}
                            placeholder="e.g. arn:aws:s3:::my-bucket/*"
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground">Justification</label>
                        <Textarea
                          placeholder="Explain why these permissions are needed..."
                          value={permJustification}
                          onChange={(e) => setPermJustification(e.target.value)}
                          rows={2}
                          className="text-sm"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={permActions.length === 0 || permResources.length === 0 || !permJustification.trim()}
                        onClick={async () => {
                          try {
                            await securityApi.createPermissionRequest({
                              managed_role_id: selectedRole.id,
                              requested_actions: permActions,
                              requested_resources: permResources,
                              justification: permJustification.trim(),
                            });
                            toast.success("Permission request submitted");
                            setPermActions([]);
                            setPermResources([]);
                            setPermJustification("");
                            setShowPermRequest(false);
                          } catch {
                            toast.error("Failed to submit permission request");
                          }
                        }}
                      >
                        Submit Request
                      </Button>
                    </div>
                  )}
                </section>
              )}

              {/* Authorizer */}
              <section className="space-y-3">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Authorizer</h4>
                <div className="w-1/4">
                  <SearchableSelect
                    options={[
                      { value: "", label: "None" },
                      ...authConfigs.map((c) => ({
                        value: c.id.toString(),
                        label: c.name,
                      })),
                    ]}
                    value={selectedAuthConfigId}
                    onValueChange={setSelectedAuthConfigId}
                    placeholder="Select authorizer config..."
                  />
                </div>
                {selectedAuthConfig && (
                  <div className="rounded border p-3 bg-muted/30 text-xs space-y-1">
                    <p><span className="text-muted-foreground">Type:</span> {selectedAuthConfig.authorizer_type}</p>
                    {selectedAuthConfig.pool_id && <p><span className="text-muted-foreground">Pool:</span> {selectedAuthConfig.pool_id}</p>}
                    {selectedAuthConfig.discovery_url && <p><span className="text-muted-foreground">Discovery URL:</span> {selectedAuthConfig.discovery_url}</p>}
                    {selectedAuthConfig.allowed_clients.length > 0 && (
                      <p><span className="text-muted-foreground">Allowed Clients:</span> {selectedAuthConfig.allowed_clients.join(", ")}</p>
                    )}
                    {selectedAuthConfig.allowed_scopes.length > 0 && (
                      <p><span className="text-muted-foreground">Allowed Scopes:</span> {selectedAuthConfig.allowed_scopes.join(", ")}</p>
                    )}
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
                      placeholder={`Defaults to ${defaults.idle_timeout_seconds} (${Math.round(defaults.idle_timeout_seconds / 60)} min)`}
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
                      placeholder={`Defaults to ${defaults.max_lifetime_seconds} (${Math.round(defaults.max_lifetime_seconds / 3600)} hr)`}
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

              {/* Resource Tags */}
              {tagPolicies.filter(tp => tp.source === "build-time").length > 0 && (
                <section className="space-y-3">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Resource Tags</h4>
                  <div className="grid grid-cols-2 gap-3">
                    {tagPolicies.filter(tp => tp.source === "build-time").map(tp => (
                      <div key={tp.key} className="space-y-1">
                        <label className="text-xs text-muted-foreground">
                          {tp.key}{tp.required && <span className="text-destructive"> *</span>}
                        </label>
                        <Input
                          placeholder={tp.default_value || `Enter ${tp.key}`}
                          value={tagValues[tp.key] || ""}
                          onChange={(e) => setTagValues(prev => ({ ...prev, [tp.key]: e.target.value }))}
                          className="text-sm"
                        />
                      </div>
                    ))}
                  </div>
                  {tagPolicies.filter(tp => tp.source === "deploy-time").length > 0 && (
                    <p className="text-[10px] text-muted-foreground italic">
                      Deploy-time tags ({tagPolicies.filter(tp => tp.source === "deploy-time").map(tp => `${tp.key}=${tp.default_value}`).join(", ")}) are applied automatically.
                    </p>
                  )}
                </section>
              )}

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

              <div className="space-y-1.5">
              <p className="text-[10px] text-muted-foreground italic">
                Deployment typically takes ~1 minute
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  size="sm"
                  className="min-w-[120px]"
                  disabled={isLoading || !name.trim() || !modelId || !selectedRoleId || !onDeploy || hasValidationErrors || !hasRequiredTags}
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Deploying... ({elapsedSeconds}s)
                    </span>
                  ) : (
                    "Deploy"
                  )}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setName("");
                    setDescription("");
                    setAgentDescription("");
                    setBehavioralGuidelines("");
                    setOutputExpectations("");
                    setModelId("");
                    setSelectedRoleId("");
                    setNetworkMode("PUBLIC");
                    setSelectedAuthConfigId("");
                    setIdleTimeout("");
                    setMaxLifetime("");
                    setIdleTimeoutError("");
                    setMaxLifetimeError("");
                    setTagValues({});
                  }}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
              </div>
              </div>
          </div>
      )}
    </form>
  );
}
