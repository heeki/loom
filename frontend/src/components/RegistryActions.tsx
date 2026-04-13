import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import * as registryApi from "@/api/registry";

interface RegistryActionsProps {
  resourceType: "mcp" | "a2a";
  resourceId: number;
  registryRecordId: string | null;
  registryStatus: string | null;
  onAction: () => void;  // callback to refresh parent data
}

export function RegistryActions({ resourceType, resourceId, registryRecordId, registryStatus, onAction }: RegistryActionsProps) {
  const [loading, setLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);

  const handleAction = async (action: () => Promise<void>, successMsg: string) => {
    setLoading(true);
    try {
      await action();
      toast.success(successMsg);
      onAction();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Registry action failed");
    } finally {
      setLoading(false);
    }
  };

  if (!registryRecordId && !registryStatus) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-6 text-xs"
        disabled={loading}
        onClick={(e) => {
          e.stopPropagation();
          handleAction(
            () => registryApi.createRegistryRecord({ resource_type: resourceType, resource_id: resourceId }).then(() => {}),
            "Registered in registry"
          );
        }}
      >
        Register
      </Button>
    );
  }

  if (registryStatus === "DRAFT" && registryRecordId) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-6 text-xs"
        disabled={loading}
        onClick={(e) => {
          e.stopPropagation();
          handleAction(() => registryApi.submitForApproval(registryRecordId), "Submitted for approval");
        }}
      >
        Submit for Approval
      </Button>
    );
  }

  if (registryStatus === "PENDING_APPROVAL" && registryRecordId) {
    return (
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-xs"
          disabled={loading}
          onClick={() => handleAction(() => registryApi.approveRecord(registryRecordId), "Record approved")}
        >
          Approve
        </Button>
        {!showRejectInput ? (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs text-destructive"
            disabled={loading}
            onClick={() => setShowRejectInput(true)}
          >
            Reject
          </Button>
        ) : (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason..."
              className="h-6 text-xs border rounded px-1.5 bg-input-bg w-32"
            />
            <Button
              size="sm"
              variant="destructive"
              className="h-6 text-xs"
              disabled={loading || !rejectReason.trim()}
              onClick={() => handleAction(() => registryApi.rejectRecord(registryRecordId, rejectReason.trim()), "Record rejected")}
            >
              Confirm
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs"
              onClick={() => { setShowRejectInput(false); setRejectReason(""); }}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (registryStatus === "APPROVED" && registryRecordId) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-6 text-xs"
        disabled={loading}
        onClick={(e) => {
          e.stopPropagation();
          handleAction(() => registryApi.rejectRecord(registryRecordId, "Deprecated").then(() => {}), "Record deprecated");
        }}
      >
        Deprecate
      </Button>
    );
  }

  if ((registryStatus === "REJECTED" || registryStatus === "DEPRECATED") && registryRecordId) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-6 text-xs"
        disabled={loading}
        onClick={(e) => {
          e.stopPropagation();
          handleAction(() => registryApi.deleteRegistryRecord(registryRecordId), "Removed from registry");
        }}
      >
        Remove from Registry
      </Button>
    );
  }

  return null;
}
