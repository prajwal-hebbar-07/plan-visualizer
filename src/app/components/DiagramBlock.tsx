"use client";

import { useCallback, useEffect, useState } from "react";
import type { Diagram } from "@/lib/plan/types";
import { sanitizeSvg, streamNdjson } from "@/lib/stream";

/**
 * Renders one plan diagram as a clean technical SVG, generated automatically
 * on mount by MiniMax from the `[DIAGRAM PROMPT]`. The source ASCII stays
 * available as a toggle/fallback.
 */
export function DiagramBlock({
  diagram,
  planTitle,
}: {
  diagram: Diagram;
  planTitle: string;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  const [running, setRunning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAscii, setShowAscii] = useState(false);

  // Promise-chain (not async/await) so every setState lives inside a nested
  // callback — safe to invoke synchronously from an effect.
  const runVisualize = useCallback(() => {
    let acc = "";
    return streamNdjson(
      "/api/visualize",
      {
        mode: "diagram",
        prompt: diagram.prompt,
        ascii: diagram.ascii,
        planTitle,
      },
      (evt) => {
        if (evt.type === "content") {
          acc += evt.text;
          const partial = sanitizeSvg(acc);
          if (partial) setSvg(partial);
        }
      },
    )
      .then(() => {
        const final = sanitizeSvg(acc);
        if (!final) throw new Error("Model did not return an SVG.");
        setSvg(final);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setRunning(false));
  }, [diagram, planTitle]);

  // Auto-render once on mount — no button, the whole document is visualized.
  useEffect(() => {
    runVisualize();
  }, [runVisualize]);

  const redraw = useCallback(() => {
    setRunning(true);
    setError(null);
    setSvg(null);
    runVisualize();
  }, [runVisualize]);

  return (
    <figure className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800/70">
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
          Diagram
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowAscii((s) => !s)}
            className="rounded px-2 py-1 text-[11px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            {showAscii ? "Hide source" : "Source"}
          </button>
          <button
            onClick={redraw}
            disabled={running}
            className="rounded-md border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {running ? "Drawing…" : "Redraw"}
          </button>
        </div>
      </div>

      {svg && (
        <div
          className="diagram-svg fade-rise px-4 py-4 text-zinc-700 dark:text-zinc-200"
          // Sanitized in sanitizeSvg(): script/handlers/js-hrefs stripped.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}

      {showAscii && (
        <pre className="overflow-x-auto border-t border-zinc-100 px-4 py-3 font-mono text-xs leading-relaxed text-zinc-600 dark:border-zinc-800/70 dark:text-zinc-400">
          {diagram.ascii}
        </pre>
      )}

      {running && !svg && (
        <div className="px-4 py-6 text-xs text-zinc-400">
          <span className="animate-pulse">Rendering technical diagram…</span>
          <pre className="mt-3 overflow-x-auto font-mono text-[11px] leading-relaxed text-zinc-400 opacity-60">
            {diagram.ascii}
          </pre>
        </div>
      )}
      {error && (
        <p className="px-4 py-2 text-xs text-red-500">{error}</p>
      )}
    </figure>
  );
}
