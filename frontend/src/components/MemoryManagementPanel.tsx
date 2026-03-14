import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelect } from "@/components/ui/multi-select";
import { AddFilterDropdown } from "@/components/ui/add-filter-dropdown";
import { Plus, Loader2, Trash2, Lock, X, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useTimezone } from "@/contexts/TimezoneContext";
import { formatTimestamp } from "@/lib/format";
import { statusVariant } from "@/lib/status";
import { listMemories, createMemory, importMemory, refreshMemory, deleteMemory, purgeMemory } from "@/api/memories";
import { listTagPolicies } from "@/api/settings";
import { ApiError } from "@/api/client";
import type { MemoryResponse, MemoryStrategyRequest, TagPolicy } from "@/api/types";
import { MemoryCard } from "./MemoryCard";
import { SortableCardGrid } from "./SortableCardGrid";
import { ResourceTagFields } from "./ResourceTagFields";

const STRATEGY_TYPES = [
  { value: "semantic", label: "Semantic" },
  { value: "summary", label: "Summary" },
  { value: "user_preference", label: "User Preference" },
  { value: "episodic", label: "Episodic" },
  { value: "custom", label: "Custom" },
] as const;

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

interface StrategyFormState {
  strategy_type: MemoryStrategyRequest["strategy_type"];
  name: string;
  description: string;
  namespaces: string[];
}

function emptyStrategy(): StrategyFormState {
  return { strategy_type: "semantic", name: "", description: "", namespaces: [] };
}

function mapErrorMessage(status: number, detail: string): string {
  switch (status) {
    case 400:
      return `Invalid request: ${detail}`;
    case 403:
      return "Access denied. Check your AWS permissions.";
    case 404:
      return "Memory resource not found.";
    case 409:
      return "A memory resource with this name already exists.";
    case 429:
      return "Rate limited. Please try again later.";
    case 502:
      return "AWS service error. Please try again.";
    default:
      return detail || "An unexpected error occurred.";
  }
}

function parseApiError(e: unknown): string {
  if (e instanceof ApiError) {
    return mapErrorMessage(e.status, e.detail);
  }
  if (e instanceof Error) {
    return e.message;
  }
  return "An unexpected error occurred.";
}

interface MemoryManagementPanelProps {
  viewMode: "cards" | "table";
  readOnly?: boolean;
}

export function MemoryManagementPanel({ viewMode, readOnly }: MemoryManagementPanelProps) {
  const { timezone } = useTimezone();
  const [memories, setMemories] = useState<MemoryResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addMode, setAddMode] = useState<"create" | "import">("create");
  const [submitting, setSubmitting] = useState(false);
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  // Elapsed timer: tick a `now` timestamp every second so elapsed = now - created_at
  const [now, setNow] = useState(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Track when deletes and creates were initiated for accurate elapsed timers
  const [deleteStartTimes, setDeleteStartTimes] = useState<Record<number, number>>({});
  const [creationStartTimes, setCreationStartTimes] = useState<Record<number, number>>({});

  // Create form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formExpiryDays, setFormExpiryDays] = useState(7);
  const [formExpiryError, setFormExpiryError] = useState("");
  const [formStrategies, setFormStrategies] = useState<StrategyFormState[]>([]);

  // Tag state
  const [tagValues, setTagValues] = useState<Record<string, string>>({});
  const [tagPolicies, setTagPolicies] = useState<TagPolicy[]>([]);
  const [tagFilters, setTagFilters] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem("loom:tagFilters:memories") || "{}") as Record<string, string[]>; } catch { return {}; }
  });

  // Import form state
  const [importMemoryId, setImportMemoryId] = useState("");

  const fetchMemories = useCallback(async () => {
    try {
      const data = await listMemories();
      setMemories(data);
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMemories();
    void listTagPolicies().then(setTagPolicies).catch(() => {});
  }, [fetchMemories]);

  // 1-second tick for elapsed display, 3-second poll for AWS status
  const memoriesRef = useRef(memories);
  memoriesRef.current = memories;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const elapsedFor = (mem: MemoryResponse): number => {
    const delStart = deleteStartTimes[mem.id];
    if (mem.status === "DELETING" && delStart) {
      return Math.max(0, Math.floor((now - delStart) / 1000));
    }
    const createStart = creationStartTimes[mem.id];
    if (mem.status === "CREATING" && createStart) {
      return Math.max(0, Math.floor((now - createStart) / 1000));
    }
    if (!mem.created_at) return 0;
    return Math.max(0, Math.floor((now - new Date(mem.created_at).getTime()) / 1000));
  };

  useEffect(() => {
    const hasTransitional = memories.some(
      (m) => m.status === "CREATING" || m.status === "DELETING",
    );

    if (!hasTransitional) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }

    // 1-second tick for elapsed display
    if (!timerRef.current) {
      timerRef.current = setInterval(() => {
        setNow(Date.now());
      }, 1000);
    }

    // 3-second poll for AWS status
    if (!pollRef.current) {
      pollRef.current = setInterval(async () => {
        const current = memoriesRef.current;
        const transitional = current.filter(
          (m) => m.status === "CREATING" || m.status === "DELETING",
        );
        for (const mem of transitional) {
          // Check for 10-minute creation timeout
          if (mem.status === "CREATING") {
            const startTime = creationStartTimes[mem.id];
            if (startTime && (Date.now() - startTime) > 600_000) {
              toast.error(`Memory "${mem.name}" creation timed out after 10 minutes`);
              setCreationStartTimes((prev) => {
                const next = { ...prev };
                delete next[mem.id];
                return next;
              });
              continue;
            }
          }
          try {
            const updated = await refreshMemory(mem.id);
            setMemories((prev) => prev.map((m) => (m.id === mem.id ? updated : m)));
          } catch (e) {
            // If a DELETING memory returns 404, it's gone from AWS — purge locally
            if (mem.status === "DELETING" && e instanceof ApiError && e.status === 404) {
              try {
                await purgeMemory(mem.id);
              } catch {
                // ignore cleanup errors
              }
              setMemories((prev) => prev.filter((m) => m.id !== mem.id));
              toast.success("Memory resource deleted");
            }
          }
        }
      }, 3000);
    }

    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [memories.map((m) => `${m.id}:${m.status}`).join(",")]);

  const validateExpiry = (days: number) => {
    if (days < 3 || days >= 365) {
      setFormExpiryError("Must be between 3 and 364 days");
    } else {
      setFormExpiryError("");
    }
  };

  const resetForm = () => {
    setFormName("");
    setFormDescription("");
    setFormExpiryDays(7);
    setFormExpiryError("");
    setFormStrategies([]);
    setImportMemoryId("");
  };

  const handleCreate = async () => {
    if (!formName.trim() || formExpiryError) return;
    setSubmitting(true);
    try {
      const strategies: MemoryStrategyRequest[] | undefined =
        formStrategies.length > 0
          ? formStrategies.map((s) => ({
              strategy_type: s.strategy_type,
              name: s.name,
              description: s.description || undefined,
              namespaces: s.namespaces.length > 0 ? s.namespaces : undefined,
            }))
          : undefined;

      const created = await createMemory({
        name: formName.trim(),
        description: formDescription.trim() || undefined,
        event_expiry_duration: formExpiryDays,
        memory_strategies: strategies,
        tags: Object.keys(tagValues).length > 0 ? tagValues : undefined,
      });
      if (created && created.id) {
        setCreationStartTimes((prev) => ({ ...prev, [created.id]: Date.now() }));
      }
      resetForm();
      setShowAddForm(false);
      toast.success("Memory resource created");
      void fetchMemories();
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleImport = async () => {
    if (!importMemoryId.trim()) return;
    setSubmitting(true);
    try {
      await importMemory(importMemoryId.trim());
      resetForm();
      setShowAddForm(false);
      toast.success("Memory resource imported");
      void fetchMemories();
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefresh = async (id: number) => {
    setRefreshingId(id);
    try {
      const updated = await refreshMemory(id);
      setMemories((prev) => prev.map((m) => (m.id === id ? updated : m)));
      toast.success("Memory status refreshed");
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setRefreshingId(null);
    }
  };

  const handleDelete = async (id: number, deleteInAws: boolean) => {
    setSubmitting(true);
    try {
      const updated = await deleteMemory(id, deleteInAws);
      if (updated.status === "DELETING") {
        // Async deletion — update local state so polling picks it up
        setDeleteStartTimes((prev) => ({ ...prev, [id]: Date.now() }));
        setMemories((prev) => prev.map((m) => (m.id === id ? updated : m)));
        toast.success("Memory deletion initiated");
      } else {
        // Immediately removed (local-only, FAILED state, or no AWS ID)
        setMemories((prev) => prev.filter((m) => m.id !== id));
        toast.success(deleteInAws ? "Memory resource deleted" : "Memory removed from Loom");
      }
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setSubmitting(false);
    }
  };

  const addStrategy = () => {
    setFormStrategies([...formStrategies, emptyStrategy()]);
  };

  const removeStrategy = (index: number) => {
    setFormStrategies(formStrategies.filter((_, i) => i !== index));
  };

  const updateStrategy = (index: number, updates: Partial<StrategyFormState>) => {
    setFormStrategies(formStrategies.map((s, i) => (i === index ? { ...s, ...updates } : s)));
  };

  const showOnCardPolicies = tagPolicies.filter(tp => tp.show_on_card);
  const showOnCardKeys = showOnCardPolicies.map(tp => tp.key);

  // R3: Progressive disclosure filtering
  const requiredPolicies = showOnCardPolicies.filter(tp => tp.required);
  const customFilterPolicies = showOnCardPolicies.filter(tp => !tp.required);
  const [activeCustomFilterKeys, setActiveCustomFilterKeys] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("loom:customFilterKeys:memories") || "[]") as string[]; } catch { return []; }
  });
  const activePolicies = [...requiredPolicies, ...customFilterPolicies.filter(p => activeCustomFilterKeys.includes(p.key))];

  // Persist filter state to localStorage
  useEffect(() => { localStorage.setItem("loom:tagFilters:memories", JSON.stringify(tagFilters)); }, [tagFilters]);
  useEffect(() => { localStorage.setItem("loom:customFilterKeys:memories", JSON.stringify(activeCustomFilterKeys)); }, [activeCustomFilterKeys]);

  // R4: Custom tag show/hide toggle
  const [showCustomTags, setShowCustomTags] = useState(() => localStorage.getItem("loom:showCustomTags") !== "false");
  const requiredKeySet = new Set(requiredPolicies.map(tp => tp.key));
  const effectiveShowOnCardKeys = showCustomTags ? showOnCardKeys : showOnCardKeys.filter(k => requiredKeySet.has(k));

  const filteredMemories = memories.filter(mem => {
    return Object.entries(tagFilters).every(([key, values]) => {
      if (values.length === 0) return true;
      return values.includes(mem.tags?.[key] ?? "");
    });
  });

  const isTransitional = (status: string) => status === "CREATING" || status === "DELETING";

  const strategiesCount = (mem: MemoryResponse): number => {
    if (Array.isArray(mem.strategies_config)) return mem.strategies_config.length;
    if (Array.isArray(mem.strategies_response)) return mem.strategies_response.length;
    return 0;
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Memory Resources</h3>
          <p className="text-xs text-muted-foreground mt-1 whitespace-pre-line">
            {"A memory resource is attached to an agent.\nBy default, it includes only short-term memory. If long-term memory is desired, add the appropriate strategy."}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 ml-4"
          onClick={() => {
            setShowAddForm(!showAddForm);
            resetForm();
          }}
          disabled={readOnly}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Memory
        </Button>
      </div>

      {showAddForm && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex rounded-md border text-sm w-fit" role="tablist">
              {(["create", "import"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={addMode === tab}
                  className={`px-4 py-1.5 transition-colors ${
                    tab === "create" ? "rounded-l-md" : "rounded-r-md"
                  } ${
                    addMode === tab
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent"
                  }`}
                  onClick={() => { setAddMode(tab); resetForm(); }}
                >
                  {tab === "create" ? "Create" : "Import"}
                </button>
              ))}
            </div>

            {addMode === "create" ? (
              <>
                <div className="flex gap-3">
                  <div className="w-1/3 min-w-0">
                    <label className="text-xs text-muted-foreground">Name *</label>
                    <Input
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="Memory resource name"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="text-xs text-muted-foreground">Description</label>
                    <Input
                      value={formDescription}
                      onChange={(e) => setFormDescription(e.target.value)}
                      placeholder="Optional description"
                    />
                  </div>
                  <div className="w-[160px]">
                    <label className="text-xs text-muted-foreground">Event Expiry (days)</label>
                    <Input
                      type="number"
                      value={formExpiryDays}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10) || 0;
                        setFormExpiryDays(v);
                        validateExpiry(v);
                      }}
                      min={3}
                      max={364}
                    />
                    {formExpiryError && (
                      <p className="text-[10px] text-destructive mt-1">{formExpiryError}</p>
                    )}
                  </div>
                </div>

                {/* Resource Tags */}
                <ResourceTagFields onChange={setTagValues} />

                {/* Long-Term Strategies */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-muted-foreground font-medium">Long-term Strategies</label>
                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={addStrategy}>
                      <Plus className="h-3 w-3 mr-1" />
                      Add Strategy
                    </Button>
                  </div>
                  {formStrategies.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">
                      No long-term strategies currently configured. As configured, only short-term memory will be used.
                    </p>
                  )}
                  {formStrategies.map((strategy, idx) => (
                    <div key={idx} className="rounded border border-dashed p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">Strategy {idx + 1}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={() => removeStrategy(idx)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="flex gap-3">
                        <div className="w-[30%] min-w-0">
                          <label className="text-xs text-muted-foreground">Name</label>
                          <Input
                            value={strategy.name}
                            onChange={(e) => updateStrategy(idx, { name: e.target.value })}
                            placeholder="Strategy name"
                          />
                        </div>
                        <div className="w-[15%] min-w-0">
                          <label className="text-xs text-muted-foreground">Type</label>
                          <Select
                            value={strategy.strategy_type}
                            onValueChange={(v) =>
                              updateStrategy(idx, {
                                strategy_type: v as MemoryStrategyRequest["strategy_type"],
                              })
                            }
                          >
                            <SelectTrigger className="w-full text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STRATEGY_TYPES.map((t) => (
                                <SelectItem key={t.value} value={t.value}>
                                  {t.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex-1 min-w-0">
                          <label className="text-xs text-muted-foreground">Description</label>
                          <Input
                            value={strategy.description}
                            onChange={(e) => updateStrategy(idx, { description: e.target.value })}
                            placeholder="Optional description"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">
                          Namespaces (press Enter to add)
                        </label>
                        <TagInput
                          values={strategy.namespaces}
                          onChange={(namespaces) => updateStrategy(idx, { namespaces })}
                          placeholder="e.g. user_preferences, conversation_history, task_context"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-1.5 pt-2">
                  <p className="text-[10px] text-muted-foreground italic">
                    Creation typically takes ~3 minutes
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="min-w-[120px]"
                      onClick={handleCreate}
                      disabled={submitting || !formName.trim() || !!formExpiryError}
                    >
                      {submitting ? "Creating..." : "Create"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setShowAddForm(false);
                        resetForm();
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex gap-3 items-end">
                  <div className="flex-1 min-w-0">
                    <label className="text-xs text-muted-foreground">AWS Memory ID *</label>
                    <Input
                      value={importMemoryId}
                      onChange={(e) => setImportMemoryId(e.target.value)}
                      placeholder="e.g. my_memory-zYcvlyGXsK"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="min-w-[120px]"
                    onClick={handleImport}
                    disabled={submitting || !importMemoryId.trim()}
                  >
                    {submitting ? "Importing..." : "Import"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowAddForm(false);
                      resetForm();
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tag Filters */}
      {showOnCardPolicies.length > 0 && memories.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          {activePolicies.map(tp => {
            const isCustom = !tp.required;
            const distinctValues = [...new Set(
              memories.map(m => m.tags?.[tp.key]).filter(Boolean)
            )] as string[];
            if (distinctValues.length === 0 && !isCustom) return null;
            return (
              <div key={tp.key} className="space-y-1">
                <div className="flex items-center gap-1">
                  <label className="text-[10px] text-muted-foreground">{tp.key.replace(/^loom:/, "")}</label>
                  {isCustom && (
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setActiveCustomFilterKeys(prev => prev.filter(k => k !== tp.key));
                        setTagFilters(prev => {
                          const next = { ...prev };
                          delete next[tp.key];
                          return next;
                        });
                      }}
                      title="Remove filter"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <MultiSelect
                  values={tagFilters[tp.key] ?? []}
                  options={distinctValues.sort()}
                  onChange={(v) => setTagFilters(prev => ({ ...prev, [tp.key]: v }))}
                />
              </div>
            );
          })}
          <div className="space-y-1">
            <label className="block text-[10px] text-muted-foreground">custom</label>
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-[2.25rem] p-0 bg-input-bg"
              onClick={() => {
                const next = !showCustomTags;
                setShowCustomTags(next);
                localStorage.setItem("loom:showCustomTags", String(next));
              }}
              title={showCustomTags ? "Hide custom tags" : "Show custom tags"}
            >
              {showCustomTags ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </Button>
          </div>
          {customFilterPolicies.filter(p => !activeCustomFilterKeys.includes(p.key)).length > 0 && (
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">custom filters</label>
              <AddFilterDropdown
                options={customFilterPolicies
                  .filter(p => !activeCustomFilterKeys.includes(p.key))
                  .map(p => ({ key: p.key, label: p.key }))}
                onSelect={(v) => setActiveCustomFilterKeys(prev => [...prev, v])}
              />
            </div>
          )}
          {(Object.values(tagFilters).some(v => v.length > 0) || activeCustomFilterKeys.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs self-end"
              onClick={() => { setTagFilters({}); setActiveCustomFilterKeys([]); }}
            >
              Clear filters
            </Button>
          )}
          <span className="text-xs text-muted-foreground ml-auto self-end">
            Showing {filteredMemories.length} of {memories.length} memories
          </span>
        </div>
      )}

      {filteredMemories.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8">
          {memories.length === 0
            ? "No memory resources yet. Add one above."
            : "No memories match the selected filters."}
        </p>
      ) : (
        <>
          {viewMode === "cards" ? (
            <SortableCardGrid
              items={filteredMemories}
              getId={(m) => String(m.id)}
              storageKey="memory-resources"
              renderItem={(mem) => (
                <MemoryCard
                  memory={mem}
                  now={now}
                  refreshingId={refreshingId}
                  submitting={submitting}
                  onRefresh={handleRefresh}
                  onDelete={handleDelete}
                  readOnly={readOnly}
                  showOnCardKeys={effectiveShowOnCardKeys}
                  deleteStartTime={deleteStartTimes[mem.id]}
                />
              )}
            />
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="bg-card hover:bg-card">
                    <TableHead className="w-[30%]">Name</TableHead>
                    <TableHead className="w-[12%]">Status</TableHead>
                    <TableHead className="w-[14%]">Strategies</TableHead>
                    <TableHead className="w-[14%]">Event Expiry</TableHead>
                    <TableHead className="w-[14%]">Region</TableHead>
                    <TableHead className="w-[16%]">Registered</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMemories.map((mem) => (
                    <TableRow key={mem.id} className="bg-input-bg hover:bg-input-bg/80">
                      <TableCell className="font-medium text-sm">{mem.name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge variant={statusVariant(mem.status)} className="text-[10px] px-1.5 py-0">
                            {mem.status}
                          </Badge>
                          {isTransitional(mem.status) && (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                              <span className="text-[10px] text-muted-foreground">
                                ({elapsedFor(mem)}s)
                              </span>
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {strategiesCount(mem)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {mem.event_expiry_duration}d
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{mem.region}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatTimestamp(mem.created_at, timezone)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      {/* Coming soon */}
      <section className="space-y-3 pt-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Additional Configuration</h4>
        <div className="space-y-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Lock className="h-3.5 w-3.5" />
            <span>Encryption Key ARN</span>
            <span className="text-[10px] italic">Coming soon</span>
          </div>
        </div>
      </section>
    </div>
  );
}
