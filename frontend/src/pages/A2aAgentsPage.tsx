import { useState } from "react";
import { LayoutGrid, TableIcon, Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { useTimezone } from "@/contexts/TimezoneContext";
import { formatTimestamp } from "@/lib/format";
import { useA2aAgents } from "@/hooks/useA2aAgents";
import { A2aAgentForm } from "@/components/A2aAgentForm";
import { A2aAgentCardView } from "@/components/A2aAgentCardView";
import { A2aAccessControl } from "@/components/A2aAccessControl";
import { SortableCardGrid, SortButton, loadSortDirection, toggleSortDirection, saveSortDirection, type SortDirection } from "@/components/SortableCardGrid";
import { SortableTableHead, sortRows } from "@/components/SortableTableHead";
import type { A2aAgent, A2aAgentCreateRequest } from "@/api/types";

interface A2aAgentsPageProps {
  viewMode: "cards" | "table";
  onViewModeChange: (mode: "cards" | "table") => void;
  readOnly?: boolean;
}

export function A2aAgentsPage({ viewMode, onViewModeChange, readOnly }: A2aAgentsPageProps) {
  const { timezone } = useTimezone();
  const { agents, loading, createAgent, updateAgent, deleteAgent, refreshCard } = useA2aAgents();
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<"card" | "access">("card");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [editingAgent, setEditingAgent] = useState<A2aAgent | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [cardSortDir, setCardSortDir] = useState<SortDirection>(() => loadSortDirection("a2a-agents"));
  const [tableCol, setTableCol] = useState<string | null>("name");
  const [tableDir, setTableDir] = useState<SortDirection>("asc");

  const handleTableSort = (col: string) => {
    if (tableCol === col) {
      setTableDir(tableDir === "asc" ? "desc" : "asc");
    } else {
      setTableCol(col);
      setTableDir("asc");
    }
  };

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null;

  const handleCreate = async (data: A2aAgentCreateRequest) => {
    try {
      await createAgent(data);
      setShowAddForm(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to register agent");
    }
  };

  const handleUpdate = async (data: A2aAgentCreateRequest) => {
    if (!editingAgent) return;
    try {
      await updateAgent(editingAgent.id, data);
      setEditingAgent(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update agent");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteAgent(id);
      setConfirmingDeleteId(null);
      if (selectedAgentId === id) setSelectedAgentId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete agent");
    }
  };

  const handleRefresh = async () => {
    if (!selectedAgent) return;
    setRefreshing(true);
    try {
      await refreshCard(selectedAgent.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to refresh Agent Card");
    } finally {
      setRefreshing(false);
    }
  };

  // Detail view
  if (selectedAgent) {
    return (
      <div className="space-y-6">
        <div>
          <Button variant="ghost" size="sm" onClick={() => { setSelectedAgentId(null); setEditingAgent(null); }} className="mb-2">
            &larr; Back to agents
          </Button>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{selectedAgent.name}</h2>
            {!readOnly && (
              <button
                type="button"
                onClick={() => setEditingAgent(selectedAgent)}
                className="text-muted-foreground/50 hover:text-foreground transition-colors"
                title="Edit agent"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {selectedAgent.description && <p className="text-sm text-muted-foreground">{selectedAgent.description}</p>}
        </div>

        {editingAgent && (
          <Card>
            <CardContent className="pt-4">
              <A2aAgentForm
                onSubmit={handleUpdate}
                onCancel={() => setEditingAgent(null)}
                initialData={{
                  id: editingAgent.id,
                  name: editingAgent.name,
                  base_url: editingAgent.base_url,
                  auth_type: editingAgent.auth_type,
                  oauth2_well_known_url: editingAgent.oauth2_well_known_url ?? undefined,
                  oauth2_client_id: editingAgent.oauth2_client_id ?? undefined,
                  oauth2_scopes: editingAgent.oauth2_scopes ?? undefined,
                }}
              />
            </CardContent>
          </Card>
        )}

        <div className="flex rounded-md border text-sm w-fit" role="tablist">
          {(["card", "access"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={detailTab === tab}
              className={`px-4 py-1.5 transition-colors ${
                tab === "card" ? "rounded-l-md" : "rounded-r-md"
              } ${
                detailTab === tab
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              }`}
              onClick={() => setDetailTab(tab)}
            >
              {tab === "card" ? "Agent Card" : "Access"}
            </button>
          ))}
        </div>

        {detailTab === "card" && (
          <A2aAgentCardView agent={selectedAgent} onRefresh={handleRefresh} refreshing={refreshing} />
        )}
        {detailTab === "access" && <A2aAccessControl agentId={selectedAgent.id} readOnly={readOnly} />}
      </div>
    );
  }

  // List view
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">A2A Agent Administration</h2>
          <p className="text-sm text-muted-foreground">
            Register and manage Agent-to-Agent protocol integrations.
          </p>
        </div>
        <div className="flex rounded-md border text-sm shrink-0" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "cards"}
            className={`px-2 py-1 rounded-l-md transition-colors ${viewMode === "cards" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            onClick={() => onViewModeChange("cards")}
            title="Card view"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "table"}
            className={`px-2 py-1 rounded-r-md transition-colors ${viewMode === "table" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            onClick={() => onViewModeChange("table")}
            title="Table view"
          >
            <TableIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Agents</h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <SortButton direction={cardSortDir} onClick={() => setCardSortDir(toggleSortDirection("a2a-agents", cardSortDir))} />
          {!readOnly && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAddForm(!showAddForm)}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add A2A Agent
            </Button>
          )}
        </div>
      </div>

      {showAddForm && (
        <Card>
          <CardContent className="pt-4">
            <A2aAgentForm
              onSubmit={handleCreate}
              onCancel={() => setShowAddForm(false)}
            />
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8">
          No A2A agents registered yet. Add one above.
        </p>
      ) : viewMode === "cards" ? (
        <SortableCardGrid
          items={agents}
          getId={(a) => String(a.id)}
          getName={(a) => a.name}
          storageKey="a2a-agents"
          sortDirection={cardSortDir}
          onSortDirectionChange={(d) => { if (d) { setCardSortDir(d); saveSortDirection("a2a-agents", d); } }}
          renderItem={(agent) => (
            <Card
              className="relative cursor-pointer transition-colors hover:bg-accent/50 py-3 gap-1"
              onClick={() => setSelectedAgentId(agent.id)}
            >
              <CardHeader className="gap-1 pb-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="text-sm font-medium truncate" title={agent.name}>
                      {agent.name}
                    </div>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                      v{agent.agent_version}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!readOnly && (
                      <>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setEditingAgent(agent); setSelectedAgentId(agent.id); }}
                          className="text-muted-foreground/50 hover:text-foreground transition-colors"
                          title="Edit agent"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setConfirmingDeleteId(agent.id); }}
                          className="text-muted-foreground/50 hover:text-destructive transition-colors"
                          title="Delete agent"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <div className="rounded border bg-input-bg p-3 space-y-0.5">
                  <div className="truncate" title={agent.base_url}><span className="text-muted-foreground/70">URL:</span> {agent.base_url}</div>
                  {agent.provider_organization && (
                    <div><span className="text-muted-foreground/70">Provider:</span> {agent.provider_organization}</div>
                  )}
                  <div><span className="text-muted-foreground/70">Authentication:</span> {agent.auth_type === "oauth2" ? "OAuth2" : "None"}</div>
                  {agent.created_at && (
                    <div><span className="text-muted-foreground/70">Created:</span> {formatTimestamp(agent.created_at, timezone)}</div>
                  )}
                </div>
                {confirmingDeleteId === agent.id && (
                  <div
                    className="absolute inset-x-0 bottom-0 rounded-b-lg border-t bg-card px-4 py-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs"
                        onClick={() => setConfirmingDeleteId(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-6 text-xs"
                        onClick={() => void handleDelete(agent.id)}
                      >
                        Confirm
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        />
      ) : (
        <div className="rounded-md border overflow-hidden">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="bg-card hover:bg-card">
                <SortableTableHead column="name" activeColumn={tableCol} direction={tableDir} onSort={handleTableSort} className="w-[25%]">Name</SortableTableHead>
                <SortableTableHead column="url" activeColumn={tableCol} direction={tableDir} onSort={handleTableSort} className="w-[30%]">URL</SortableTableHead>
                <SortableTableHead column="version" activeColumn={tableCol} direction={tableDir} onSort={handleTableSort} className="w-[10%]">Version</SortableTableHead>
                <SortableTableHead column="provider" activeColumn={tableCol} direction={tableDir} onSort={handleTableSort} className="w-[15%]">Provider</SortableTableHead>
                <SortableTableHead column="auth" activeColumn={tableCol} direction={tableDir} onSort={handleTableSort} className="w-[10%]">Auth</SortableTableHead>
                <SortableTableHead column="created" activeColumn={tableCol} direction={tableDir} onSort={handleTableSort} className="w-[10%]">Created</SortableTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortRows(agents, tableCol, tableDir, {
                name: (a) => a.name,
                url: (a) => a.base_url,
                version: (a) => a.agent_version,
                provider: (a) => a.provider_organization ?? "",
                auth: (a) => a.auth_type,
                created: (a) => a.created_at ?? "",
              }).map((agent) => (
                <TableRow
                  key={agent.id}
                  className="bg-input-bg hover:bg-input-bg/80 cursor-pointer"
                  onClick={() => setSelectedAgentId(agent.id)}
                >
                  <TableCell className="font-medium text-sm">{agent.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground truncate">{agent.base_url}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{agent.agent_version}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{agent.provider_organization ?? "-"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{agent.auth_type === "oauth2" ? "OAuth2" : "None"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatTimestamp(agent.created_at, timezone)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
