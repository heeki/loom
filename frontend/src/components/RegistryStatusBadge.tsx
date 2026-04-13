import { Badge } from "@/components/ui/badge";

type RegistryStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "DEPRECATED" | null;

function registryVariant(status: RegistryStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "APPROVED": return "default";
    case "PENDING_APPROVAL": return "secondary";
    case "REJECTED": return "destructive";
    case "DRAFT": return "outline";
    case "DEPRECATED": return "outline";
    default: return "outline";
  }
}

function registryLabel(status: RegistryStatus): string {
  switch (status) {
    case "PENDING_APPROVAL": return "Pending";
    case "APPROVED": return "Approved";
    case "REJECTED": return "Rejected";
    case "DRAFT": return "Draft";
    case "DEPRECATED": return "Deprecated";
    default: return "Unregistered";
  }
}

interface RegistryStatusBadgeProps {
  status: string | null;
  showUnregistered?: boolean;
}

export function RegistryStatusBadge({ status, showUnregistered = false }: RegistryStatusBadgeProps) {
  if (!status && !showUnregistered) return null;

  const variant = registryVariant(status as RegistryStatus);
  const label = registryLabel(status as RegistryStatus);

  return (
    <Badge variant={variant} className={`text-[10px] px-1.5 py-0 shrink-0${status === "DEPRECATED" ? " line-through" : ""}`}>
      {label}
    </Badge>
  );
}
