import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PolicyViewer } from "@/components/PolicyViewer";
import { JsonConfigSection } from "@/components/JsonConfigSection";
import * as agentsApi from "@/api/agents";
import * as securityApi from "@/api/security";
import * as settingsApi from "@/api/settings";
import { listMcpServers } from "@/api/mcp";
import { listA2aAgents } from "@/api/a2a";
import { listMemories } from "@/api/memories";
import { ResourceTagFields } from "@/components/ResourceTagFields";
import type { AgentDeployRequest, ModelOption, ManagedRole, AuthorizerConfigResponse, TagProfile, McpServer, A2aAgent, MemoryResponse } from "@/api/types";
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

type Mode = "register" | "deploy";

interface AgentRegistrationFormProps {
  mode: Mode;
  onRegister: (arn: string, modelId?: string) => Promise<void>;
  onDeploy?: (request: AgentDeployRequest) => Promise<void>;
  isLoading: boolean;
  groupRestriction?: string;
}

export function AgentRegistrationForm({ mode, onRegister, onDeploy, isLoading, groupRestriction }: AgentRegistrationFormProps) {

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
  const [selectedMcpServerIds, setSelectedMcpServerIds] = useState<number[]>([]);
  const [selectedA2aAgentIds, setSelectedA2aAgentIds] = useState<number[]>([]);
  const [selectedMemoryIds, setSelectedMemoryIds] = useState<number[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [a2aAgents, setA2aAgents] = useState<A2aAgent[]>([]);
  const [memories, setMemories] = useState<MemoryResponse[]>([]);

  // Tag state (populated by ResourceTagFields via profile selection)
  const [tagValues, setTagValues] = useState<Record<string, string>>({});
  const [tagProfiles, setTagProfiles] = useState<TagProfile[]>([]);
  const [selectedTagProfileId, setSelectedTagProfileId] = useState<string | undefined>(undefined);


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
      void settingsApi.listTagProfiles().then(setTagProfiles).catch(() => {});
      void listMcpServers().then(setMcpServers).catch(() => {});
      void listA2aAgents().then(setA2aAgents).catch(() => {});
      void listMemories().then(setMemories).catch(() => {});
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
        memory_enabled: selectedMemoryIds.length > 0,
        memory_ids: selectedMemoryIds,
        mcp_servers: selectedMcpServerIds,
        a2a_agents: selectedA2aAgentIds,
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
      setSelectedMcpServerIds([]);
      setSelectedA2aAgentIds([]);
      setSelectedMemoryIds([]);
    }
  };

  // Filter resources by group if restricted
  const filteredMcpServers = mcpServers; // MCP servers are shared (no group tag)
  const filteredA2aAgents = a2aAgents; // A2A agents are shared (no group tag)
  const filteredMemories = groupRestriction
    ? memories.filter((m) => m.tags?.["loom:group"] === groupRestriction)
    : memories;

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
              {/* JSON Import / Export */}
              <JsonConfigSection
                onApply={(json) => {
                  try {
                    const parsed = JSON.parse(json);
                    if (parsed.name) setName(parsed.name);
                    if (parsed.description) setDescription(parsed.description);
                    if (parsed.persona) setAgentDescription(parsed.persona);
                    if (parsed.instructions) setBehavioralGuidelines(parsed.instructions);
                    if (parsed.behavior) setOutputExpectations(parsed.behavior);
                    if (parsed.model) {
                      const match = models.find((m) => m.model_id === parsed.model || m.display_name === parsed.model);
                      if (match) setModelId(match.model_id);
                    }
                    if (parsed.role) {
                      const match = managedRoles.find((r) => r.role_name === parsed.role || r.role_arn === parsed.role);
                      if (match) setSelectedRoleId(match.id.toString());
                    }
                    if (parsed.network_mode) setNetworkMode(parsed.network_mode);
                    if (parsed.authorizer) {
                      const match = authConfigs.find((c) => c.name === parsed.authorizer || c.id.toString() === parsed.authorizer);
                      if (match) setSelectedAuthConfigId(match.id.toString());
                    }
                    if (parsed.tags) {
                      const match = tagProfiles.find((p) => p.name === parsed.tags);
                      if (match) setSelectedTagProfileId(match.id.toString());
                    }
                    if (Array.isArray(parsed.mcp_servers)) {
                      const ids = parsed.mcp_servers
                        .map((s: string | number) => {
                          if (typeof s === "number") return s;
                          const match = mcpServers.find((m) => m.name === s);
                          return match?.id;
                        })
                        .filter((id: number | undefined): id is number => id !== undefined);
                      setSelectedMcpServerIds(ids);
                    }
                    if (Array.isArray(parsed.a2a_agents)) {
                      const ids = parsed.a2a_agents
                        .map((s: string | number) => {
                          if (typeof s === "number") return s;
                          const match = a2aAgents.find((a) => a.name === s);
                          return match?.id;
                        })
                        .filter((id: number | undefined): id is number => id !== undefined);
                      setSelectedA2aAgentIds(ids);
                    }
                    if (Array.isArray(parsed.memories)) {
                      const ids = parsed.memories
                        .map((s: string | number) => {
                          if (typeof s === "number") return s;
                          const match = memories.find((m) => m.name === s);
                          return match?.id;
                        })
                        .filter((id: number | undefined): id is number => id !== undefined);
                      setSelectedMemoryIds(ids);
                    }
                    return null;
                  } catch {
                    return "Invalid JSON. Please check the format and try again.";
                  }
                }}
                onExport={() => {
                  const result: Record<string, unknown> = {};
                  if (name) result.name = name;
                  if (description) result.description = description;
                  if (agentDescription) result.persona = agentDescription;
                  if (behavioralGuidelines) result.instructions = behavioralGuidelines;
                  if (outputExpectations) result.behavior = outputExpectations;
                  if (modelId) {
                    result.model = modelId;
                  }
                  if (selectedRoleId) {
                    const role = managedRoles.find((r) => r.id.toString() === selectedRoleId);
                    if (role) result.role = role.role_name;
                  }
                  if (networkMode && networkMode !== "PUBLIC") result.network_mode = networkMode;
                  if (selectedAuthConfigId) {
                    const auth = authConfigs.find((c) => c.id.toString() === selectedAuthConfigId);
                    if (auth) result.authorizer = auth.name;
                  }
                  if (selectedTagProfileId) {
                    const profile = tagProfiles.find((p) => p.id.toString() === selectedTagProfileId);
                    if (profile) result.tags = profile.name;
                  }
                  if (selectedMcpServerIds.length > 0) {
                    result.mcp_servers = selectedMcpServerIds.map((id) => {
                      const server = mcpServers.find((s) => s.id === id);
                      return server?.name ?? id;
                    });
                  }
                  if (selectedA2aAgentIds.length > 0) {
                    result.a2a_agents = selectedA2aAgentIds.map((id) => {
                      const agent = a2aAgents.find((a) => a.id === id);
                      return agent?.name ?? id;
                    });
                  }
                  if (selectedMemoryIds.length > 0) {
                    result.memories = selectedMemoryIds.map((id) => {
                      const mem = memories.find((m) => m.id === id);
                      return mem?.name ?? id;
                    });
                  }
                  return JSON.stringify(result, null, 2);
                }}
                placeholder='{"name": "...", "description": "...", "persona": "...", "instructions": "...", "behavior": "...", "model": "...", "role": "...", "authorizer": "...", "tags": "...", "mcp_servers": ["..."], "a2a_agents": ["..."], "memories": ["..."]}'
              />

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
              <ResourceTagFields onChange={setTagValues} profileId={selectedTagProfileId} groupRestriction={groupRestriction} />

              {/* Integrations */}
              <section className="space-y-3">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Integrations</h4>
                <div className="space-y-3">
                  {/* MCP Servers */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">MCP Servers</label>
                    {filteredMcpServers.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">No MCP servers available. Register servers on the MCP Servers page first.</p>
                    ) : (
                      <div className="space-y-1">
                        {filteredMcpServers.map((server) => (
                          <label key={server.id} className="flex items-center gap-2 text-xs cursor-pointer min-w-0">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 shrink-0"
                              checked={selectedMcpServerIds.includes(server.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedMcpServerIds((prev) => [...prev, server.id]);
                                } else {
                                  setSelectedMcpServerIds((prev) => prev.filter((id) => id !== server.id));
                                }
                              }}
                            />
                            <span className="shrink-0">{server.name}</span>
                            <span className="text-muted-foreground/60 truncate min-w-0" title={server.endpoint_url}>{server.endpoint_url}</span>
                            {server.auth_type === "oauth2" && (
                              <span className="text-[10px] text-muted-foreground bg-accent px-1 rounded shrink-0">OAuth2</span>
                            )}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* A2A Agents */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">A2A Agents</label>
                    {filteredA2aAgents.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">No A2A agents available. Register agents on the A2A Agents page first.</p>
                    ) : (
                      <div className="space-y-1">
                        {filteredA2aAgents.map((agent) => (
                          <label key={agent.id} className="flex items-center gap-2 text-xs cursor-pointer min-w-0">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 shrink-0"
                              checked={selectedA2aAgentIds.includes(agent.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedA2aAgentIds((prev) => [...prev, agent.id]);
                                } else {
                                  setSelectedA2aAgentIds((prev) => prev.filter((id) => id !== agent.id));
                                }
                              }}
                            />
                            <span className="shrink-0">{agent.name}</span>
                            <span className="text-muted-foreground/60 truncate min-w-0" title={agent.base_url}>{agent.base_url}</span>
                            {agent.auth_type === "oauth2" && (
                              <span className="text-[10px] text-muted-foreground bg-accent px-1 rounded shrink-0">OAuth2</span>
                            )}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Memory Resources */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Memory Resources</label>
                    {filteredMemories.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">No memory resources available{groupRestriction ? " for your group" : ""}. Create one on the Memory page first.</p>
                    ) : (
                      <div className="space-y-1">
                        {filteredMemories.map((mem) => (
                          <label key={mem.id} className="flex items-center gap-2 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5"
                              checked={selectedMemoryIds.includes(mem.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedMemoryIds((prev) => [...prev, mem.id]);
                                } else {
                                  setSelectedMemoryIds((prev) => prev.filter((id) => id !== mem.id));
                                }
                              }}
                            />
                            <span>{mem.name}</span>
                            {mem.status !== "ACTIVE" && (
                              <span className="text-[10px] text-muted-foreground bg-accent px-1 rounded">{mem.status}</span>
                            )}
                          </label>
                        ))}
                      </div>
                    )}
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
                  disabled={isLoading || !name.trim() || !modelId || !selectedRoleId || !onDeploy || hasValidationErrors}
                >
                  {isLoading ? "Deploying..." : "Deploy"}
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
                    setSelectedMcpServerIds([]);
                    setSelectedA2aAgentIds([]);
                    setSelectedMemoryIds([]);
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
