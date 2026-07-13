"use client";

import type {
  DataContract,
  Feature,
  FlowAnalysis,
  FlowHop,
  HopActor,
  PlanDecision,
} from "@/lib/plan/types";

/**
 * The centerpiece: a full-stack data-flow trace. For each feature the plan
 * builds, it walks the request/action through the stack hop by hop and shows
 * the concrete data contract (typed schema) at every boundary — the way a
 * senior engineer scrutinises a feature ("what's the payload? the API does
 * what? what's the response shape? how does the frontend apply it?").
 */

const ACTOR_META: Record<HopActor, { label: string; cls: string; dot: string }> = {
  user: { label: "USER", cls: "text-zinc-600 dark:text-zinc-300", dot: "#a1a1aa" },
  frontend: { label: "FRONTEND", cls: "text-sky-700 dark:text-sky-300", dot: "#0ea5e9" },
  api: { label: "API", cls: "text-indigo-700 dark:text-indigo-300", dot: "#6366f1" },
  service: { label: "SERVICE", cls: "text-violet-700 dark:text-violet-300", dot: "#8b5cf6" },
  db: { label: "DB", cls: "text-emerald-700 dark:text-emerald-300", dot: "#10b981" },
  external: { label: "EXTERNAL", cls: "text-amber-700 dark:text-amber-300", dot: "#f59e0b" },
  worker: { label: "WORKER", cls: "text-orange-700 dark:text-orange-300", dot: "#f97316" },
  queue: { label: "QUEUE", cls: "text-teal-700 dark:text-teal-300", dot: "#14b8a6" },
};

const CONTRACT_META: Record<
  DataContract["kind"],
  { label: string; cls: string }
> = {
  request: { label: "request", cls: "border-indigo-300 dark:border-indigo-500/40" },
  response: { label: "response", cls: "border-emerald-300 dark:border-emerald-500/40" },
  query: { label: "query", cls: "border-violet-300 dark:border-violet-500/40" },
  event: { label: "event", cls: "border-amber-300 dark:border-amber-500/40" },
  state: { label: "state", cls: "border-zinc-300 dark:border-zinc-600" },
  none: { label: "", cls: "" },
};

export function FlowView({
  flow,
  loading,
  error,
  onRetry,
}: {
  flow: FlowAnalysis | null;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
}) {
  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white px-4 py-6 dark:border-zinc-800 dark:bg-zinc-950">
        <p className="animate-pulse text-sm text-zinc-400">
          MiniMax is tracing the data flow — request payloads, API contracts,
          server processing, and response shapes through the stack…
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          One pass over the whole plan; this takes a minute.
        </p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-500/30 dark:bg-red-950/30">
        <p className="text-sm text-red-600 dark:text-red-400">
          Flow analysis unavailable: {error}
        </p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-2 rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-red-500"
          >
            Retry
          </button>
        )}
      </div>
    );
  }
  if (!flow) return null;

  return (
    <div className="flex flex-col gap-6">
      {flow.summary && (
        <p className="text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-200">
          {flow.summary}
        </p>
      )}

      {flow.features.length === 0 && (
        <p className="text-sm text-zinc-400">
          No distinct feature flows were identified in this plan.
        </p>
      )}

      {flow.features.map((f, i) => (
        <FeatureCard key={i} feature={f} />
      ))}

      {flow.decisions.length > 0 && <Decisions decisions={flow.decisions} />}
    </div>
  );
}

function FeatureCard({ feature }: { feature: Feature }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="border-b border-zinc-100 px-4 py-3 dark:border-zinc-800/70">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            {feature.name}
          </h3>
          {feature.planSteps?.map((n) => (
            <span
              key={n}
              className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
              title="Implemented by plan step"
            >
              #{n}
            </span>
          ))}
        </div>
        {feature.summary && (
          <p className="mt-1 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            {feature.summary}
          </p>
        )}
        {feature.trigger && (
          <p className="mt-2 text-[12px] text-zinc-500 dark:text-zinc-400">
            <span className="font-semibold uppercase tracking-wide text-zinc-400">
              Trigger
            </span>{" "}
            {feature.trigger}
          </p>
        )}
      </div>

      <div className="px-4 py-4">
        <ol className="flex flex-col">
          {feature.hops.map((hop, i) => (
            <Hop key={i} hop={hop} last={i === feature.hops.length - 1} />
          ))}
        </ol>
      </div>

      {(feature.errors?.length || feature.scrutinize?.length) && (
        <div className="grid gap-3 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800/70 sm:grid-cols-2">
          {feature.errors && feature.errors.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                Error & edge cases
              </div>
              <ul className="flex flex-col gap-1">
                {feature.errors.map((e, i) => (
                  <li key={i} className="text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                    · {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {feature.scrutinize && feature.scrutinize.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                Scrutinise
              </div>
              <ul className="flex flex-col gap-1">
                {feature.scrutinize.map((s, i) => (
                  <li key={i} className="flex gap-1.5 text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-200">
                    <span className="text-amber-500">→</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Hop({ hop, last }: { hop: FlowHop; last: boolean }) {
  const actor = ACTOR_META[hop.actor] ?? ACTOR_META.service;
  return (
    <li className="relative pl-6">
      {/* rail + node */}
      <span
        className="absolute left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-zinc-950"
        style={{ backgroundColor: actor.dot }}
      />
      {!last && (
        <span className="absolute left-[10px] top-4 bottom-0 w-px bg-zinc-200 dark:bg-zinc-800" />
      )}

      <div className="pb-5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={`text-[10px] font-bold tracking-wide ${actor.cls}`}>
            {actor.label}
          </span>
          <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {hop.component}
          </span>
        </div>
        {hop.action && (
          <div className="mt-0.5 font-mono text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
            {hop.action}
          </div>
        )}
        {hop.detail && (
          <p className="mt-0.5 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
            {hop.detail}
          </p>
        )}
        {hop.processing && hop.processing.length > 0 && (
          <ol className="mt-1.5 flex flex-col gap-0.5">
            {hop.processing.map((p, i) => (
              <li key={i} className="flex gap-2 text-[12px] text-zinc-500 dark:text-zinc-400">
                <span className="font-mono text-zinc-300 dark:text-zinc-600">
                  {i + 1}.
                </span>
                {p}
              </li>
            ))}
          </ol>
        )}
        {hop.data && hop.data.kind !== "none" && hop.data.fields.length > 0 && (
          <Contract contract={hop.data} />
        )}
      </div>
    </li>
  );
}

function Contract({ contract }: { contract: DataContract }) {
  const meta = CONTRACT_META[contract.kind];
  return (
    <div className={`mt-2 overflow-x-auto rounded-lg border ${meta.cls} bg-zinc-50 dark:bg-zinc-900/60`}>
      <div className="flex items-center gap-2 border-b border-zinc-200/60 px-3 py-1.5 dark:border-zinc-800/60">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
          {meta.label}
        </span>
        {contract.name && (
          <span className="font-mono text-xs font-medium text-zinc-700 dark:text-zinc-200">
            {contract.name}
          </span>
        )}
      </div>
      <table className="w-full font-mono text-[12px]">
        <tbody>
          {contract.fields.map((f, i) => (
            <tr key={i} className="border-b border-zinc-200/40 last:border-0 dark:border-zinc-800/40">
              <td className="whitespace-nowrap px-3 py-1 align-top text-zinc-800 dark:text-zinc-100">
                {f.name}
              </td>
              <td className="whitespace-nowrap px-3 py-1 align-top text-indigo-600 dark:text-indigo-400">
                {f.type}
              </td>
              <td className="px-3 py-1 align-top text-zinc-400">
                {f.note ? `// ${f.note}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Decisions({ decisions }: { decisions: PlanDecision[] }) {
  return (
    <div>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
        Cross-cutting decisions & tradeoffs
      </div>
      <div className="flex flex-col gap-2">
        {decisions.map((d, i) => (
          <div
            key={i}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
              {d.decision}
            </p>
            {d.rationale && (
              <p className="mt-0.5 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                {d.rationale}
              </p>
            )}
            {d.alternative && (
              <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">
                <span className="font-medium">Instead of:</span> {d.alternative}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
