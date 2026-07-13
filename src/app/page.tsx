"use client";

import { useCallback, useState } from "react";
import type { Plan } from "@/lib/plan/types";
import { FilePicker } from "./components/FilePicker";
import { PlanView } from "./components/PlanView";

export default function Home() {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Lazily read the remembered note author. Guarded for SSR; the author only
  // appears inside a comment form (mounted after interaction), so there is no
  // hydration mismatch from the client-only initial value.
  const [author, setAuthor] = useState<string>(() =>
    typeof window !== "undefined" ? (localStorage.getItem("pv:author") ?? "") : "",
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const onAuthorChange = useCallback((a: string) => {
    setAuthor(a);
    localStorage.setItem("pv:author", a);
  }, []);

  const load = useCallback((path: string) => {
    setLoading(true);
    setError(null);
    fetch(`/api/plan?path=${encodeURIComponent(path)}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Failed to load plan");
        setPlan(data.plan as Plan);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setPlan(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const onSelect = useCallback(
    (path: string) => {
      setSelectedPath(path);
      load(path);
    },
    [load],
  );

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {sidebarOpen && (
        <aside className="w-64 shrink-0 border-r border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/40">
          <FilePicker selectedPath={selectedPath} onSelect={onSelect} />
        </aside>
      )}

      <main className="relative flex-1 overflow-auto">
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-zinc-200 bg-white/80 px-4 py-2.5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
          <button
            onClick={() => setSidebarOpen((s) => !s)}
            className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title="Toggle file picker"
          >
            ☰
          </button>
          <span className="text-sm font-semibold tracking-tight">
            Plan Visualizer
          </span>
          {plan && (
            <span className="truncate font-mono text-xs text-zinc-400">
              {plan.name}
            </span>
          )}
        </div>

        {loading && (
          <p className="mx-auto max-w-3xl px-6 py-10 text-sm text-zinc-400">
            Loading plan…
          </p>
        )}
        {error && (
          <p className="mx-auto max-w-3xl px-6 py-10 text-sm text-red-500">
            {error}
          </p>
        )}
        {!plan && !loading && !error && <EmptyState />}
        {plan && !loading && (
          <PlanView
            key={plan.path}
            plan={plan}
            author={author}
            onAuthorChange={onAuthorChange}
            onPlanUpdate={setPlan}
          />
        )}
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-32 text-center">
      <div className="text-4xl">🗺️</div>
      <h1 className="text-xl font-semibold">Pick a plan to visualize</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Choose a <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">.md</code>{" "}
        plan from the sidebar. It renders as an interactive page — visualize its
        diagrams with MiniMax, and leave inline notes that get written straight
        back into the file.
      </p>
    </div>
  );
}
