import { useState } from "react";
import { AgentCard } from "@/components/AgentCard";
import { AgentRegistrationForm } from "@/components/AgentRegistrationForm";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import type { AgentResponse } from "@/api/types";

interface AgentListPageProps {
  agents: AgentResponse[];
  loading: boolean;
  onSelectAgent: (id: number) => void;
  onRegister: (arn: string) => Promise<unknown>;
  onRefresh: (id: number) => Promise<unknown>;
  onDelete: (id: number) => Promise<void>;
}

export function AgentListPage({
  agents,
  loading,
  onSelectAgent,
  onRegister,
  onRefresh,
  onDelete,
}: AgentListPageProps) {
  const [registering, setRegistering] = useState(false);

  const handleRegister = async (arn: string) => {
    setRegistering(true);
    try {
      await onRegister(arn);
      toast.success("Agent registered");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setRegistering(false);
    }
  };

  const handleRefresh = async (id: number) => {
    try {
      await onRefresh(id);
      toast.success("Agent refreshed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refresh failed");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await onDelete(id);
      toast.success("Agent removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div className="space-y-6">
      <AgentRegistrationForm onRegister={handleRegister} isLoading={registering} />

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          No agents registered. Add one above to get started.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onSelect={onSelectAgent}
              onRefresh={handleRefresh}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
