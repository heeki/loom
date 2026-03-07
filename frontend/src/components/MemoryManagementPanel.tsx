import { useState, useEffect, useCallback } from "react";
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
import { Plus, Loader2, RefreshCw, Eraser, Trash2, Lock } from "lucide-react";
import { toast } from "sonner";
import { useTimezone } from "@/contexts/TimezoneContext";
import { formatTimestamp } from "@/lib/format";
import { statusVariant } from "@/lib/status";
import { listMemories, createMemory, refreshMemory, deleteMemory } from "@/api/memories";
import { ApiError } from "@/api/client";
import type { MemoryResponse, MemoryStrategyRequest } from "@/api/types";

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

export function MemoryManagementPanel() {
  const { timezone } = useTimezone();
  const [memories, setMemories] = useState<MemoryResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formExpiryDays, setFormExpiryDays] = useState(7);
  const [formExpiryError, setFormExpiryError] = useState("");
  const [formRoleArn, setFormRoleArn] = useState("");
  const [formStrategies, setFormStrategies] = useState<StrategyFormState[]>([]);

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
  }, [fetchMemories]);

  const validateExpiry = (days: number) => {
    if (days < 3 || days > 365) {
      setFormExpiryError("Must be between 3 and 365 days");
    } else {
      setFormExpiryError("");
    }
  };

  const resetForm = () => {
    setFormName("");
    setFormDescription("");
    setFormExpiryDays(7);
    setFormExpiryError("");
    setFormRoleArn("");
    setFormStrategies([]);
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

      await createMemory({
        name: formName.trim(),
        description: formDescription.trim() || undefined,
        event_expiry_duration: formExpiryDays * 86400,
        memory_execution_role_arn: formRoleArn.trim() || undefined,
        memory_strategies: strategies,
      });
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

  const handleDelete = async (id: number) => {
    setSubmitting(true);
    try {
      await deleteMemory(id);
      setConfirmDeleteId(null);
      toast.success("Memory resource deleted");
      void fetchMemories();
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
          <p className="text-xs text-muted-foreground mt-1">
            Create and manage AgentCore Memory resources with configurable strategies.
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
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Memory
        </Button>
      </div>

      {showAddForm && (
        <Card>
          <CardContent className="pt-4 space-y-3">
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
            </div>
            <div className="flex gap-3">
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
                  max={365}
                />
                {formExpiryError && (
                  <p className="text-[10px] text-destructive mt-1">{formExpiryError}</p>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <label className="text-xs text-muted-foreground">Memory Execution Role ARN</label>
                <Input
                  value={formRoleArn}
                  onChange={(e) => setFormRoleArn(e.target.value)}
                  placeholder="arn:aws:iam::..."
                />
              </div>
            </div>

            {/* Strategies */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground font-medium">Strategies</label>
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={addStrategy}>
                  <Plus className="h-3 w-3 mr-1" />
                  Add Strategy
                </Button>
              </div>
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

            <div className="flex gap-2">
              <Button
                size="sm"
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
          </CardContent>
        </Card>
      )}

      {memories.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No memory resources yet. Add one above.
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Strategies</TableHead>
                <TableHead>Event Expiry</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {memories.map((mem) => (
                <TableRow key={mem.id} className="relative">
                  <TableCell className="font-medium text-sm">{mem.name}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={statusVariant(mem.status)} className="text-[10px] px-1.5 py-0">
                        {mem.status}
                      </Badge>
                      {isTransitional(mem.status) && (
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {strategiesCount(mem)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {Math.round(mem.event_expiry_duration / 86400)}d
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{mem.region}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatTimestamp(mem.created_at, timezone)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={() => handleRefresh(mem.id)}
                        disabled={refreshingId === mem.id}
                        title="Refresh"
                      >
                        {refreshingId === mem.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(mem.id);
                        }}
                        title="Delete"
                      >
                        <Eraser className="h-3 w-3" />
                      </Button>
                    </div>
                    {confirmDeleteId === mem.id && (
                      <div
                        className="absolute inset-x-0 bottom-0 rounded-b-lg border-t bg-card px-4 py-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-muted-foreground mr-auto">
                            Delete this memory resource?
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-xs"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-6 text-xs"
                            onClick={() => handleDelete(mem.id)}
                            disabled={submitting}
                          >
                            Confirm
                          </Button>
                        </div>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
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
