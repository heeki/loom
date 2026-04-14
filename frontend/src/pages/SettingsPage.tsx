import { useEffect, useState, useCallback } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useTimezone, type TimezonePreference } from "@/contexts/TimezoneContext";
import { Button } from "@/components/ui/button";
import { listSiteSettings, updateSiteSetting, getRegistryConfig, updateRegistryConfig } from "@/api/settings";

export function SettingsPage() {
  const { timezone, setTimezone } = useTimezone();
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [cpuIdleDiscount, setCpuIdleDiscount] = useState("75");
  const [cpuIdleSaved, setCpuIdleSaved] = useState(false);

  const [registryArn, setRegistryArn] = useState("");
  const [registryId, setRegistryId] = useState("");
  const [registryEnabled, setRegistryEnabled] = useState(false);
  const [registrySaved, setRegistrySaved] = useState(false);
  const [registryError, setRegistryError] = useState("");
  const [confirmingDisable, setConfirmingDisable] = useState(false);

  const loadSiteSettings = useCallback(async () => {
    try {
      const settings = await listSiteSettings();
      const discount = settings.find((s) => s.key === "cpu_io_wait_discount");
      if (discount) setCpuIdleDiscount(discount.value);
    } catch {
      // ignore
    }
  }, []);

  const loadRegistryConfig = useCallback(async () => {
    try {
      const config = await getRegistryConfig();
      setRegistryArn(config.registry_arn);
      setRegistryId(config.registry_id);
      setRegistryEnabled(config.enabled);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { void loadSiteSettings(); }, [loadSiteSettings]);
  useEffect(() => { void loadRegistryConfig(); }, [loadRegistryConfig]);

  const saveRegistryConfig = async () => {
    setRegistryError("");
    try {
      const config = await updateRegistryConfig(registryArn);
      setRegistryId(config.registry_id);
      setRegistryEnabled(config.enabled);
      setRegistrySaved(true);
      setTimeout(() => setRegistrySaved(false), 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      setRegistryError(msg);
    }
  };

  const disableRegistry = async () => {
    setRegistryArn("");
    setRegistryError("");
    try {
      const config = await updateRegistryConfig("");
      setRegistryId(config.registry_id);
      setRegistryEnabled(config.enabled);
      setRegistrySaved(true);
      setTimeout(() => setRegistrySaved(false), 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to disable";
      setRegistryError(msg);
    }
  };

  const saveCpuIdleDiscount = async (value: string) => {
    const num = Math.max(0, Math.min(99, parseInt(value, 10) || 0));
    setCpuIdleDiscount(String(num));
    try {
      await updateSiteSetting("cpu_io_wait_discount", String(num));
      setCpuIdleSaved(true);
      setTimeout(() => setCpuIdleSaved(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="text-sm text-muted-foreground">Manage display and cost preferences.</p>
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium">Preferences</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Appearance and display settings.
          </p>
        </div>
        <div className="flex gap-4">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Timezone</label>
            <Select value={timezone} onValueChange={(v) => setTimezone(v as TimezonePreference)}>
              <SelectTrigger className="h-8 w-[200px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">{localTz}</SelectItem>
                <SelectItem value="UTC">UTC</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium">Cost Estimation</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Configure assumptions for runtime cost calculations.
          </p>
        </div>
        <div className="flex gap-4 items-end">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">CPU I/O Wait Discount (%)</label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={99}
                className="h-8 w-[100px] text-xs font-mono"
                value={cpuIdleDiscount}
                onChange={(e) => setCpuIdleDiscount(e.target.value)}
                onBlur={(e) => void saveCpuIdleDiscount(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void saveCpuIdleDiscount(cpuIdleDiscount); }}
              />
              {cpuIdleSaved && (
                <span className="text-xs text-green-600 dark:text-green-400">Saved</span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Assumed % of CPU time spent waiting on I/O (e.g., model API calls). Applied as a discount to runtime CPU cost across estimates and actuals. Range: 0–99.
            </p>
          </div>
        </div>
      </div>

      {/* Registry Configuration section */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium">Agent Registry</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Configure AWS Agent Registry for governance and discovery. When enabled, agents, MCP servers, and A2A agents must be approved in the registry before they can be used by end users.
          </p>
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Registry ARN</label>
            <div className="flex items-center gap-2">
              <Input
                type="text"
                className="h-8 w-[500px] text-xs font-mono"
                placeholder="arn:aws:bedrock-agentcore:us-east-1:123456789012:registry/loom-registry"
                value={registryArn}
                onChange={(e) => setRegistryArn(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void saveRegistryConfig(); }}
              />
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => void saveRegistryConfig()}>
                Save
              </Button>
              {registryEnabled && !confirmingDisable && (
                <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive" onClick={() => setConfirmingDisable(true)}>
                  Disable
                </Button>
              )}
              {confirmingDisable && (
                <>
                  <span className="text-xs text-destructive">Disable registry?</span>
                  <Button size="sm" variant="destructive" className="h-6 text-xs" onClick={() => { setConfirmingDisable(false); void disableRegistry(); }}>
                    Confirm
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setConfirmingDisable(false)}>
                    Cancel
                  </Button>
                </>
              )}
              {registrySaved && (
                <span className="text-xs text-green-600 dark:text-green-400">Saved</span>
              )}
            </div>
            {registryError && (
              <p className="text-xs text-destructive">{registryError}</p>
            )}
            <p className="text-[10px] text-muted-foreground">
              {registryEnabled
                ? `Registry enabled (ID: ${registryId}). Governance workflows are active.`
                : "No registry configured. All resources are available without registry approval."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
