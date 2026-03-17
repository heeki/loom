import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, ExternalLink } from "lucide-react";
import { useTimezone } from "@/contexts/TimezoneContext";
import { formatTimestamp } from "@/lib/format";
import { A2aSkillList } from "./A2aSkillList";
import type { A2aAgent } from "@/api/types";

interface A2aAgentCardViewProps {
  agent: A2aAgent;
  onRefresh: () => Promise<void>;
  refreshing: boolean;
}

export function A2aAgentCardView({ agent, onRefresh, refreshing }: A2aAgentCardViewProps) {
  const { timezone } = useTimezone();

  return (
    <div className="rounded border bg-input-bg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 min-w-0">
        <h3 className="text-sm font-semibold truncate">{agent.name}</h3>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
          v{agent.agent_version}
        </Badge>
        <Badge
          variant={agent.status === "active" ? "default" : "secondary"}
          className="text-[10px] px-1.5 py-0 shrink-0"
        >
          {agent.status}
        </Badge>
        {agent.last_fetched_at && (
          <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
            Fetched: {formatTimestamp(agent.last_fetched_at, timezone)}
          </span>
        )}
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={refreshing}
          className={`text-muted-foreground/50 hover:text-foreground transition-colors shrink-0${!agent.last_fetched_at ? " ml-auto" : ""}`}
          title="Refresh Agent Card"
        >
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Description */}
      <p className="text-xs text-muted-foreground">{agent.description}</p>

      {/* Provider & Documentation */}
      {agent.provider_organization && (
        <div className="text-xs text-muted-foreground">
          <span className="text-muted-foreground/70">Provider:</span> {agent.provider_organization}
          {agent.provider_url && (
            <a
              href={agent.provider_url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 inline-flex items-center gap-0.5 hover:text-foreground"
            >
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </div>
      )}
      {agent.documentation_url && (
        <div className="text-xs">
          <a
            href={agent.documentation_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            Documentation <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
      )}

      {/* Authentication Schemes */}
      {agent.authentication_schemes.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-xs font-medium text-muted-foreground">Authentication Schemes</h4>
          <div className="flex flex-wrap gap-1.5">
            {agent.authentication_schemes.map((scheme) => (
              <Badge key={scheme} variant="outline" className="text-[10px] px-1.5 py-0">
                {scheme}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Skills */}
      <A2aSkillList agentId={agent.id} />
    </div>
  );
}
