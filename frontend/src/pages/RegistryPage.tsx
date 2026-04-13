import { useState, useEffect } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useTimezone } from "@/contexts/TimezoneContext";
import { formatTimestamp } from "@/lib/format";
import { useRegistry } from "@/hooks/useRegistry";
import { RegistryStatusBadge } from "@/components/RegistryStatusBadge";
import * as registryApi from "@/api/registry";
import type { RegistryRecordDetail } from "@/api/types";

interface RegistryPageProps {
  readOnly?: boolean;
  isEndUserRole?: boolean;
}

export function RegistryPage({ readOnly, isEndUserRole }: RegistryPageProps) {
  const { timezone } = useTimezone();
  const { records, loading, error, fetchRecords } = useRegistry();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<Record<string, unknown>> | null>(null);
  const [searching, setSearching] = useState(false);

  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [recordDetail, setRecordDetail] = useState<RegistryRecordDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Apply filters
  useEffect(() => {
    const params: { status?: string; descriptorType?: string } = {};
    if (statusFilter !== "all") params.status = statusFilter;
    if (typeFilter !== "all") params.descriptorType = typeFilter;
    // For end-user role, only show APPROVED records
    if (isEndUserRole) params.status = "APPROVED";
    void fetchRecords(params);
  }, [statusFilter, typeFilter, isEndUserRole, fetchRecords]);

  // Fetch detail when a record is selected
  useEffect(() => {
    if (!selectedRecordId) {
      setRecordDetail(null);
      return;
    }
    setLoadingDetail(true);
    registryApi.getRegistryRecord(selectedRecordId)
      .then(setRecordDetail)
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : "Failed to fetch record detail");
        setSelectedRecordId(null);
      })
      .finally(() => setLoadingDetail(false));
  }, [selectedRecordId]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const result = await registryApi.searchRegistry(searchQuery.trim());
      setSearchResults(result.results);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const handleApprove = async (recordId: string) => {
    try {
      await registryApi.approveRecord(recordId);
      toast.success("Record approved");
      void fetchRecords();
      if (selectedRecordId === recordId) setSelectedRecordId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Approve failed");
    }
  };

  const handleReject = async (recordId: string, reason: string) => {
    try {
      await registryApi.rejectRecord(recordId, reason);
      toast.success("Record rejected");
      void fetchRecords();
      if (selectedRecordId === recordId) setSelectedRecordId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reject failed");
    }
  };

  // Detail view
  if (selectedRecordId) {
    return (
      <div className="space-y-6">
        <div>
          <Button variant="ghost" size="sm" onClick={() => setSelectedRecordId(null)} className="mb-2">
            &larr; Back to registry
          </Button>
          {loadingDetail ? (
            <Skeleton className="h-64" />
          ) : recordDetail ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold">{recordDetail.name}</h2>
                <RegistryStatusBadge status={recordDetail.status} showUnregistered />
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {recordDetail.descriptor_type}
                </Badge>
              </div>
              {recordDetail.description && (
                <p className="text-sm text-muted-foreground">{recordDetail.description}</p>
              )}

              <div className="rounded border bg-input-bg p-3 space-y-0.5 text-xs text-muted-foreground">
                <div><span className="text-muted-foreground/70">Record ID:</span> {recordDetail.record_id}</div>
                {recordDetail.record_version && (
                  <div><span className="text-muted-foreground/70">Version:</span> {recordDetail.record_version}</div>
                )}
                {recordDetail.created_at && (
                  <div><span className="text-muted-foreground/70">Created:</span> {formatTimestamp(recordDetail.created_at, timezone)}</div>
                )}
                {recordDetail.updated_at && (
                  <div><span className="text-muted-foreground/70">Updated:</span> {formatTimestamp(recordDetail.updated_at, timezone)}</div>
                )}
              </div>

              {!readOnly && recordDetail.status === "PENDING_APPROVAL" && (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => void handleApprove(recordDetail.record_id)}>
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    onClick={() => {
                      const reason = prompt("Rejection reason:");
                      if (reason) void handleReject(recordDetail.record_id, reason);
                    }}
                  >
                    Reject
                  </Button>
                </div>
              )}

              <div>
                <h3 className="text-sm font-medium mb-2">Descriptors</h3>
                <pre className="rounded border bg-input-bg p-4 text-xs overflow-auto max-h-96">
                  {JSON.stringify(recordDetail.descriptors, null, 2)}
                </pre>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // List view
  const displayRecords = searchResults !== null
    ? records.filter((r) => searchResults.some((sr) => (sr as Record<string, unknown>).record_id === r.record_id))
    : records;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Agent Registry</h2>
        <p className="text-sm text-muted-foreground">
          Browse and manage registered MCP servers and A2A agents.
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {!isEndUserRole && (
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="PENDING_APPROVAL">Pending Approval</SelectItem>
              <SelectItem value="APPROVED">Approved</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
              <SelectItem value="DEPRECATED">Deprecated</SelectItem>
            </SelectContent>
          </Select>
        )}

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="mcp">MCP</SelectItem>
            <SelectItem value="a2a">A2A</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1 flex-1 max-w-sm">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleSearch(); }}
              placeholder="Search registry..."
              className="h-8 w-full rounded border bg-input-bg pl-7 pr-2 text-xs"
            />
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => void handleSearch()} disabled={searching}>
            {searching ? "..." : "Search"}
          </Button>
          {searchResults !== null && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => { setSearchResults(null); setSearchQuery(""); }}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : displayRecords.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8">
          {searchResults !== null ? "No matching records found." : "No registry records found."}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {displayRecords.map((record) => (
            <Card
              key={record.record_id}
              className="cursor-pointer transition-colors hover:bg-accent/50 py-3 gap-1"
              onClick={() => setSelectedRecordId(record.record_id)}
            >
              <CardHeader className="gap-1 pb-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="text-sm font-medium truncate" title={record.name}>
                      {record.name}
                    </div>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                      {record.descriptor_type}
                    </Badge>
                    <RegistryStatusBadge status={record.status} showUnregistered />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                <div className="rounded border bg-input-bg p-3 space-y-0.5">
                  {record.description && (
                    <div className="truncate" title={record.description}>
                      {record.description}
                    </div>
                  )}
                  {record.created_at && (
                    <div><span className="text-muted-foreground/70">Created:</span> {formatTimestamp(record.created_at, timezone)}</div>
                  )}
                  {record.updated_at && (
                    <div><span className="text-muted-foreground/70">Updated:</span> {formatTimestamp(record.updated_at, timezone)}</div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
