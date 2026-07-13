import type { Effort, StepStatus } from "./types";

/** Presentational metadata for step statuses (client-safe, no node imports). */
export const STATUS_META: Record<
  StepStatus,
  { label: string; icon: string; dot: string; ring: string; text: string }
> = {
  todo: {
    label: "To do",
    icon: "○",
    dot: "bg-zinc-300 dark:bg-zinc-600",
    ring: "border-zinc-200 dark:border-zinc-800",
    text: "text-zinc-500 dark:text-zinc-400",
  },
  in_progress: {
    label: "In progress",
    icon: "◐",
    dot: "bg-amber-400",
    ring: "border-amber-300 dark:border-amber-500/40",
    text: "text-amber-600 dark:text-amber-400",
  },
  done: {
    label: "Done",
    icon: "●",
    dot: "bg-emerald-500",
    ring: "border-emerald-300 dark:border-emerald-500/40",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  blocked: {
    label: "Blocked",
    icon: "✕",
    dot: "bg-red-500",
    ring: "border-red-300 dark:border-red-500/40",
    text: "text-red-600 dark:text-red-400",
  },
};

export const EFFORT_META: Record<Effort, { label: string; cls: string }> = {
  S: { label: "S", cls: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" },
  M: { label: "M", cls: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" },
  L: { label: "L", cls: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300" },
  XL: { label: "XL", cls: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" },
};
