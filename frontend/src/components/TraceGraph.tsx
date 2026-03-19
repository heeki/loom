import { useState, useMemo, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ChevronRight, ChevronDown, ZoomIn, RotateCcw } from "lucide-react";
import type { TraceDetailResponse, SpanDetail } from "@/api/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROW_HEIGHT = 28;
const LABEL_WIDTH = 240;
const INDENT_PX = 16;
const SPAN_COLORS: Record<string, string> = {
  invocation: "#3b82f6",
  model: "#22c55e",
  tool: "#f59e0b",
  other: "#8b5cf6",
  error: "#ef4444",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FlatSpan extends SpanDetail {
  depth: number;
  children: string[];
  visible: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function buildSpanTree(spans: SpanDetail[]): FlatSpan[] {
  const byId = new Map<string, FlatSpan>();
  const roots: FlatSpan[] = [];

  // First pass: create FlatSpan entries
  for (const s of spans) {
    byId.set(s.span_id, { ...s, depth: 0, children: [], visible: true });
  }

  // Second pass: wire parent-child
  for (const s of spans) {
    const flat = byId.get(s.span_id)!;
    if (s.parent_span_id && byId.has(s.parent_span_id)) {
      byId.get(s.parent_span_id)!.children.push(s.span_id);
    } else {
      roots.push(flat);
    }
  }

  // DFS to assign depth and produce ordered list
  const ordered: FlatSpan[] = [];
  function dfs(id: string, depth: number) {
    const span = byId.get(id);
    if (!span) return;
    span.depth = depth;
    ordered.push(span);
    for (const childId of span.children) {
      dfs(childId, depth + 1);
    }
  }

  for (const root of roots) {
    dfs(root.span_id, 0);
  }

  return ordered;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface SummaryMetricsProps {
  trace: TraceDetailResponse;
  spans: SpanDetail[];
}

function SummaryMetrics({ trace, spans }: SummaryMetricsProps) {
  const modelTime = spans
    .filter((s) => s.span_type === "model")
    .reduce((sum, s) => sum + s.duration_ms, 0);
  const toolTime = spans
    .filter((s) => s.span_type === "tool")
    .reduce((sum, s) => sum + s.duration_ms, 0);

  return (
    <div className="flex items-center gap-6 text-sm mb-3">
      <div>
        <span className="text-xs text-muted-foreground">Duration</span>
        <div className="font-mono text-sm">{formatDuration(trace.duration_ms)}</div>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">Spans</span>
        <div className="font-mono text-sm">{trace.span_count}</div>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">Model</span>
        <div className="font-mono text-sm" style={{ color: SPAN_COLORS.model }}>
          {formatDuration(modelTime)}
        </div>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">Tools</span>
        <div className="font-mono text-sm" style={{ color: SPAN_COLORS.tool }}>
          {formatDuration(toolTime)}
        </div>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">Status</span>
        <div>
          <Badge variant={trace.status === "error" ? "destructive" : "default"} className="text-[10px]">
            {trace.status.toUpperCase()}
          </Badge>
        </div>
      </div>
    </div>
  );
}

interface SpanDetailPanelProps {
  span: SpanDetail;
  onClose: () => void;
}

function SpanDetailPanel({ span, onClose }: SpanDetailPanelProps) {
  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">
            Span Details: {span.name}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          <div>
            <div className="text-xs text-muted-foreground">Span ID</div>
            <div className="font-mono text-xs">{span.span_id}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Parent Span ID</div>
            <div className="font-mono text-xs">{span.parent_span_id ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Type</div>
            <div>
              <Badge
                variant="outline"
                className="text-[10px]"
                style={{ borderColor: SPAN_COLORS[span.status === "error" ? "error" : span.span_type] }}
              >
                {span.span_type}
              </Badge>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Status</div>
            <Badge variant={span.status === "error" ? "destructive" : "default"} className="text-[10px]">
              {span.status.toUpperCase()}
            </Badge>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Start</div>
            <div className="font-mono text-xs">{span.start_time_iso}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">End</div>
            <div className="font-mono text-xs">{span.end_time_iso}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Duration</div>
            <div className="font-mono text-sm">{formatDuration(span.duration_ms)}</div>
          </div>
        </div>

        {Object.keys(span.attributes).length > 0 && (
          <>
            <Separator />
            <div>
              <div className="text-xs text-muted-foreground mb-1">Attributes</div>
              <div className="rounded-md border bg-background p-2 space-y-1">
                {Object.entries(span.attributes).map(([k, v]) => (
                  <div key={k} className="flex gap-2 text-xs">
                    <span className="font-mono text-muted-foreground shrink-0">{k}:</span>
                    <span className="font-mono break-all">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

interface TooltipState {
  x: number;
  y: number;
  span: FlatSpan;
}

function SpanTooltip({ x, y, span }: TooltipState) {
  return (
    <div
      className="fixed z-50 rounded-md border bg-popover px-3 py-2 text-xs shadow-md pointer-events-none"
      style={{ left: x + 12, top: y - 8 }}
    >
      <div className="font-medium">{span.name}</div>
      <div className="text-muted-foreground">{formatDuration(span.duration_ms)}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main TraceGraph component
// ---------------------------------------------------------------------------

interface TraceGraphProps {
  trace: TraceDetailResponse;
  loading?: boolean;
}

export function TraceGraph({ trace, loading }: TraceGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragCurrent, setDragCurrent] = useState<number | null>(null);

  const flatSpans = useMemo(() => buildSpanTree(trace.spans), [trace.spans]);

  // Filter visible spans (hide children of collapsed parents)
  const visibleSpans = useMemo(() => {
    const hidden = new Set<string>();
    function markHidden(parentId: string) {
      for (const s of flatSpans) {
        if (s.parent_span_id === parentId) {
          hidden.add(s.span_id);
          markHidden(s.span_id);
        }
      }
    }
    for (const id of collapsed) {
      markHidden(id);
    }
    return flatSpans.filter((s) => !hidden.has(s.span_id));
  }, [flatSpans, collapsed]);

  const selectedSpan = useMemo(
    () => trace.spans.find((s) => s.span_id === selectedSpanId) ?? null,
    [trace.spans, selectedSpanId],
  );

  // Time range for the view
  const traceStartMs = useMemo(() => {
    const root = flatSpans[0];
    return root ? new Date(root.start_time_iso).getTime() : 0;
  }, [flatSpans]);

  const traceDurationMs = trace.duration_ms || 1;

  const viewStart = zoomRange ? zoomRange[0] : 0;
  const viewEnd = zoomRange ? zoomRange[1] : traceDurationMs;
  const viewDuration = viewEnd - viewStart || 1;

  const toggleCollapse = useCallback((spanId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setDragStart(x);
      setDragCurrent(x);
    },
    [],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (dragStart !== null) {
        const rect = e.currentTarget.getBoundingClientRect();
        setDragCurrent(e.clientX - rect.left);
      }
    },
    [dragStart],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (dragStart !== null && dragCurrent !== null) {
        const rect = e.currentTarget.getBoundingClientRect();
        const svgWidth = rect.width;
        const minX = Math.min(dragStart, dragCurrent);
        const maxX = Math.max(dragStart, dragCurrent);

        // Only zoom if drag distance is significant
        if (maxX - minX > 10) {
          const startFrac = minX / svgWidth;
          const endFrac = maxX / svgWidth;
          const newStart = viewStart + startFrac * viewDuration;
          const newEnd = viewStart + endFrac * viewDuration;
          setZoomRange([newStart, newEnd]);
        }
      }
      setDragStart(null);
      setDragCurrent(null);
    },
    [dragStart, dragCurrent, viewStart, viewDuration],
  );

  const resetZoom = useCallback(() => setZoomRange(null), []);

  if (loading) {
    return <div className="text-sm text-muted-foreground py-4">Loading trace detail...</div>;
  }

  const svgHeight = visibleSpans.length * ROW_HEIGHT + 30; // +30 for time axis

  return (
    <div ref={containerRef}>
      <div className="flex items-center justify-between mb-2">
        <SummaryMetrics trace={trace} spans={trace.spans} />
        <div className="flex items-center gap-2">
          {zoomRange && (
            <Button variant="outline" size="sm" onClick={resetZoom}>
              <RotateCcw className="h-3 w-3 mr-1" />
              Reset Zoom
            </Button>
          )}
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <ZoomIn className="h-3 w-3" />
            Click-drag to zoom
          </div>
        </div>
      </div>

      <div className="rounded-md border bg-background overflow-x-auto">
        <div className="flex" style={{ minWidth: LABEL_WIDTH + 400 }}>
          {/* Label column */}
          <div
            className="shrink-0 border-r bg-muted/30"
            style={{ width: LABEL_WIDTH }}
          >
            <div
              className="text-[10px] text-muted-foreground px-2 border-b flex items-center"
              style={{ height: 30 }}
            >
              Span
            </div>
            {visibleSpans.map((span) => {
              const hasChildren = span.children.length > 0;
              const isCollapsed = collapsed.has(span.span_id);
              const color =
                span.status === "error"
                  ? SPAN_COLORS.error
                  : SPAN_COLORS[span.span_type] ?? SPAN_COLORS.other;

              return (
                <div
                  key={span.span_id}
                  className={`flex items-center text-xs truncate px-2 border-b cursor-pointer hover:bg-muted/50 ${
                    selectedSpanId === span.span_id ? "bg-muted" : ""
                  }`}
                  style={{
                    height: ROW_HEIGHT,
                    paddingLeft: span.depth * INDENT_PX + 8,
                  }}
                  onClick={() => setSelectedSpanId(span.span_id)}
                >
                  {hasChildren ? (
                    <button
                      className="mr-1 p-0 text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapse(span.span_id);
                      }}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </button>
                  ) : (
                    <span className="w-4 mr-1" />
                  )}
                  <span
                    className="w-2 h-2 rounded-full shrink-0 mr-1.5"
                    style={{ backgroundColor: color }}
                  />
                  <span className="truncate">{span.name}</span>
                </div>
              );
            })}
          </div>

          {/* Timeline column */}
          <div className="flex-1 min-w-0">
            <svg
              width="100%"
              height={svgHeight}
              className="select-none"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={() => {
                setTooltip(null);
                if (dragStart !== null) {
                  setDragStart(null);
                  setDragCurrent(null);
                }
              }}
            >
              {/* Time axis */}
              <g>
                <line
                  x1="0"
                  y1={29}
                  x2="100%"
                  y2={29}
                  stroke="currentColor"
                  className="text-border"
                  strokeWidth={1}
                />
                {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
                  <text
                    key={frac}
                    x={`${frac * 100}%`}
                    y={20}
                    textAnchor={frac === 1 ? "end" : frac === 0 ? "start" : "middle"}
                    className="fill-muted-foreground"
                    fontSize={10}
                    fontFamily="monospace"
                  >
                    {formatDuration(viewStart + frac * viewDuration)}
                  </text>
                ))}
              </g>

              {/* Span bars */}
              {visibleSpans.map((span, i) => {
                const spanStart =
                  new Date(span.start_time_iso).getTime() - traceStartMs;
                const spanDuration = span.duration_ms;

                const xPct =
                  ((spanStart - viewStart) / viewDuration) * 100;
                const wPct = (spanDuration / viewDuration) * 100;

                const color =
                  span.status === "error"
                    ? SPAN_COLORS.error
                    : SPAN_COLORS[span.span_type] ?? SPAN_COLORS.other;

                const y = 30 + i * ROW_HEIGHT + 4;
                const barHeight = ROW_HEIGHT - 8;

                return (
                  <g key={span.span_id}>
                    {/* Row separator */}
                    <line
                      x1="0"
                      y1={30 + (i + 1) * ROW_HEIGHT}
                      x2="100%"
                      y2={30 + (i + 1) * ROW_HEIGHT}
                      stroke="currentColor"
                      className="text-border"
                      strokeWidth={0.5}
                      strokeOpacity={0.3}
                    />
                    {/* Span bar */}
                    <rect
                      x={`${Math.max(xPct, 0)}%`}
                      y={y}
                      width={`${Math.max(wPct, 0.3)}%`}
                      height={barHeight}
                      rx={3}
                      fill={color}
                      opacity={selectedSpanId === span.span_id ? 1 : 0.8}
                      className="cursor-pointer"
                      onClick={() => setSelectedSpanId(span.span_id)}
                      onMouseEnter={(e) =>
                        setTooltip({ x: e.clientX, y: e.clientY, span })
                      }
                      onMouseLeave={() => setTooltip(null)}
                    />
                    {/* Duration label on bar if wide enough */}
                    {wPct > 8 && (
                      <text
                        x={`${Math.max(xPct, 0) + wPct / 2}%`}
                        y={y + barHeight / 2 + 4}
                        textAnchor="middle"
                        fontSize={10}
                        fontFamily="monospace"
                        fill="white"
                        className="pointer-events-none"
                      >
                        {formatDuration(spanDuration)}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Drag selection overlay */}
              {dragStart !== null && dragCurrent !== null && (
                <rect
                  x={Math.min(dragStart, dragCurrent)}
                  y={0}
                  width={Math.abs(dragCurrent - dragStart)}
                  height={svgHeight}
                  fill="#3b82f6"
                  fillOpacity={0.1}
                  stroke="#3b82f6"
                  strokeWidth={1}
                  strokeDasharray="4 2"
                />
              )}
            </svg>
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && <SpanTooltip {...tooltip} />}

      {/* Span detail panel */}
      {selectedSpan && (
        <SpanDetailPanel
          span={selectedSpan}
          onClose={() => setSelectedSpanId(null)}
        />
      )}
    </div>
  );
}
