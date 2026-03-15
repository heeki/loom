import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTimezone, type TimezonePreference } from "@/contexts/TimezoneContext";
import { useTheme, THEME_LABELS, isLightTheme, type Theme } from "@/contexts/ThemeContext";

export function SettingsPage() {
  const { timezone, setTimezone } = useTimezone();
  const { theme, setTheme } = useTheme();
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="text-sm text-muted-foreground">Manage display preferences.</p>
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
    </div>
  );
}
