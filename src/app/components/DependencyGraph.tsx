"use client";

import { useMemo } from "react";
import type { Step, StepStatus } from "@/lib/plan/types";
import { layoutGraph, type GraphNode } from "@/lib/plan/graph";

/** Status → stroke colour (chosen to read on both light and dark backgrounds). */
const STATUS_COLOR: Record<StepStatus, string> = {
  done: "#10b981",
  in_progress: "#f59e0b",
  blocked: "#ef4444",
  todo: "#a1a1aa",
};
const READY_COLOR = "#6366f1";
const CRIT_COLOR = "#6366f1";

function nodeStroke(n: GraphNode): string {
  if (n.step.status === "todo" && n.ready) return READY_COLOR;
  return STATUS_COLOR[n.step.status];
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/**
 * Deterministic dependency DAG: steps as nodes (coloured by status), `needs:`
 * as edges, laid out left→right by dependency depth. The critical path and
 * ready-to-start steps are highlighted. No LLM — this renders instantly and
 * exactly, which is the point for a fast senior-engineer scan.
 */
export function DependencyGraph({ steps }: { steps: Step[] }) {
  const g = useMemo(() => layoutGraph(steps), [steps]);
  const pos = useMemo(() => {
    const m = new Map<number, GraphNode>();
    for (const n of g.nodes) m.set(n.step.number, n);
    return m;
  }, [g.nodes]);

  if (steps.length === 0) return null;

  const edgePath = (fromX: number, fromY: number, toX: number, toY: number) => {
    const dx = Math.max(40, (toX - fromX) / 2);
    return `M ${fromX} ${fromY} C ${fromX + dx} ${fromY}, ${toX - dx} ${toY}, ${toX} ${toY}`;
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <svg
        width={g.width}
        height={g.height}
        viewBox={`0 0 ${g.width} ${g.height}`}
        className="text-zinc-700 dark:text-zinc-200"
        style={{ maxWidth: "none" }}
      >
        <defs>
          <marker
            id="arrow"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 z" fill="currentColor" opacity="0.5" />
          </marker>
          <marker
            id="arrow-crit"
            markerWidth="9"
            markerHeight="9"
            refX="7"
            refY="4.5"
            orient="auto"
          >
            <path d="M0,0 L9,4.5 L0,9 z" fill={CRIT_COLOR} />
          </marker>
        </defs>

        {/* Edges under nodes. */}
        {g.edges.map((e, i) => {
          const from = pos.get(e.from);
          const to = pos.get(e.to);
          if (!from || !to) return null;
          const fx = from.x + from.w;
          const fy = from.y + from.h / 2;
          const tx = to.x;
          const ty = to.y + to.h / 2;
          const crit = e.onCriticalPath;
          return (
            <path
              key={i}
              d={edgePath(fx, fy, tx, ty)}
              fill="none"
              stroke={crit ? CRIT_COLOR : "currentColor"}
              strokeWidth={crit ? 2.2 : 1.3}
              strokeOpacity={crit ? 1 : e.pending ? 0.4 : 0.18}
              strokeDasharray={!crit && !e.pending ? "3 3" : undefined}
              markerEnd={crit ? "url(#arrow-crit)" : "url(#arrow)"}
            />
          );
        })}

        {/* Nodes. */}
        {g.nodes.map((n) => {
          const stroke = nodeStroke(n);
          const emphasize = n.onCriticalPath || n.step.status === "blocked";
          return (
            <g key={n.step.number}>
              <title>{`${n.step.number}. ${n.step.text}`}</title>
              <rect
                x={n.x}
                y={n.y}
                width={n.w}
                height={n.h}
                rx={8}
                fill={stroke}
                fillOpacity={n.step.status === "done" ? 0.14 : 0.07}
                stroke={stroke}
                strokeWidth={emphasize ? 2.4 : 1.4}
              />
              {/* status dot */}
              <circle cx={n.x + 12} cy={n.y + 15} r={4} fill={STATUS_COLOR[n.step.status]} />
              <text
                x={n.x + 24}
                y={n.y + 19}
                fontSize={12}
                fontWeight={700}
                fill="currentColor"
              >
                #{n.step.number}
                {n.step.status === "in_progress" ? " · WIP" : ""}
                {n.step.status === "blocked" ? " · BLOCKED" : ""}
              </text>
              {n.step.effort && (
                <text
                  x={n.x + n.w - 10}
                  y={n.y + 19}
                  fontSize={11}
                  fontWeight={700}
                  textAnchor="end"
                  fill={stroke}
                >
                  {n.step.effort}
                </text>
              )}
              <text
                x={n.x + 12}
                y={n.y + 38}
                fontSize={11.5}
                fill="currentColor"
                opacity={n.step.status === "done" ? 0.55 : 0.9}
              >
                {truncate(n.step.text, 27)}
              </text>
              {n.ready && (
                <text
                  x={n.x + n.w - 10}
                  y={n.y + n.h - 8}
                  fontSize={9}
                  fontWeight={700}
                  textAnchor="end"
                  fill={READY_COLOR}
                >
                  READY
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
