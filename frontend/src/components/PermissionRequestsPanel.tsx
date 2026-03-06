import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePermissionRequests } from "@/hooks/useSecurity";
import { CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

export function PermissionRequestsPanel() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const { requests, loading, error, reviewRequest } = usePermissionRequests(statusFilter);
  const [denyingId, setDenyingId] = useState<number | null>(null);
  const [reviewerNotes, setReviewerNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleApprove = async (id: number) => {
    setSubmitting(true);
    try {
      await reviewRequest(id, { status: "approved" });
      toast.success("Request approved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to approve request");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeny = async (id: number) => {
    setSubmitting(true);
    try {
      await reviewRequest(id, { status: "denied", reviewer_notes: reviewerNotes || undefined });
      setDenyingId(null);
      setReviewerNotes("");
      toast.success("Request denied");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to deny request");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>;
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Permission Requests</h3>
        <Select value={statusFilter ?? "all"} onValueChange={(v) => setStatusFilter(v === "all" ? undefined : v)}>
          <SelectTrigger className="w-36 text-sm">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="denied">Denied</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {requests.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No permission requests.</p>
      ) : (
        <div className="space-y-2">
          {requests.map((req) => (
            <div key={req.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{req.role_name ?? `Role #${req.managed_role_id}`}</span>
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        req.status === "pending"
                          ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                          : req.status === "approved"
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                      }`}
                    >
                      {req.status}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium">Actions: </span>
                    <span className="font-mono">{req.requested_actions.join(", ")}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium">Resources: </span>
                    <span className="font-mono break-all">{req.requested_resources.join(", ")}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium">Justification: </span>
                    {req.justification}
                  </div>
                  {req.reviewer_notes && (
                    <div className="text-xs text-muted-foreground">
                      <span className="font-medium">Reviewer notes: </span>
                      {req.reviewer_notes}
                    </div>
                  )}
                </div>
                {req.status === "pending" && (
                  <div className="flex gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleApprove(req.id)}
                      disabled={submitting}
                      title="Approve"
                    >
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDenyingId(req.id)}
                      disabled={submitting}
                      title="Deny"
                    >
                      <XCircle className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                )}
              </div>
              {denyingId === req.id && (
                <div className="flex gap-2 items-center">
                  <Input
                    placeholder="Reviewer notes (optional)"
                    value={reviewerNotes}
                    onChange={(e) => setReviewerNotes(e.target.value)}
                    className="flex-1 text-sm"
                  />
                  <Button size="sm" variant="destructive" onClick={() => handleDeny(req.id)} disabled={submitting}>
                    Deny
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setDenyingId(null); setReviewerNotes(""); }}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
