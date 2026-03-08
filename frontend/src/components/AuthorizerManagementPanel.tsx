import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuthorizerConfigs } from "@/hooks/useSecurity";
import { listCognitoPools, listAuthorizerCredentials, createAuthorizerCredential, deleteAuthorizerCredential } from "@/api/security";
import { Pencil, Trash2, Plus, ChevronDown, ChevronRight, Key } from "lucide-react";
import { toast } from "sonner";
import type { CognitoPool, AuthorizerCredential } from "@/api/types";

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

export function AuthorizerManagementPanel() {
  const { configs, loading, error, createConfig, updateConfig, deleteConfig } = useAuthorizerConfigs();
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Cognito pools from AWS
  const [cognitoPools, setCognitoPools] = useState<CognitoPool[]>([]);
  const [poolsLoading, setPoolsLoading] = useState(false);

  // Credentials per authorizer
  const [credentials, setCredentials] = useState<Record<number, AuthorizerCredential[]>>({});
  const [showAddCred, setShowAddCred] = useState<number | null>(null);
  const [credLabel, setCredLabel] = useState("");
  const [credClientId, setCredClientId] = useState("");
  const [credClientSecret, setCredClientSecret] = useState("");
  const [credSubmitting, setCredSubmitting] = useState(false);
  const [confirmDeleteCredId, setConfirmDeleteCredId] = useState<{ authId: number; credId: number } | null>(null);

  const fetchCredentials = async (authId: number) => {
    try {
      const creds = await listAuthorizerCredentials(authId);
      setCredentials((prev) => ({ ...prev, [authId]: creds }));
    } catch {
      toast.error("Failed to load credentials");
    }
  };

  const handleCreateCredential = async (authId: number) => {
    if (!credLabel.trim() || !credClientId.trim()) return;
    setCredSubmitting(true);
    try {
      await createAuthorizerCredential(authId, {
        label: credLabel.trim(),
        client_id: credClientId.trim(),
        client_secret: credClientSecret.trim() || undefined,
      });
      setShowAddCred(null);
      setCredLabel("");
      setCredClientId("");
      setCredClientSecret("");
      toast.success("Credential added");
      fetchCredentials(authId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add credential");
    } finally {
      setCredSubmitting(false);
    }
  };

  const handleDeleteCredential = async (authId: number, credId: number) => {
    setCredSubmitting(true);
    try {
      await deleteAuthorizerCredential(authId, credId);
      setConfirmDeleteCredId(null);
      toast.success("Credential deleted");
      fetchCredentials(authId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete credential");
    } finally {
      setCredSubmitting(false);
    }
  };

  // Form state
  const [formType, setFormType] = useState("cognito");
  const [formName, setFormName] = useState("");
  const [formPoolId, setFormPoolId] = useState("");
  const [formDiscoveryUrl, setFormDiscoveryUrl] = useState("");
  const [formAllowedClients, setFormAllowedClients] = useState<string[]>([]);
  const [formAllowedScopes, setFormAllowedScopes] = useState<string[]>([]);

  const fetchPools = () => {
    setPoolsLoading(true);
    listCognitoPools()
      .then(setCognitoPools)
      .catch(() => toast.error("Failed to load Cognito pools"))
      .finally(() => setPoolsLoading(false));
  };

  // Fetch pools when the add form opens with Cognito type, or when editing a Cognito config
  useEffect(() => {
    if ((showAddForm || editingId !== null) && formType === "cognito" && cognitoPools.length === 0) {
      fetchPools();
    }
  }, [showAddForm, editingId, formType]);

  // Auto-populate discovery URL when a Cognito pool is selected
  useEffect(() => {
    if (formType === "cognito" && formPoolId) {
      const pool = cognitoPools.find((p) => p.pool_id === formPoolId);
      if (pool) {
        setFormDiscoveryUrl(pool.discovery_url);
      }
    }
  }, [formPoolId, formType, cognitoPools]);

  const resetForm = () => {
    setFormType("cognito");
    setFormName("");
    setFormPoolId("");
    setFormDiscoveryUrl("");
    setFormAllowedClients([]);
    setFormAllowedScopes([]);
  };

  const handleCreate = async () => {
    if (!formName.trim()) return;
    setSubmitting(true);
    try {
      await createConfig({
        name: formName.trim(),
        authorizer_type: formType,
        pool_id: formPoolId || undefined,
        discovery_url: formDiscoveryUrl || undefined,
        allowed_clients: formAllowedClients,
        allowed_scopes: formAllowedScopes,
      });
      resetForm();
      setShowAddForm(false);
      toast.success("Authorizer config created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create config");
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (id: number) => {
    const config = configs.find((c) => c.id === id);
    if (!config) return;
    setEditingId(id);
    setFormType(config.authorizer_type);
    setFormName(config.name);
    setFormPoolId(config.pool_id ?? "");
    setFormDiscoveryUrl(config.discovery_url ?? "");
    setFormAllowedClients(config.allowed_clients);
    setFormAllowedScopes(config.allowed_scopes);
  };

  const handleUpdate = async (id: number) => {
    setSubmitting(true);
    try {
      await updateConfig(id, {
        name: formName.trim() || undefined,
        authorizer_type: formType,
        pool_id: formPoolId || undefined,
        discovery_url: formDiscoveryUrl || undefined,
        allowed_clients: formAllowedClients,
        allowed_scopes: formAllowedScopes,
      });
      setEditingId(null);
      resetForm();
      toast.success("Authorizer config updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update config");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    setSubmitting(true);
    try {
      await deleteConfig(id);
      setConfirmDeleteId(null);
      toast.success("Authorizer config deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete config");
    } finally {
      setSubmitting(false);
    }
  };

  const poolOptions = cognitoPools.map((p) => ({
    value: p.pool_id,
    label: `${p.pool_name} (${p.pool_id})`,
  }));

  const renderForm = (isEdit: boolean, id?: number) => (
    <div className="space-y-3">
      <div className="flex gap-3">
        <div className="w-[30%] min-w-0">
          <label className="text-xs text-muted-foreground">Config Name</label>
          <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Authorizer name that builders select" />
        </div>
        <div className="w-[15%] min-w-0">
          <label className="text-xs text-muted-foreground">Type</label>
          <Select value={formType} onValueChange={(v) => { setFormType(v); setFormPoolId(""); setFormDiscoveryUrl(""); }}>
            <SelectTrigger className="w-full text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cognito">Cognito</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {formType === "cognito" && (
          <div className="flex-1 min-w-0">
            <label className="text-xs text-muted-foreground">Cognito User Pool</label>
            {poolsLoading ? (
              <Skeleton className="h-9" />
            ) : (
              <SearchableSelect
                options={poolOptions}
                value={formPoolId}
                onValueChange={setFormPoolId}
                placeholder="Search for a pool..."
              />
            )}
          </div>
        )}
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Discovery URL</label>
        <Input
          value={formDiscoveryUrl}
          onChange={(e) => setFormDiscoveryUrl(e.target.value)}
          placeholder="https://..."
          readOnly={formType === "cognito"}
          className={formType === "cognito" ? "bg-muted/50" : ""}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-h-[5.5rem]">
          <label className="text-xs text-muted-foreground">Allowed Clients (press Enter to add)</label>
          <TagInput values={formAllowedClients} onChange={setFormAllowedClients} placeholder="Client ID" />
        </div>
        <div className="min-h-[5.5rem]">
          <label className="text-xs text-muted-foreground">Allowed Scopes (press Enter to add)</label>
          <TagInput values={formAllowedScopes} onChange={setFormAllowedScopes} placeholder="Scope" />
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" className="min-w-[120px]" onClick={() => isEdit && id ? handleUpdate(id) : handleCreate()} disabled={submitting || !formName.trim()}>
          {submitting ? "Saving..." : isEdit ? "Save" : "Create"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { isEdit ? setEditingId(null) : setShowAddForm(false); resetForm(); }}>
          Cancel
        </Button>
      </div>
    </div>
  );

  if (loading) {
    return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>;
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Authorizer Configurations</h3>
          <p className="text-xs text-muted-foreground mt-1">
            These are the authorizers approved for use in Loom.<br />
            Builders can only select from these authorizers when deploying agents.<br />
            Authorizer management is the responsibility of the security team.
          </p>
        </div>
        <Button size="sm" variant="outline" className="shrink-0 ml-4" onClick={() => { setShowAddForm(!showAddForm); resetForm(); }}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Authorizer
        </Button>
      </div>

      {showAddForm && (
        <Card>
          <CardContent className="pt-4">
            {renderForm(false)}
          </CardContent>
        </Card>
      )}

      {configs.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No authorizer configs yet. Add one above.</p>
      ) : (
        <div className="space-y-2">
          {configs.map((config) => (
            <Card key={config.id}>
              <CardContent className="py-3 space-y-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const next = expandedId === config.id ? null : config.id;
                      setExpandedId(next);
                      if (next !== null && !credentials[config.id]) {
                        fetchCredentials(config.id);
                      }
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {expandedId === config.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{config.name}</div>
                    <div className="text-xs text-muted-foreground">{config.authorizer_type === "cognito" ? "Amazon Cognito" : config.authorizer_type}</div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(config.id)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(config.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {confirmDeleteId === config.id && (
                  <div className="flex items-center gap-2 rounded border border-destructive/50 bg-destructive/5 p-2 text-xs">
                    <span>Delete this config?</span>
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(config.id)} disabled={submitting}>
                      Confirm
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(null)}>
                      Cancel
                    </Button>
                  </div>
                )}

                {editingId === config.id && (
                  <div className="rounded border border-dashed p-3">
                    {renderForm(true, config.id)}
                  </div>
                )}

                {expandedId === config.id && editingId !== config.id && (
                  <div className="pl-6 space-y-3">
                    <div className="rounded border bg-input-bg p-3 space-y-1 text-xs">
                      {config.pool_id && <div><span className="text-muted-foreground">Pool: </span>{config.pool_id}</div>}
                      {config.discovery_url && <div><span className="text-muted-foreground">Discovery URL: </span><span className="break-all">{config.discovery_url}</span></div>}
                      {config.allowed_clients.length > 0 && <div><span className="text-muted-foreground">Allowed Clients: </span>{config.allowed_clients.join(", ")}</div>}
                      {config.allowed_scopes.length > 0 && <div><span className="text-muted-foreground">Allowed Scopes: </span>{config.allowed_scopes.join(", ")}</div>}
                    </div>

                    {/* Credentials section */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <Key className="h-3.5 w-3.5" />
                          Credentials
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs"
                          onClick={() => {
                            setShowAddCred(showAddCred === config.id ? null : config.id);
                            setCredLabel("");
                            setCredClientId("");
                            setCredClientSecret("");
                          }}
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          Add
                        </Button>
                      </div>

                      {showAddCred === config.id && (
                        <div className="rounded border border-dashed p-3 mb-2 space-y-2">
                          <div className="flex gap-2">
                            <div className="w-1/4 min-w-0">
                              <label className="text-xs text-muted-foreground">Label</label>
                              <Input
                                value={credLabel}
                                onChange={(e) => setCredLabel(e.target.value)}
                                placeholder="e.g. Production M2M"
                                className="text-sm h-8"
                              />
                            </div>
                            <div className="w-1/4 min-w-0">
                              <label className="text-xs text-muted-foreground">Client ID</label>
                              <Input
                                value={credClientId}
                                onChange={(e) => setCredClientId(e.target.value)}
                                placeholder="Client ID"
                                className="text-sm h-8"
                              />
                            </div>
                            <div className="w-1/2 min-w-0">
                              <label className="text-xs text-muted-foreground">Client Secret</label>
                              <Input
                                type="password"
                                value={credClientSecret}
                                onChange={(e) => setCredClientSecret(e.target.value)}
                                placeholder="Client Secret (optional)"
                                className="text-sm h-8"
                              />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => handleCreateCredential(config.id)}
                              disabled={credSubmitting || !credLabel.trim() || !credClientId.trim()}
                            >
                              {credSubmitting ? "Saving..." : "Save"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={() => setShowAddCred(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}

                      {credentials[config.id]?.length ? (
                        <div className="space-y-1">
                          {credentials[config.id]!.map((cred) => (
                            <div
                              key={cred.id}
                              className="flex items-center justify-between rounded border bg-input-bg px-3 py-1.5 text-xs"
                            >
                              <div className="flex items-center gap-3">
                                <span className="font-medium">{cred.label}</span>
                                <span className="text-muted-foreground font-mono">{cred.client_id}</span>
                                {cred.has_secret && (
                                  <span className="rounded-full border border-border bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                    secret stored
                                  </span>
                                )}
                              </div>
                              <div>
                                {confirmDeleteCredId?.authId === config.id && confirmDeleteCredId?.credId === cred.id ? (
                                  <div className="flex items-center gap-1">
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      className="h-6 text-xs"
                                      onClick={() => handleDeleteCredential(config.id, cred.id)}
                                      disabled={credSubmitting}
                                    >
                                      Confirm
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 text-xs"
                                      onClick={() => setConfirmDeleteCredId(null)}
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 w-6 p-0"
                                    onClick={() => setConfirmDeleteCredId({ authId: config.id, credId: cred.id })}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : credentials[config.id] ? (
                        <p className="text-xs text-muted-foreground">No credentials configured.</p>
                      ) : null}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
