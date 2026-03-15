import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import * as settingsApi from "@/api/settings";
import type { TagPolicy, TagProfile } from "@/api/types";

const SESSION_KEY = "loom:selectedTagProfileId";

interface ResourceTagFieldsProps {
  onChange: (tags: Record<string, string>) => void;
  profileId?: string;
}

export function ResourceTagFields({ onChange, profileId: controlledProfileId }: ResourceTagFieldsProps) {
  const [tagPolicies, setTagPolicies] = useState<TagPolicy[]>([]);
  const [profiles, setProfiles] = useState<TagProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>(() => {
    return sessionStorage.getItem(SESSION_KEY) || "";
  });

  // Sync with controlled profileId from parent
  useEffect(() => {
    if (controlledProfileId !== undefined) {
      setSelectedProfileId(controlledProfileId);
      if (controlledProfileId) {
        sessionStorage.setItem(SESSION_KEY, controlledProfileId);
      } else {
        sessionStorage.removeItem(SESSION_KEY);
      }
    }
  }, [controlledProfileId]);

  useEffect(() => {
    void settingsApi.listTagPolicies().then(setTagPolicies).catch(() => {});
    void settingsApi.listTagProfiles().then(setProfiles).catch(() => {});
  }, []);

  // Resolve tags when profile or policies change
  useEffect(() => {
    const profile = profiles.find((p) => p.id.toString() === selectedProfileId);
    const resolved: Record<string, string> = {};

    for (const tp of tagPolicies) {
      const profileVal = profile?.tags[tp.key];
      if (profileVal) {
        resolved[tp.key] = profileVal;
      } else if (tp.required && tp.default_value) {
        // Only fall back to default for required policies;
        // custom/optional tags should only appear when the profile explicitly sets them
        resolved[tp.key] = tp.default_value;
      }
    }

    onChange(resolved);
  }, [selectedProfileId, profiles, tagPolicies]);

  const handleProfileChange = (value: string) => {
    const id = value === "__none__" ? "" : value;
    setSelectedProfileId(id);
    if (id) {
      sessionStorage.setItem(SESSION_KEY, id);
    } else {
      sessionStorage.removeItem(SESSION_KEY);
    }
  };

  const requiredPolicies = tagPolicies.filter((tp) => tp.required);
  if (requiredPolicies.length === 0 && profiles.length === 0) return null;

  const selectedProfile = profiles.find((p) => p.id.toString() === selectedProfileId);

  return (
    <section className="space-y-3">
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Resource Tags
      </h4>
      <div className="flex items-end gap-3">
        <div className="w-1/3 min-w-0 space-y-1">
          <label className="text-xs text-muted-foreground">Tag Profile</label>
          <Select value={selectedProfileId || "__none__"} onValueChange={handleProfileChange}>
            <SelectTrigger className="w-full text-sm">
              <SelectValue placeholder="Select a tag profile..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {profiles.map((p) => (
                <SelectItem key={p.id} value={p.id.toString()}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selectedProfile && tagPolicies.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pb-1">
            {tagPolicies.map((tp) => {
              const val = selectedProfile.tags[tp.key];
              if (!val) return null;
              return (
                <Badge key={tp.key} variant="outline" className="text-[10px] px-1.5 py-0.5 font-normal">
                  {tp.key.replace(/^loom:/, "")}: {val}
                </Badge>
              );
            })}
          </div>
        )}
      </div>
      {!selectedProfileId && requiredPolicies.some((tp) => tp.required) && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400">
          No tag profile selected. Required tags will use default values or &quot;missing&quot;.
        </p>
      )}
    </section>
  );
}
