import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useTimezone } from "@/contexts/TimezoneContext";
import { formatTimestamp } from "@/lib/format";
import { getServerTools, refreshServerTools } from "@/api/mcp";
import type { McpTool } from "@/api/types";

interface McpToolListProps {
  serverId: number;
  readOnly?: boolean;
}

export function McpToolList({ serverId, readOnly }: McpToolListProps) {
  const { timezone } = useTimezone();
  const [tools, setTools] = useState<McpTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());

  const fetchTools = useCallback(async () => {
    try {
      const data = await getServerTools(serverId);
      setTools(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to fetch tools");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    void fetchTools();
  }, [fetchTools]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const data = await refreshServerTools(serverId);
      setTools(data);
      toast.success("Tools refreshed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to refresh tools");
    } finally {
      setRefreshing(false);
    }
  };

  const toggleExpand = (toolId: number) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  };

  const lastRefreshed = tools.length > 0
    ? tools.reduce((latest, t) => {
        if (!t.last_refreshed_at) return latest;
        if (!latest) return t.last_refreshed_at;
        return t.last_refreshed_at > latest ? t.last_refreshed_at : latest;
      }, null as string | null)
    : null;

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium">Tools ({tools.length})</h4>
          {lastRefreshed && (
            <span className="text-[10px] text-muted-foreground">
              Last refreshed: {formatTimestamp(lastRefreshed, timezone)}
            </span>
          )}
        </div>
        {!readOnly && (
          <Button size="sm" variant="outline" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
            )}
            Refresh Tools
          </Button>
        )}
      </div>

      {tools.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          No tools discovered. Click &apos;Refresh Tools&apos; to fetch from the MCP server.
        </p>
      ) : (
        <div className="space-y-2">
          {tools.map((tool) => (
            <Card key={tool.id} className="py-2 gap-0">
              <CardContent className="space-y-1 px-4 py-0">
                <div className="flex items-center gap-2">
                  {tool.input_schema && (
                    <button
                      type="button"
                      onClick={() => toggleExpand(tool.id)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {expandedTools.has(tool.id) ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                  <span className="text-sm font-medium">{tool.tool_name}</span>
                </div>
                {tool.description && (
                  <p className="text-xs text-muted-foreground">{tool.description}</p>
                )}
                {expandedTools.has(tool.id) && tool.input_schema && (
                  <pre className="text-[11px] bg-input-bg rounded border p-2 overflow-x-auto">
                    <code>{JSON.stringify(tool.input_schema, null, 2)}</code>
                  </pre>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
