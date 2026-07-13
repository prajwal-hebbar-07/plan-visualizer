import type { Effort, Step, StepStatus } from "./types";

/**
 * Deterministic dependency-graph layout + scheduling insights for a plan.
 *
 * Everything here is computed from the parsed `needs:` edges — no LLM. This is
 * the "read it in 20 seconds" view a senior engineer wants: what blocks what,
 * the critical path, what can start now, and how parallel the work is.
 */

const EFFORT_WEIGHT: Record<Effort, number> = { S: 1, M: 2, L: 3, XL: 5 };
const weightOf = (s: Step): number => (s.effort ? EFFORT_WEIGHT[s.effort] : 1);

export interface GraphNode {
  step: Step;
  /** Dependency depth (0 = no prerequisites). */
  layer: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** todo with every prerequisite already done → actionable right now. */
  ready: boolean;
  onCriticalPath: boolean;
}

export interface GraphEdge {
  from: number;
  to: number;
  onCriticalPath: boolean;
  /** A prerequisite that isn't done yet — the edge is still "live". */
  pending: boolean;
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
  layerCount: number;
  /** Widest dependency layer = most work that can run in parallel. */
  maxParallel: number;
  /** Step numbers on the longest (effort-weighted) path, in order. */
  criticalPath: number[];
}

export interface PlanInsights {
  total: number;
  done: number;
  inProgress: number;
  blocked: number;
  todo: number;
  /** Steps that can be picked up immediately. */
  readyNow: number[];
  /** Effort-weighted work not yet done. */
  effortRemaining: number;
  criticalPath: number[];
  criticalPathEffort: number;
  maxParallel: number;
}

// Layout geometry (SVG units).
const NODE_W = 190;
const NODE_H = 60;
const COL_GAP = 56;
const ROW_GAP = 20;
const PAD = 16;

/** Longest-path layering. Converges for DAGs; capped so cycles can't hang. */
function computeLayers(steps: Step[], byNum: Map<number, Step>): Map<number, number> {
  const layer = new Map<number, number>();
  for (const s of steps) layer.set(s.number, 0);
  const maxIter = steps.length + 1;
  for (let it = 0; it < maxIter; it++) {
    let changed = false;
    for (const s of steps) {
      let L = 0;
      for (const d of s.needs) {
        if (byNum.has(d)) L = Math.max(L, (layer.get(d) ?? 0) + 1);
      }
      if (L !== layer.get(s.number)) {
        layer.set(s.number, L);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return layer;
}

function isReady(s: Step, byNum: Map<number, Step>): boolean {
  if (s.status !== "todo") return false;
  return s.needs.every((d) => {
    const dep = byNum.get(d);
    return !dep || dep.status === "done";
  });
}

/** Longest effort-weighted path through the DAG (the schedule's critical path). */
function computeCriticalPath(
  steps: Step[],
  byNum: Map<number, Step>,
  layer: Map<number, number>,
): { path: number[]; effort: number } {
  const order = [...steps].sort(
    (a, b) => (layer.get(a.number) ?? 0) - (layer.get(b.number) ?? 0),
  );
  const best = new Map<number, number>(); // step → max weighted path ending here
  const prev = new Map<number, number | null>();
  let endNode: number | null = null;
  let endBest = -1;

  for (const s of order) {
    let bestDep = 0;
    let bestPrev: number | null = null;
    for (const d of s.needs) {
      if (!byNum.has(d)) continue;
      const cand = best.get(d) ?? 0;
      if (cand > bestDep) {
        bestDep = cand;
        bestPrev = d;
      }
    }
    const total = bestDep + weightOf(s);
    best.set(s.number, total);
    prev.set(s.number, bestPrev);
    if (total > endBest) {
      endBest = total;
      endNode = s.number;
    }
  }

  const path: number[] = [];
  let cur = endNode;
  while (cur != null) {
    path.unshift(cur);
    cur = prev.get(cur) ?? null;
  }
  return { path, effort: Math.max(endBest, 0) };
}

/** Build a full layered layout with positions, edges, and critical-path flags. */
export function layoutGraph(steps: Step[]): GraphLayout {
  const byNum = new Map(steps.map((s) => [s.number, s]));
  const layer = computeLayers(steps, byNum);
  const { path: criticalPath } = computeCriticalPath(steps, byNum, layer);
  const critical = new Set(criticalPath);

  // Bucket steps by layer, preserving step-number order within each column.
  const buckets = new Map<number, Step[]>();
  for (const s of steps) {
    const L = layer.get(s.number) ?? 0;
    (buckets.get(L) ?? buckets.set(L, []).get(L)!).push(s);
  }
  const layerCount = buckets.size;
  let maxParallel = 0;
  for (const arr of buckets.values()) maxParallel = Math.max(maxParallel, arr.length);

  const rowY = (row: number) => PAD + row * (NODE_H + ROW_GAP);
  const colX = (L: number) => PAD + L * (NODE_W + COL_GAP);

  const nodes: GraphNode[] = [];
  const posByNum = new Map<number, { x: number; y: number }>();
  for (const [L, arr] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    // Center each column vertically against the tallest one.
    const offset = ((maxParallel - arr.length) * (NODE_H + ROW_GAP)) / 2;
    arr
      .sort((a, b) => a.number - b.number)
      .forEach((s, row) => {
        const x = colX(L);
        const y = rowY(row) + offset;
        posByNum.set(s.number, { x, y });
        nodes.push({
          step: s,
          layer: L,
          x,
          y,
          w: NODE_W,
          h: NODE_H,
          ready: isReady(s, byNum),
          onCriticalPath: critical.has(s.number),
        });
      });
  }

  const edges: GraphEdge[] = [];
  for (const s of steps) {
    for (const d of s.needs) {
      if (!byNum.has(d)) continue;
      const onCp =
        critical.has(d) &&
        critical.has(s.number) &&
        Math.abs((criticalPath.indexOf(d) - criticalPath.indexOf(s.number))) === 1;
      edges.push({
        from: d,
        to: s.number,
        onCriticalPath: onCp,
        pending: byNum.get(d)!.status !== "done",
      });
    }
  }

  const width = PAD * 2 + layerCount * NODE_W + Math.max(0, layerCount - 1) * COL_GAP;
  const height = PAD * 2 + maxParallel * NODE_H + Math.max(0, maxParallel - 1) * ROW_GAP;

  return { nodes, edges, width, height, layerCount, maxParallel, criticalPath };
}

export function computeInsights(steps: Step[]): PlanInsights {
  const byNum = new Map(steps.map((s) => [s.number, s]));
  const counts: Record<StepStatus, number> = {
    done: 0,
    in_progress: 0,
    blocked: 0,
    todo: 0,
  };
  let effortRemaining = 0;
  const readyNow: number[] = [];
  for (const s of steps) {
    counts[s.status]++;
    if (s.status !== "done") effortRemaining += weightOf(s);
    if (isReady(s, byNum)) readyNow.push(s.number);
  }
  const layer = computeLayers(steps, byNum);
  const { path, effort } = computeCriticalPath(steps, byNum, layer);
  let maxParallel = 0;
  const bucket = new Map<number, number>();
  for (const s of steps) {
    const L = layer.get(s.number) ?? 0;
    bucket.set(L, (bucket.get(L) ?? 0) + 1);
  }
  for (const c of bucket.values()) maxParallel = Math.max(maxParallel, c);

  return {
    total: steps.length,
    done: counts.done,
    inProgress: counts.in_progress,
    blocked: counts.blocked,
    todo: counts.todo,
    readyNow,
    effortRemaining,
    criticalPath: path,
    criticalPathEffort: effort,
    maxParallel,
  };
}
