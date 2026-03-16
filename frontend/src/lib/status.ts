type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export function statusVariant(status: string | null): BadgeVariant {
  switch (status) {
    case "ACTIVE":
    case "READY":
      return "default";
    case "CREATING":
    case "UPDATING":
    case "DELETING":
      return "secondary";
    case "FAILED":
    case "CREATE_FAILED":
      return "destructive";
    default:
      return "outline";
  }
}

export function deploymentStatusVariant(status: string | null): BadgeVariant {
  switch (status) {
    case "deployed":
    case "READY":
      return "default";
    case "initializing":
    case "creating_credentials":
    case "creating_role":
    case "building_artifact":
    case "deploying":
    case "ENDPOINT_CREATING":
      return "secondary";
    case "failed":
      return "destructive";
    case "removing":
      return "outline";
    default:
      return "outline";
  }
}
