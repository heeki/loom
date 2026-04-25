import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus, RefreshCw, FlaskConical, X } from "lucide-react";
import {
  listIdentityProviders,
  createIdentityProvider,
  updateIdentityProvider,
  deleteIdentityProvider,
  discoverIdentityProvider,
  testDiscovery,
  type IdentityProviderResponse,
  type CreateIdentityProviderRequest,
} from "@/api/identity_providers";

const PROVIDER_TYPES = [
  { value: "azure_ad", label: "Microsoft Entra ID" },
  { value: "okta", label: "Okta" },
  { value: "auth0", label: "Auth0" },
  { value: "generic_oidc", label: "Generic OIDC" },
];

const PROVIDER_HINTS: Record<string, string> = {
  azure_ad: "https://login.microsoftonline.com/{tenant-id}/v2.0",
  okta: "https://{your-domain}.okta.com",
  auth0: "https://{your-domain}.auth0.com/",
  generic_oidc: "https://your-issuer.example.com",
};

const GROUP_CLAIM_HINTS: Record<string, string> = {
  azure_ad: "groups",
  okta: "groups",
  auth0: "https://your-namespace/roles",
  generic_oidc: "groups",
};

interface IdentityProviderPanelProps {
  readOnly?: boolean;
}

export function IdentityProviderPanel({ readOnly }: IdentityProviderPanelProps) {
  const [providers, setProviders] = useState<IdentityProviderResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<IdentityProviderResponse | null>(null);
  const [discoveryStatus, setDiscoveryStatus] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formProviderType, setFormProviderType] = useState("azure_ad");
  const [formIssuerUrl, setFormIssuerUrl] = useState("");
  const [formClientId, setFormClientId] = useState("");
  const [formClientSecret, setFormClientSecret] = useState("");
  const [formScopes, setFormScopes] = useState("");
  const [formAudience, setFormAudience] = useState("");
  const [formGroupClaimPath, setFormGroupClaimPath] = useState("");
  const [formStatus, setFormStatus] = useState("active");
  const [formMappings, setFormMappings] = useState<{ external: string; loom: string }[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchProviders = async () => {
    try {
      const data = await listIdentityProviders();
      setProviders(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load identity providers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchProviders(); }, []);

  const resetForm = () => {
    setFormName("");
    setFormProviderType("azure_ad");
    setFormIssuerUrl("");
    setFormClientId("");
    setFormClientSecret("");
    setFormScopes("");
    setFormAudience("");
    setFormGroupClaimPath("");
    setFormStatus("active");
    setFormMappings([]);
    setEditing(null);
    setDiscoveryStatus(null);
  };

  const openEdit = (idp: IdentityProviderResponse) => {
    setEditing(idp);
    setFormName(idp.name);
    setFormProviderType(idp.provider_type);
    setFormIssuerUrl(idp.issuer_url);
    setFormClientId(idp.client_id);
    setFormClientSecret("");
    setFormScopes(idp.scopes || "");
    setFormAudience(idp.audience || "");
    setFormGroupClaimPath(idp.group_claim_path || "");
    setFormStatus(idp.status);
    const mappings = Object.entries(idp.group_mappings).map(([ext, loom]) => ({
      external: ext,
      loom: loom.join(", "),
    }));
    setFormMappings(mappings.length > 0 ? mappings : []);
    setShowForm(true);
    setDiscoveryStatus(null);
  };

  const handleTestDiscovery = async () => {
    if (!formIssuerUrl.trim()) return;
    setDiscoveryStatus("testing...");
    try {
      const result = await testDiscovery(formIssuerUrl.trim());
      if (result.status === "ok") {
        setDiscoveryStatus(`OK — JWKS: ${result.jwks_uri}`);
      } else {
        setDiscoveryStatus(`Error: ${result.detail}`);
      }
    } catch (e) {
      setDiscoveryStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const groupMappings: Record<string, string[]> = {};
      for (const m of formMappings) {
        if (m.external.trim()) {
          groupMappings[m.external.trim()] = m.loom.split(",").map((s) => s.trim()).filter(Boolean);
        }
      }

      if (editing) {
        await updateIdentityProvider(editing.id, {
          name: formName,
          provider_type: formProviderType,
          issuer_url: formIssuerUrl,
          client_id: formClientId,
          client_secret: formClientSecret || undefined,
          scopes: formScopes || undefined,
          audience: formAudience || undefined,
          group_claim_path: formGroupClaimPath || undefined,
          group_mappings: Object.keys(groupMappings).length > 0 ? groupMappings : undefined,
          status: formStatus,
        });
      } else {
        const data: CreateIdentityProviderRequest = {
          name: formName,
          provider_type: formProviderType,
          issuer_url: formIssuerUrl,
          client_id: formClientId,
          client_secret: formClientSecret || undefined,
          scopes: formScopes || undefined,
          audience: formAudience || undefined,
          group_claim_path: formGroupClaimPath || undefined,
          group_mappings: Object.keys(groupMappings).length > 0 ? groupMappings : undefined,
          status: formStatus,
        };
        await createIdentityProvider(data);
      }
      resetForm();
      setShowForm(false);
      await fetchProviders();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save identity provider");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (idp: IdentityProviderResponse) => {
    if (!confirm(`Delete identity provider "${idp.name}"?`)) return;
    try {
      await deleteIdentityProvider(idp.id);
      await fetchProviders();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const handleRefreshDiscovery = async (idp: IdentityProviderResponse) => {
    try {
      await discoverIdentityProvider(idp.id);
      await fetchProviders();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Discovery refresh failed");
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading identity providers...</p>;

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!showForm && !readOnly && (
        <Button size="sm" onClick={() => { resetForm(); setShowForm(true); }}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Identity Provider
        </Button>
      )}

      {showForm && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">
              {editing ? `Edit: ${editing.name}` : "New Identity Provider"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. entra-id-prod" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Provider Type</Label>
                <Select value={formProviderType} onValueChange={(v) => { setFormProviderType(v); setFormGroupClaimPath(GROUP_CLAIM_HINTS[v] ?? "groups"); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROVIDER_TYPES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Issuer URL</Label>
              <div className="flex gap-2">
                <Input
                  value={formIssuerUrl}
                  onChange={(e) => setFormIssuerUrl(e.target.value)}
                  placeholder={PROVIDER_HINTS[formProviderType] ?? ""}
                  className="flex-1"
                />
                <Button type="button" size="sm" variant="outline" onClick={() => void handleTestDiscovery()}>
                  <FlaskConical className="h-3.5 w-3.5 mr-1" />
                  Test
                </Button>
              </div>
              {discoveryStatus && (
                <p className={`text-xs ${discoveryStatus.startsWith("OK") ? "text-green-600" : "text-destructive"}`}>
                  {discoveryStatus}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Client ID</Label>
                <Input value={formClientId} onChange={(e) => setFormClientId(e.target.value)} placeholder="App registration client ID" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Client Secret</Label>
                <Input
                  type="password"
                  value={formClientSecret}
                  onChange={(e) => setFormClientSecret(e.target.value)}
                  placeholder={editing?.has_client_secret ? "(stored — leave blank to keep)" : "Client secret value"}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Scopes</Label>
                <Input value={formScopes} onChange={(e) => setFormScopes(e.target.value)} placeholder="openid profile email" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Audience</Label>
                <Input value={formAudience} onChange={(e) => setFormAudience(e.target.value)} placeholder="api://client-id (optional, defaults to client_id)" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Group Claim Path</Label>
                <Input value={formGroupClaimPath} onChange={(e) => setFormGroupClaimPath(e.target.value)} placeholder="groups" />
                <p className="text-[10px] text-muted-foreground">JWT claim containing group membership</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select value={formStatus} onValueChange={setFormStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Group mappings */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Group Mappings</Label>
                <Button type="button" size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setFormMappings([...formMappings, { external: "", loom: "" }])}>
                  <Plus className="h-3 w-3 mr-0.5" /> Add Mapping
                </Button>
              </div>
              {formMappings.length === 0 && (
                <p className="text-[10px] text-muted-foreground italic">No mappings. External group names will be used directly.</p>
              )}
              {formMappings.map((m, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input
                    value={m.external}
                    onChange={(e) => {
                      const next = [...formMappings];
                      next[i] = { ...m, external: e.target.value };
                      setFormMappings(next);
                    }}
                    placeholder="External group (e.g. Loom-Admins)"
                    className="flex-1 text-xs"
                  />
                  <span className="text-xs text-muted-foreground shrink-0">&rarr;</span>
                  <Input
                    value={m.loom}
                    onChange={(e) => {
                      const next = [...formMappings];
                      next[i] = { ...m, loom: e.target.value };
                      setFormMappings(next);
                    }}
                    placeholder="Loom groups (e.g. t-admin, g-admins-super)"
                    className="flex-1 text-xs"
                  />
                  <Button type="button" size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => setFormMappings(formMappings.filter((_, j) => j !== i))}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" onClick={() => { resetForm(); setShowForm(false); }}>Cancel</Button>
              <Button size="sm" onClick={() => void handleSave()} disabled={saving || !formName.trim() || !formIssuerUrl.trim() || !formClientId.trim()}>
                {saving ? "Saving..." : editing ? "Update" : "Create"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Provider list */}
      {providers.length === 0 && !showForm && (
        <p className="text-sm text-muted-foreground">No identity providers configured. Loom uses Cognito for authentication.</p>
      )}

      {providers.map((idp) => (
        <Card key={idp.id}>
          <CardContent className="pt-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{idp.name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {PROVIDER_TYPES.find((p) => p.value === idp.provider_type)?.label ?? idp.provider_type}
                  </Badge>
                  <Badge variant={idp.status === "active" ? "default" : "secondary"} className="text-[10px]">
                    {idp.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground font-mono">{idp.issuer_url}</p>
                <div className="flex gap-4 text-xs text-muted-foreground mt-1">
                  <span>Client: <code className="bg-black/5 dark:bg-white/10 px-1 rounded">{idp.client_id}</code></span>
                  {idp.group_claim_path && <span>Groups: <code className="bg-black/5 dark:bg-white/10 px-1 rounded">{idp.group_claim_path}</code></span>}
                </div>
                {Object.keys(idp.group_mappings).length > 0 && (
                  <div className="mt-2 text-xs">
                    <span className="text-muted-foreground">Mappings: </span>
                    {Object.entries(idp.group_mappings).map(([ext, loom]) => (
                      <span key={ext} className="inline-flex items-center gap-1 mr-3">
                        <Badge variant="outline" className="text-[10px]">{ext}</Badge>
                        <span className="text-muted-foreground">&rarr;</span>
                        {loom.map((g) => <Badge key={g} variant="secondary" className="text-[10px]">{g}</Badge>)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {!readOnly && (
                <div className="flex gap-1 shrink-0">
                  <Button size="icon" variant="ghost" className="h-7 w-7" title="Refresh discovery" onClick={() => void handleRefreshDiscovery(idp)}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openEdit(idp)}>Edit</Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => void handleDelete(idp)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
