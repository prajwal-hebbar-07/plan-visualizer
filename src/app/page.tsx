"use client";

import { useCallback, useEffect, useState } from "react";

interface Health {
  ok: boolean;
  host: string;
  model: string;
  cloud: boolean;
  localModels?: string[];
  error?: string;
}

type StreamEvent =
  | { type: "thinking"; text: string }
  | { type: "content"; text: string }
  | { type: "done" }
  | { type: "error"; error: string };

async function fetchHealth(): Promise<Health> {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    return (await res.json()) as Health;
  } catch (e) {
    return {
      ok: false,
      host: "",
      model: "",
      cloud: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);

  const [prompt, setPrompt] = useState(
    "In one sentence, confirm you're reachable and name the model you are.",
  );
  const [thinking, setThinking] = useState("");
  const [answer, setAnswer] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showThinking, setShowThinking] = useState(true);

  const recheckHealth = useCallback(() => {
    setHealthLoading(true);
    fetchHealth().then((h) => {
      setHealth(h);
      setHealthLoading(false);
    });
  }, []);

  useEffect(() => {
    let active = true;
    fetchHealth().then((h) => {
      if (!active) return;
      setHealth(h);
      setHealthLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (!prompt.trim() || running) return;
    setRunning(true);
    setError(null);
    setThinking("");
    setAnswer("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
      });
      if (!res.ok || !res.body) {
        const msg = await res.text().catch(() => res.statusText);
        throw new Error(msg || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const evt = JSON.parse(line) as StreamEvent;
          if (evt.type === "thinking") setThinking((t) => t + evt.text);
          else if (evt.type === "content") setAnswer((a) => a + evt.text);
          else if (evt.type === "error") throw new Error(evt.error);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [prompt, running]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12 font-sans">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Plan Visualizer</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Scaffold · Next.js + Ollama Cloud (MiniMax) integration
        </p>
      </header>

      {/* Connection status */}
      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Ollama connection
          </h2>
          <button
            onClick={recheckHealth}
            disabled={healthLoading}
            className="rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            {healthLoading ? "Checking…" : "Recheck"}
          </button>
        </div>
        {health && (
          <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
            <dt className="text-zinc-500 dark:text-zinc-400">Status</dt>
            <dd className="flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  health.ok ? "bg-emerald-500" : "bg-red-500"
                }`}
              />
              {health.ok ? "Reachable" : "Unreachable"}
            </dd>
            <dt className="text-zinc-500 dark:text-zinc-400">Host</dt>
            <dd className="font-mono text-xs">{health.host || "—"}</dd>
            <dt className="text-zinc-500 dark:text-zinc-400">Model</dt>
            <dd className="flex items-center gap-2 font-mono text-xs">
              {health.model || "—"}
              {health.cloud && (
                <span className="rounded bg-indigo-100 px-1.5 py-0.5 font-sans text-[10px] font-medium uppercase tracking-wide text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                  cloud
                </span>
              )}
            </dd>
            {health.error && (
              <>
                <dt className="text-zinc-500 dark:text-zinc-400">Error</dt>
                <dd className="text-xs text-red-600 dark:text-red-400">
                  {health.error}
                </dd>
              </>
            )}
          </dl>
        )}
        {health && !health.ok && (
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            Is the daemon running? Start it with{" "}
            <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono dark:bg-zinc-800">
              ollama serve
            </code>
            . Cloud models also need{" "}
            <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono dark:bg-zinc-800">
              ollama signin
            </code>
            .
          </p>
        )}
      </section>

      {/* Model test box */}
      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Test the model
        </h2>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          Sanity check for the integration — sends your prompt to the model and
          streams the reply. Not a product feature.
        </p>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
          }}
          rows={3}
          className="w-full resize-y rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-sans text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-zinc-600"
          placeholder="Ask the model something…"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={run}
            disabled={running || !prompt.trim()}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {running ? "Streaming…" : "Send"}
          </button>
          <span className="text-xs text-zinc-400">⌘/Ctrl + Enter</span>
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 p-3 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </p>
        )}

        {thinking && (
          <div className="mt-4">
            <button
              onClick={() => setShowThinking((s) => !s)}
              className="text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              {showThinking ? "▾" : "▸"} Reasoning
            </button>
            {showThinking && (
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 font-mono text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                {thinking}
              </pre>
            )}
          </div>
        )}

        {answer && (
          <div className="mt-4">
            <div className="mb-1 text-xs text-zinc-500 dark:text-zinc-400">
              Response
            </div>
            <pre className="whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 font-sans text-sm dark:bg-zinc-900">
              {answer}
            </pre>
          </div>
        )}
      </section>
    </main>
  );
}
