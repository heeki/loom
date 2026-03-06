import type { PolicyDocument } from "@/api/types";

interface PolicyViewerProps {
  policy: PolicyDocument;
}

export function PolicyViewer({ policy }: PolicyViewerProps) {
  if (!policy.Statement || policy.Statement.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">No policy statements</p>
    );
  }

  return (
    <div className="space-y-2">
      {policy.Statement.map((stmt, i) => (
        <div
          key={stmt.Sid ?? i}
          className="rounded border p-3 text-xs space-y-1.5"
        >
          <div className="flex items-center gap-2">
            {stmt.Sid && (
              <span className="font-medium">{stmt.Sid}</span>
            )}
            <span
              className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                stmt.Effect === "Allow"
                  ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
              }`}
            >
              {stmt.Effect}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Actions: </span>
            <span className="font-mono">
              {Array.isArray(stmt.Action) ? stmt.Action.join(", ") : stmt.Action}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Resources: </span>
            <span className="font-mono break-all">
              {Array.isArray(stmt.Resource) ? stmt.Resource.join(", ") : stmt.Resource}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
