import { AgentCard } from "@/components/AgentCard";
import { Skeleton } from "@/components/ui/skeleton";
import type { AgentResponse } from "@/api/types";

interface CatalogPageProps {
  agents: AgentResponse[];
  loading: boolean;
  onSelectAgent: (id: number) => void;
  onDelete: (id: number, cleanupAws: boolean) => void;
}

export function CatalogPage({
  agents,
  loading,
  onSelectAgent,
  onDelete,
}: CatalogPageProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Agent Catalog</h2>
        <p className="text-sm text-muted-foreground">Browse and manage registered agents.</p>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          No agents registered. Use the Builder page to register or deploy an agent.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onSelect={onSelectAgent}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
