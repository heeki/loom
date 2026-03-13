import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTimezone } from "@/contexts/TimezoneContext";
import { formatTimestamp } from "@/lib/format";
import {
  listTagPolicies,
  listTagProfiles,
  createTagProfile,
  updateTagProfile,
  deleteTagProfile,
} from "@/api/settings";
import type { TagPolicy, TagProfile } from "@/api/types";

interface SettingsPageProps {
  readOnly?: boolean;
}

export function SettingsPage({ readOnly }: SettingsPageProps) {
  const { timezone } = useTimezone();
  const [tagPolicies, setTagPolicies] = useState<TagPolicy[]>([]);
  const [profiles, setProfiles] = useState<TagProfile[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formName, setFormName] = useState("");
  const [formTags, setFormTags] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [policies, profs] = await Promise.all([listTagPolicies(), listTagProfiles()]);
      setTagPolicies(policies);
      setProfiles(profs);
    } catch {
      toast.error("Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const buildTimePolicies = tagPolicies.filter((tp) => tp.source === "build-time");

  const resetForm = () => {
    setFormName("");
    setFormTags({});
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (profile: TagProfile) => {
    setEditingId(profile.id);
    setFormName(profile.name);
    setFormTags({ ...profile.tags });
    setShowForm(true);
  };

  const startCreate = () => {
    resetForm();
    // Pre-populate with empty values for each build-time policy
    const initial: Record<string, string> = {};
    for (const tp of buildTimePolicies) {
      initial[tp.key] = tp.default_value || "";
    }
    setFormTags(initial);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!formName.trim()) return;
    setSubmitting(true);
    try {
      if (editingId) {
        await updateTagProfile(editingId, { name: formName.trim(), tags: formTags });
        toast.success("Tag profile updated");
      } else {
        await createTagProfile({ name: formName.trim(), tags: formTags });
        toast.success("Tag profile created");
      }
      resetForm();
      void fetchData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save tag profile");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    setSubmitting(true);
    try {
      await deleteTagProfile(id);
      setConfirmDeleteId(null);
      toast.success("Tag profile deleted");
      void fetchData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete tag profile");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">Settings</h2>
          <p className="text-sm text-muted-foreground">Manage tag profiles and other configuration.</p>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="text-sm text-muted-foreground">Manage tag profiles and other configuration.</p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">Tag Profiles</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Tag profiles are named sets of tag values applied to all resources deployed by Loom.
            </p>
          </div>
          {!readOnly && (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 ml-4"
              onClick={startCreate}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Profile
            </Button>
          )}
        </div>

        {showForm && (
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Profile Name *</label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Team Alpha - Production"
                  maxLength={128}
                  className="w-1/3"
                />
              </div>

              {buildTimePolicies.length > 0 && (
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground font-medium">Tag Values</label>
                  <div className="flex gap-3">
                    {buildTimePolicies.map((tp) => (
                      <div key={tp.key} className="flex-1 min-w-0 space-y-1">
                        <label className="text-xs text-muted-foreground">
                          {tp.key}
                          {tp.required && <span className="text-destructive"> *</span>}
                        </label>
                        <Input
                          placeholder={
                            tp.key === "loom:application"
                              ? "Identifier for the application"
                              : tp.key === "loom:group"
                                ? "Identifier for the group or team"
                                : tp.key === "loom:owner"
                                  ? "Identifier or email alias for the owner"
                                  : tp.default_value || `Enter ${tp.key}`
                          }
                          value={formTags[tp.key] || ""}
                          onChange={(e) =>
                            setFormTags((prev) => ({ ...prev, [tp.key]: e.target.value }))
                          }
                          maxLength={128}
                          className="text-sm"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  className="min-w-[100px]"
                  onClick={handleSubmit}
                  disabled={submitting || !formName.trim()}
                >
                  {submitting ? "Saving..." : editingId ? "Update" : "Create"}
                </Button>
                <Button size="sm" variant="ghost" onClick={resetForm}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {profiles.length === 0 && !showForm ? (
          <p className="text-sm text-muted-foreground py-8">
            No tag profiles yet. Create one to apply consistent tags across agents and memory resources.
          </p>
        ) : (
          <div className="space-y-2">
            {profiles.map((profile) => (
              <Card key={profile.id} className="py-3">
                <CardContent className="flex items-center justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{profile.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatTimestamp(profile.updated_at || profile.created_at, timezone)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(profile.tags).map(([key, value]) => (
                        <Badge
                          key={key}
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 font-normal"
                        >
                          {key.replace(/^loom:/, "")}: {value}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  {!readOnly && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => startEdit(profile)}
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {confirmDeleteId === profile.id ? (
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 text-xs"
                            onClick={() => handleDelete(profile.id)}
                            disabled={submitting}
                          >
                            Confirm
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => setConfirmDeleteId(profile.id)}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
