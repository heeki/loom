import { useEffect, useState, useCallback } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useTimezone, type TimezonePreference } from "@/contexts/TimezoneContext";
import { useTheme, THEME_LABELS, isLightTheme, type Theme } from "@/contexts/ThemeContext";
import { listSiteSettings, updateSiteSetting } from "@/api/settings";

export function SettingsPage() {
  const { timezone, setTimezone } = useTimezone();
  const { theme, setTheme } = useTheme();
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [cpuIdleDiscount, setCpuIdleDiscount] = useState("75");
  const [cpuIdleSaved, setCpuIdleSaved] = useState(false);

  const loadSiteSettings = useCallback(async () => {
    try {
      const settings = await listSiteSettings();
      const discount = settings.find((s) => s.key === "cpu_io_wait_discount");
      if (discount) setCpuIdleDiscount(discount.value);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { void loadSiteSettings(); }, [loadSiteSettings]);

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
            <label className="text-xs text-muted-foreground">Theme</label>
            <Select value={theme} onValueChange={(v) => setTheme(v as Theme)}>
              <SelectTrigger className="h-8 w-[200px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" side="bottom" sideOffset={4}>
                <SelectGroup>
                  <SelectLabel>Light</SelectLabel>
                  {(Object.entries(THEME_LABELS) as [Theme, string][])
                    .filter(([value]) => isLightTheme(value))
                    .map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Dark</SelectLabel>
                  {(Object.entries(THEME_LABELS) as [Theme, string][])
                    .filter(([value]) => !isLightTheme(value))
                    .map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
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
              Assumed % of CPU time spent waiting on I/O, e.g., model API calls. Applied as a discount to estimated runtime CPU cost. Range: 0–99.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
