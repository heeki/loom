import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2, Lock } from "lucide-react";
import { toast } from "sonner";
import { useTimezone } from "@/contexts/TimezoneContext";
import { formatTimestamp } from "@/lib/format";
import {
  listTagPolicies,
  listTagProfiles,
  createTagPolicy,
  updateTagPolicy,
  deleteTagPolicy,
  createTagProfile,
  updateTagProfile,
  deleteTagProfile,
} from "@/api/settings";
import type { TagPolicy, TagProfile } from "@/api/types";

interface TaggingPageProps {
  readOnly?: boolean;
}

export function TaggingPage({ readOnly }: TaggingPageProps) {
  const { timezone } = useTimezone();
  const [tagPolicies, setTagPolicies] = useState<TagPolicy[]>([]);
  const [profiles, setProfiles] = useState<TagProfile[]>([]);
  const [loading, setLoading] = useState(true);

  // Profile form state
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<number | null>(null);
  const [profileFormName, setProfileFormName] = useState("");
  const [profileFormTags, setProfileFormTags] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [confirmDeleteProfileId, setConfirmDeleteProfileId] = useState<number | null>(null);

  // Policy form state
  const [showPolicyForm, setShowPolicyForm] = useState(false);
  const [editingPolicyId, setEditingPolicyId] = useState<number | null>(null);
  const [policyFormKey, setPolicyFormKey] = useState("");
  const [policyFormDefault, setPolicyFormDefault] = useState("");
  const [policyFormSource, setPolicyFormSource] = useState<"build-time" | "deploy-time">("build-time");
  const [policyFormShowOnCard, setPolicyFormShowOnCard] = useState(true);
  const [confirmDeletePolicyId, setConfirmDeletePolicyId] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [policies, profs] = await Promise.all([listTagPolicies(), listTagProfiles()]);
      setTagPolicies(policies);
      setProfiles(profs);
    } catch {
      toast.error("Failed to load tagging data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const platformPolicies = tagPolicies.filter((tp) => tp.key.startsWith("loom:"));
  const customPolicies = tagPolicies.filter((tp) => !tp.key.startsWith("loom:"));
  const buildTimePolicies = tagPolicies.filter((tp) => tp.source === "build-time");

  // --- Policy CRUD ---
  const resetPolicyForm = () => {
    setPolicyFormKey("");
    setPolicyFormDefault("");
    setPolicyFormSource("build-time");
    setPolicyFormShowOnCard(true);
    setEditingPolicyId(null);
    setShowPolicyForm(false);
  };

  const startEditPolicy = (policy: TagPolicy) => {
    setEditingPolicyId(policy.id);
    setPolicyFormKey(policy.key);
    setPolicyFormDefault(policy.default_value || "");
    setPolicyFormSource(policy.source);
    setPolicyFormShowOnCard(policy.show_on_card);
    setShowPolicyForm(true);
  };

  const handlePolicySubmit = async () => {
    if (!editingPolicyId && !policyFormKey.trim()) return;
    setSubmitting(true);
    try {
      if (editingPolicyId) {
        await updateTagPolicy(editingPolicyId, {
          default_value: policyFormDefault || undefined,
          source: policyFormSource,
          show_on_card: policyFormShowOnCard,
        });
        toast.success("Tag policy updated");
      } else {
        await createTagPolicy({
          key: policyFormKey.trim(),
          default_value: policyFormDefault || undefined,
          source: policyFormSource,
          show_on_card: policyFormShowOnCard,
        });
        toast.success("Tag policy created");
      }
      resetPolicyForm();
      void fetchData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save tag policy");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePolicyDelete = async (id: number) => {
    setSubmitting(true);
    try {
      await deleteTagPolicy(id);
      setConfirmDeletePolicyId(null);
      toast.success("Tag policy deleted");
      void fetchData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete tag policy");
    } finally {
      setSubmitting(false);
    }
  };

  // --- Profile CRUD ---
  const resetProfileForm = () => {
    setProfileFormName("");
    setProfileFormTags({});
    setEditingProfileId(null);
    setShowProfileForm(false);
  };

  const startEditProfile = (profile: TagProfile) => {
    setEditingProfileId(profile.id);
    setProfileFormName(profile.name);
    setProfileFormTags({ ...profile.tags });
    setShowProfileForm(true);
  };

  const startCreateProfile = () => {
    resetProfileForm();
    const initial: Record<string, string> = {};
    for (const tp of buildTimePolicies) {
      initial[tp.key] = tp.default_value || "";
    }
    setProfileFormTags(initial);
    setShowProfileForm(true);
  };

  const handleProfileSubmit = async () => {
    if (!profileFormName.trim()) return;
    setSubmitting(true);
    try {
      if (editingProfileId) {
        await updateTagProfile(editingProfileId, { name: profileFormName.trim(), tags: profileFormTags });
        toast.success("Tag profile updated");
      } else {
        await createTagProfile({ name: profileFormName.trim(), tags: profileFormTags });
        toast.success("Tag profile created");
      }
      resetProfileForm();
      void fetchData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save tag profile");
    } finally {
      setSubmitting(false);
    }
  };

  const handleProfileDelete = async (id: number) => {
    setSubmitting(true);
    try {
      await deleteTagProfile(id);
      setConfirmDeleteProfileId(null);
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
          <h2 className="text-lg font-semibold">Tagging</h2>
          <p className="text-sm text-muted-foreground">Manage tag policies and tag profiles.</p>
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
        <h2 className="text-lg font-semibold">Tagging</h2>
        <p className="text-sm text-muted-foreground">Manage tag policies and tag profiles.</p>
      </div>

      {/* Tag Policies Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">Tag Policies</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Tag policies define which tags are tracked across resources. Platform tags are required and read-only.
            </p>
          </div>
          {!readOnly && (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 ml-4"
              onClick={() => {
                resetPolicyForm();
                setShowPolicyForm(true);
              }}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Custom Tag
            </Button>
          )}
        </div>

        {showPolicyForm && (
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="flex gap-3">
                {editingPolicyId ? (
                  <div className="w-1/4 min-w-0 space-y-1">
                    <label className="text-xs text-muted-foreground">Key</label>
                    <Input value={policyFormKey} disabled className="text-sm" />
                  </div>
                ) : (
                  <div className="w-1/4 min-w-0 space-y-1">
                    <label className="text-xs text-muted-foreground">Key *</label>
                    <Input
                      value={policyFormKey}
                      onChange={(e) => setPolicyFormKey(e.target.value)}
                      placeholder="e.g. cost-center"
                      maxLength={128}
                      className="text-sm"
                    />
                  </div>
                )}
                <div className="w-1/4 min-w-0 space-y-1">
                  <label className="text-xs text-muted-foreground">Default Value</label>
                  <Input
                    value={policyFormDefault}
                    onChange={(e) => setPolicyFormDefault(e.target.value)}
                    placeholder="Optional default"
                    maxLength={128}
                    className="text-sm"
                  />
                </div>
                <div className="w-[140px] space-y-1">
                  <label className="text-xs text-muted-foreground">Source</label>
                  <Select value={policyFormSource} onValueChange={(v) => setPolicyFormSource(v as "build-time" | "deploy-time")}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="build-time">build-time</SelectItem>
                      <SelectItem value="deploy-time">deploy-time</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={policyFormShowOnCard}
                      onChange={(e) => setPolicyFormShowOnCard(e.target.checked)}
                      className="h-3.5 w-3.5"
                    />
                    Show on card
                  </label>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  className="min-w-[100px]"
                  onClick={handlePolicySubmit}
                  disabled={submitting || (!editingPolicyId && !policyFormKey.trim())}
                >
                  {submitting ? "Saving..." : editingPolicyId ? "Update" : "Create"}
                </Button>
                <Button size="sm" variant="ghost" onClick={resetPolicyForm}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="space-y-2">
          {platformPolicies.map((policy) => (
            <Card key={policy.id} className="py-3">
              <CardContent className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <div className="space-y-0.5 min-w-0">
                    <span className="text-sm font-medium">{policy.key}</span>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{policy.source}</span>
                      {policy.show_on_card && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">visible</Badge>}
                    </div>
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">platform</span>
              </CardContent>
            </Card>
          ))}
          {customPolicies.map((policy) => (
            <Card key={policy.id} className="py-3">
              <CardContent className="flex items-center justify-between gap-4">
                <div className="space-y-0.5 min-w-0">
                  <span className="text-sm font-medium">{policy.key}</span>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{policy.source}</span>
                    {policy.default_value && <span>default: {policy.default_value}</span>}
                    {policy.show_on_card && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">visible</Badge>}
                  </div>
                </div>
                {!readOnly && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => startEditPolicy(policy)}
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {confirmDeletePolicyId === policy.id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 text-xs"
                          onClick={() => handlePolicyDelete(policy.id)}
                          disabled={submitting}
                        >
                          Confirm
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => setConfirmDeletePolicyId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => setConfirmDeletePolicyId(policy.id)}
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
          {tagPolicies.length === 0 && !showPolicyForm && (
            <p className="text-sm text-muted-foreground py-4">No tag policies defined.</p>
          )}
        </div>
      </div>

      {/* Tag Profiles Section */}
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
              onClick={startCreateProfile}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Profile
            </Button>
          )}
        </div>

        {showProfileForm && (
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Profile Name *</label>
                <Input
                  value={profileFormName}
                  onChange={(e) => setProfileFormName(e.target.value)}
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
                          value={profileFormTags[tp.key] || ""}
                          onChange={(e) =>
                            setProfileFormTags((prev) => ({ ...prev, [tp.key]: e.target.value }))
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
                  onClick={handleProfileSubmit}
                  disabled={submitting || !profileFormName.trim()}
                >
                  {submitting ? "Saving..." : editingProfileId ? "Update" : "Create"}
                </Button>
                <Button size="sm" variant="ghost" onClick={resetProfileForm}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {profiles.length === 0 && !showProfileForm ? (
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
                        onClick={() => startEditProfile(profile)}
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {confirmDeleteProfileId === profile.id ? (
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 text-xs"
                            onClick={() => handleProfileDelete(profile.id)}
                            disabled={submitting}
                          >
                            Confirm
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => setConfirmDeleteProfileId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => setConfirmDeleteProfileId(profile.id)}
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
