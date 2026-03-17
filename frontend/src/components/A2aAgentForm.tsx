import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { testA2aConnection } from "@/api/a2a";
import type { A2aAgentCreateRequest, TestConnectionResult } from "@/api/types";

interface A2aAgentFormProps {
  onSubmit: (data: A2aAgentCreateRequest) => Promise<void>;
  onCancel: () => void;
  initialData?: Partial<A2aAgentCreateRequest> & { id?: number };
}

export function A2aAgentForm({ onSubmit, onCancel, initialData }: A2aAgentFormProps) {
  const [baseUrl, setBaseUrl] = useState(initialData?.base_url ?? "");
  const [authType, setAuthType] = useState<"none" | "oauth2">(initialData?.auth_type ?? "none");
  const [wellKnownUrl, setWellKnownUrl] = useState(initialData?.oauth2_well_known_url ?? "");
  const [clientId, setClientId] = useState(initialData?.oauth2_client_id ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [scopes, setScopes] = useState(initialData?.oauth2_scopes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);

  const handleSubmit = async () => {
    if (!baseUrl.trim()) return;
    setSubmitting(true);
    try {
      const request: A2aAgentCreateRequest = {
        base_url: baseUrl.trim(),
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
      const result = await testA2aConnection(initialData.id);
      setTestResult(result);
    } catch (e) {
      setTestResult({ success: false, message: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground">Base URL *</label>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://recipe-agent.example.com"
        />
        <p className="text-[10px] text-muted-foreground mt-0.5">
          The Agent Card will be fetched from &lt;base_url&gt;/.well-known/agent.json
        </p>
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
            <div>
              <label className="text-xs text-muted-foreground">Well-Known URL</label>
              <Input
                value={wellKnownUrl}
                onChange={(e) => setWellKnownUrl(e.target.value)}
                placeholder="https://auth.example.com/.well-known/openid-configuration"
              />
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
        <Button size="sm" className="min-w-[120px]" onClick={handleSubmit} disabled={submitting || !baseUrl.trim()}>
          {submitting ? (initialData?.id ? "Updating..." : "Registering...") : (initialData?.id ? "Update" : "Register")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
