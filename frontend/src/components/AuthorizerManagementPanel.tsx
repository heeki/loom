import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuthorizerConfigs } from "@/hooks/useSecurity";
import { Pencil, Trash2, Plus, ChevronDown, ChevronRight } from "lucide-react";
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

export function AuthorizerManagementPanel() {
  const { configs, loading, error, createConfig, updateConfig, deleteConfig } = useAuthorizerConfigs();
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("cognito");
  const [formPoolId, setFormPoolId] = useState("");
  const [formDiscoveryUrl, setFormDiscoveryUrl] = useState("");
  const [formAllowedClients, setFormAllowedClients] = useState<string[]>([]);
  const [formAllowedScopes, setFormAllowedScopes] = useState<string[]>([]);
  const [formClientId, setFormClientId] = useState("");
  const [formClientSecret, setFormClientSecret] = useState("");

  const resetForm = () => {
    setFormName("");
    setFormType("cognito");
    setFormPoolId("");
    setFormDiscoveryUrl("");
    setFormAllowedClients([]);
    setFormAllowedScopes([]);
    setFormClientId("");
    setFormClientSecret("");
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
        client_id: formClientId || undefined,
        client_secret: formClientSecret || undefined,
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
    setFormName(config.name);
    setFormType(config.authorizer_type);
    setFormPoolId(config.pool_id ?? "");
    setFormDiscoveryUrl(config.discovery_url ?? "");
    setFormAllowedClients(config.allowed_clients);
    setFormAllowedScopes(config.allowed_scopes);
    setFormClientId(config.client_id ?? "");
    setFormClientSecret("");
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
        client_id: formClientId || undefined,
        client_secret: formClientSecret || undefined,
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

  const renderForm = (isEdit: boolean, id?: number) => (
    <div className="space-y-3">
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-xs text-muted-foreground">Name</label>
          <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Config name" />
        </div>
        <div className="w-40">
          <label className="text-xs text-muted-foreground">Type</label>
          <Select value={formType} onValueChange={setFormType}>
            <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cognito">Cognito</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {formType === "cognito" && (
        <div>
          <label className="text-xs text-muted-foreground">Cognito Pool ID</label>
          <Input value={formPoolId} onChange={(e) => setFormPoolId(e.target.value)} placeholder="us-east-1_xxxxxx" />
        </div>
      )}
      <div>
        <label className="text-xs text-muted-foreground">Discovery URL</label>
        <Input value={formDiscoveryUrl} onChange={(e) => setFormDiscoveryUrl(e.target.value)} placeholder="https://..." />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Allowed Clients (press Enter to add)</label>
          <TagInput values={formAllowedClients} onChange={setFormAllowedClients} placeholder="Client ID" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Allowed Scopes (press Enter to add)</label>
          <TagInput values={formAllowedScopes} onChange={setFormAllowedScopes} placeholder="Scope" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Client ID</label>
          <Input value={formClientId} onChange={(e) => setFormClientId(e.target.value)} placeholder="App client ID" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Client Secret</label>
          <Input type="password" value={formClientSecret} onChange={(e) => setFormClientSecret(e.target.value)} placeholder={isEdit ? "Leave blank to keep existing" : "App client secret"} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => isEdit && id ? handleUpdate(id) : handleCreate()} disabled={submitting || !formName.trim()}>
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
        <h3 className="text-sm font-medium">Authorizer Configurations</h3>
        <Button size="sm" variant="outline" onClick={() => { setShowAddForm(!showAddForm); resetForm(); }}>
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
                    onClick={() => setExpandedId(expandedId === config.id ? null : config.id)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {expandedId === config.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{config.name}</div>
                    <div className="text-xs text-muted-foreground">{config.authorizer_type}</div>
                  </div>
                  <div className="text-xs text-muted-foreground hidden sm:block max-w-[40%] truncate">
                    {config.discovery_url}
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
                  <div className="pl-6 space-y-1 text-xs">
                    {config.pool_id && <div><span className="text-muted-foreground">Pool: </span>{config.pool_id}</div>}
                    {config.discovery_url && <div><span className="text-muted-foreground">Discovery: </span><span className="break-all">{config.discovery_url}</span></div>}
                    {config.allowed_clients.length > 0 && <div><span className="text-muted-foreground">Clients: </span>{config.allowed_clients.join(", ")}</div>}
                    {config.allowed_scopes.length > 0 && <div><span className="text-muted-foreground">Scopes: </span>{config.allowed_scopes.join(", ")}</div>}
                    {config.client_id && <div><span className="text-muted-foreground">Client ID: </span>{config.client_id}</div>}
                    <div><span className="text-muted-foreground">Has Secret: </span>{config.has_client_secret ? "Yes" : "No"}</div>
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
