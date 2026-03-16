import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { testConnection } from "@/api/mcp";
import type { McpServerCreateRequest, TestConnectionResult } from "@/api/types";

interface McpServerFormProps {
  onSubmit: (data: McpServerCreateRequest) => Promise<void>;
  onCancel: () => void;
  initialData?: Partial<McpServerCreateRequest> & { id?: number };
}

export function McpServerForm({ onSubmit, onCancel, initialData }: McpServerFormProps) {
  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [endpointUrl, setEndpointUrl] = useState(initialData?.endpoint_url ?? "");
  const [transportType, setTransportType] = useState<"sse" | "streamable_http">(
    initialData?.transport_type ?? "sse",
  );
  const [authType, setAuthType] = useState<"none" | "oauth2">(initialData?.auth_type ?? "none");
  const [wellKnownUrl, setWellKnownUrl] = useState(initialData?.oauth2_well_known_url ?? "");
  const [clientId, setClientId] = useState(initialData?.oauth2_client_id ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [scopes, setScopes] = useState(initialData?.oauth2_scopes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);

  const handleSubmit = async () => {
    if (!name.trim() || !endpointUrl.trim()) return;
    setSubmitting(true);
    try {
      const request: McpServerCreateRequest = {
        name: name.trim(),
        description: description.trim() || undefined,
        endpoint_url: endpointUrl.trim(),
        transport_type: transportType,
        auth_type: authType,
      };
      if (authType === "oauth2") {
        if (wellKnownUrl.trim()) request.oauth2_well_known_url = wellKnownUrl.trim();
        if (clientId.trim()) request.oauth2_client_id = clientId.trim();
        if (clientSecret) request.oauth2_client_secret = clientSecret;
        if (scopes.trim()) request.oauth2_scopes = scopes.trim();
      }
      await onSubmit(request);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTest = async () => {
    if (!initialData?.id) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection(initialData.id);
      setTestResult(result);
    } catch (e) {
      setTestResult({ success: false, message: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <div className="w-1/3 min-w-0">
          <label className="text-xs text-muted-foreground">Name *</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Server name" />
        </div>
        <div className="flex-1 min-w-0">
          <label className="text-xs text-muted-foreground">Endpoint URL *</label>
          <Input
            value={endpointUrl}
            onChange={(e) => setEndpointUrl(e.target.value)}
            placeholder="https://example.com/mcp"
          />
        </div>
        <div className="w-[180px]">
          <label className="text-xs text-muted-foreground">Transport</label>
          <Select value={transportType} onValueChange={(v) => setTransportType(v as "sse" | "streamable_http")}>
            <SelectTrigger className="w-full text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sse">SSE</SelectItem>
              <SelectItem value="streamable_http">Streamable HTTP</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground">Description</label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          rows={2}
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs text-muted-foreground font-medium">Authentication</label>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="radio"
              checked={authType === "none"}
              onChange={() => setAuthType("none")}
              className="h-3.5 w-3.5"
            />
            None
          </label>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="radio"
              checked={authType === "oauth2"}
              onChange={() => setAuthType("oauth2")}
              className="h-3.5 w-3.5"
            />
            OAuth2
          </label>
        </div>

        {authType === "oauth2" && (
          <div className="space-y-2 pl-2 border-l-2 border-border ml-1">
            <div className="flex gap-3">
              <div className="flex-1 min-w-0">
                <label className="text-xs text-muted-foreground">Well-Known URL</label>
                <Input
                  value={wellKnownUrl}
                  onChange={(e) => setWellKnownUrl(e.target.value)}
                  placeholder="https://auth.example.com/.well-known/openid-configuration"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1 min-w-0">
                <label className="text-xs text-muted-foreground">Client ID</label>
                <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID" />
              </div>
              <div className="flex-1 min-w-0">
                <label className="text-xs text-muted-foreground">Client Secret</label>
                <Input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder={initialData?.id ? "(unchanged)" : "Client secret"}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Scopes</label>
              <Input value={scopes} onChange={(e) => setScopes(e.target.value)} placeholder="openid profile (space-separated)" />
            </div>
          </div>
        )}
      </div>

      {initialData?.id && (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                Testing...
              </>
            ) : (
              "Test Connection"
            )}
          </Button>
          {testResult && (
            <Badge variant={testResult.success ? "default" : "destructive"} className="text-xs">
              {testResult.message}
            </Badge>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 pt-2">
        <Button size="sm" className="min-w-[120px]" onClick={handleSubmit} disabled={submitting || !name.trim() || !endpointUrl.trim()}>
          {submitting ? (initialData?.id ? "Updating..." : "Creating...") : (initialData?.id ? "Update" : "Create")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
