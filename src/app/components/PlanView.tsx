"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FlowAnalysis, Plan, PlanComment, Step } from "@/lib/plan/types";
import { EFFORT_META, STATUS_META } from "@/lib/plan/display";
import { computeInsights } from "@/lib/plan/graph";
import { DependencyGraph } from "./DependencyGraph";
import { DiagramBlock } from "./DiagramBlock";
import { FlowView } from "./FlowView";

interface Props {
  plan: Plan;
  author: string;
  onAuthorChange: (a: string) => void;
  onPlanUpdate: (p: Plan) => void;
}

type Tab = "flow" | "plan" | "structure";

export function PlanView({ plan, author, onAuthorChange, onPlanUpdate }: Props) {
  const [tab, setTab] = useState<Tab>("flow");

  // The system-flow analysis is fetched once per plan (PlanView is keyed by
  // path, so it remounts on plan change and the fetch re-runs cleanly).
  const [flow, setFlow] = useState<FlowAnalysis | null>(null);
  const [flowLoading, setFlowLoading] = useState(true);
  const [flowError, setFlowError] = useState<string | null>(null);

  const fetchFlow = useCallback(() => {
    fetch("/api/flow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: plan.path }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Flow analysis failed");
        setFlow(d.flow as FlowAnalysis);
        setFlowError(null);
      })
      .catch((e) => setFlowError(e instanceof Error ? e.message : String(e)))
      .finally(() => setFlowLoading(false));
  }, [plan.path]);

  useEffect(() => {
    fetchFlow();
  }, [fetchFlow]);

  const retryFlow = useCallback(() => {
    setFlowLoading(true);
    setFlowError(null);
    fetchFlow();
  }, [fetchFlow]);

  const commentsByStep = useMemo(() => {
    const map = new Map<number, PlanComment[]>();
    const general: PlanComment[] = [];
    for (const c of plan.comments) {
      if (c.anchorStep == null) general.push(c);
      else {
        const arr = map.get(c.anchorStep) ?? [];
        arr.push(c);
        map.set(c.anchorStep, arr);
      }
    }
    return { map, general };
  }, [plan.comments]);

  const fm = plan.frontmatter;
  const chips = [fm.kind, fm.horizon && `⏳ ${fm.horizon}`, fm.mood, fm.structure].filter(
    Boolean,
  ) as string[];

  const tabs: { id: Tab; label: string; hint: string }[] = [
    { id: "flow", label: "System flow", hint: "how it works, end to end" },
    { id: "plan", label: "Plan", hint: `${plan.steps.length} steps` },
    { id: "structure", label: "Structure", hint: "dependencies & diagrams" },
  ];

  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-10">
      <PlanHero plan={plan} chips={chips} />

      <div className="mb-6 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-indigo-500 text-zinc-900 dark:text-zinc-50"
                : "border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            }`}
            title={t.hint}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "flow" && (
        <FlowView
          flow={flow}
          loading={flowLoading}
          error={flowError}
          onRetry={retryFlow}
        />
      )}

      {tab === "plan" && (
        <PlanTab
          plan={plan}
          commentsByStep={commentsByStep}
          author={author}
          onAuthorChange={onAuthorChange}
          onPlanUpdate={onPlanUpdate}
        />
      )}

      {tab === "structure" && <StructureTab plan={plan} />}
    </article>
  );
}

function PlanTab({
  plan,
  commentsByStep,
  author,
  onAuthorChange,
  onPlanUpdate,
}: {
  plan: Plan;
  commentsByStep: { map: Map<number, PlanComment[]>; general: PlanComment[] };
  author: string;
  onAuthorChange: (a: string) => void;
  onPlanUpdate: (p: Plan) => void;
}) {
  return (
    <div>
      <div className="flex flex-col gap-6">
        {plan.phases.map((phase) => (
          <div key={phase.id}>
            {phase.title && (
              <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                <span className="h-4 w-1 rounded-full bg-indigo-500" />
                {phase.title}
              </h4>
            )}
            <ol className="flex flex-col gap-2.5">
              {phase.items.map((item, i) =>
                item.kind === "milestone" ? (
                  <li
                    key={`m-${phase.id}-${i}`}
                    className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200"
                  >
                    <span>🎉</span>
                    <span className="font-medium">{item.milestone.text}</span>
                  </li>
                ) : (
                  <StepCard
                    key={item.step.id}
                    step={item.step}
                    comments={commentsByStep.map.get(item.step.number) ?? []}
                    path={plan.path}
                    author={author}
                    onAuthorChange={onAuthorChange}
                    onPlanUpdate={onPlanUpdate}
                  />
                ),
              )}
            </ol>
          </div>
        ))}
      </div>

      {plan.risks.length > 0 && (
        <Section title="Edge cases & risks">
          <ul className="flex flex-col gap-2">
            {plan.risks.map((r, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-200"
              >
                <span>⚠️</span>
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {plan.openQuestions.length > 0 && (
        <Section title="Open questions">
          <ul className="flex flex-col gap-1.5">
            {plan.openQuestions.map((q, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-300"
              >
                <span className="text-indigo-400">?</span>
                <span>{q}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {commentsByStep.general.length > 0 && (
        <Section title="General notes">
          <div className="flex flex-col gap-2">
            {commentsByStep.general.map((c) => (
              <CommentRow
                key={c.id}
                comment={c}
                path={plan.path}
                onPlanUpdate={onPlanUpdate}
              />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function StructureTab({ plan }: { plan: Plan }) {
  return (
    <div>
      {plan.steps.length > 0 && (
        <Section
          title="Dependency map"
          hint="critical path · what's ready · what's blocked"
        >
          <InsightsStrip steps={plan.steps} />
          <div className="mt-4">
            <DependencyGraph steps={plan.steps} />
          </div>
          <GraphLegend />
        </Section>
      )}

      {plan.diagrams.length > 0 && (
        <Section title="Shape" hint="author's diagrams (auto-rendered)">
          <div className="flex flex-col gap-4">
            {plan.diagrams.map((d) => (
              <DiagramBlock key={d.id} diagram={d} planTitle={plan.title} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function PlanHero({ plan, chips }: { plan: Plan; chips: string[] }) {
  return (
    <header className="mb-8">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {chips.map((c) => (
          <span
            key={c}
            className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
          >
            {c}
          </span>
        ))}
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        {plan.title}
      </h1>
      {plan.status && (
        <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
          <span className="font-medium">Status:</span> {plan.status}
        </p>
      )}

      {plan.goal && (
        <p className="mt-4 border-l-2 border-indigo-400 pl-4 text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-200">
          {plan.goal}
        </p>
      )}

      <ProgressBar steps={plan.steps} />
    </header>
  );
}

function ProgressBar({ steps }: { steps: Step[] }) {
  if (steps.length === 0) return null;
  const counts = { done: 0, in_progress: 0, blocked: 0, todo: 0 };
  for (const s of steps) counts[s.status]++;
  const pct = (n: number) => (n / steps.length) * 100;
  return (
    <div className="mt-5">
      <div className="mb-1.5 flex justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
        <span>{counts.done} of {steps.length} done</span>
        <span>
          {counts.in_progress > 0 && `${counts.in_progress} in progress · `}
          {counts.blocked > 0 && `${counts.blocked} blocked`}
        </span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className="bg-emerald-500" style={{ width: `${pct(counts.done)}%` }} />
        <div className="bg-amber-400" style={{ width: `${pct(counts.in_progress)}%` }} />
        <div className="bg-red-500" style={{ width: `${pct(counts.blocked)}%` }} />
      </div>
    </div>
  );
}

function InsightsStrip({ steps }: { steps: Step[] }) {
  const ins = useMemo(() => computeInsights(steps), [steps]);
  const tiles: { label: string; value: string; accent: string; sub?: string }[] = [
    {
      label: "Ready now",
      value: String(ins.readyNow.length),
      accent: "text-indigo-600 dark:text-indigo-400",
      sub: ins.readyNow.length ? `#${ins.readyNow.join(" #")}` : "nothing unblocked",
    },
    {
      label: "Blocked",
      value: String(ins.blocked),
      accent: ins.blocked
        ? "text-red-600 dark:text-red-400"
        : "text-zinc-400",
    },
    {
      label: "In progress",
      value: String(ins.inProgress),
      accent: "text-amber-600 dark:text-amber-400",
    },
    {
      label: "Critical path",
      value: `${ins.criticalPath.length} steps`,
      accent: "text-zinc-800 dark:text-zinc-100",
      sub: ins.criticalPath.length ? `#${ins.criticalPath.join(" → #")}` : undefined,
    },
    {
      label: "Max parallel",
      value: `${ins.maxParallel}×`,
      accent: "text-zinc-800 dark:text-zinc-100",
      sub: "steps at once",
    },
    {
      label: "Effort left",
      value: String(ins.effortRemaining),
      accent: "text-zinc-800 dark:text-zinc-100",
      sub: "weighted pts",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            {t.label}
          </div>
          <div className={`text-lg font-semibold ${t.accent}`}>{t.value}</div>
          {t.sub && (
            <div className="truncate font-mono text-[10px] text-zinc-400" title={t.sub}>
              {t.sub}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function GraphLegend() {
  const items: { color: string; label: string }[] = [
    { color: "#10b981", label: "done" },
    { color: "#f59e0b", label: "in progress" },
    { color: "#ef4444", label: "blocked" },
    { color: "#a1a1aa", label: "to do" },
    { color: "#6366f1", label: "ready / critical path" },
  ];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: i.color }}
          />
          {i.label}
        </span>
      ))}
      <span className="text-zinc-400">
        · columns = dependency depth (left = start first) · dashed edge = prerequisite already done
      </span>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="mb-4 flex items-baseline justify-between border-b border-zinc-200 pb-2 dark:border-zinc-800">
        <h3 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">
          {title}
        </h3>
        {hint && <span className="text-[11px] text-zinc-400">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function StepCard({
  step,
  comments,
  path,
  author,
  onAuthorChange,
  onPlanUpdate,
}: {
  step: Step;
  comments: PlanComment[];
  path: string;
  author: string;
  onAuthorChange: (a: string) => void;
  onPlanUpdate: (p: Plan) => void;
}) {
  const [composing, setComposing] = useState(false);
  const meta = STATUS_META[step.status];

  return (
    <li
      className={`rounded-xl border bg-white p-3 dark:bg-zinc-950 ${meta.ring} ${
        step.status === "done" ? "opacity-80" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${meta.text}`}
          title={meta.label}
        >
          {meta.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p
              className={`text-sm leading-relaxed ${
                step.status === "done"
                  ? "text-zinc-400 line-through decoration-zinc-300"
                  : "text-zinc-800 dark:text-zinc-100"
              }`}
            >
              <span className="mr-1.5 font-mono text-xs text-zinc-400">
                {step.number}.
              </span>
              {step.text}
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              {step.effort && (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${EFFORT_META[step.effort].cls}`}
                  title={`Effort: ${step.effort}`}
                >
                  {EFFORT_META[step.effort].label}
                </span>
              )}
            </div>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
            <span className={meta.text}>{meta.label}</span>
            {step.needs.length > 0 && (
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                needs {step.needs.join(", ")}
              </span>
            )}
            <button
              onClick={() => setComposing((c) => !c)}
              className="ml-auto text-zinc-400 hover:text-indigo-500"
            >
              💬 {comments.length > 0 ? comments.length : "Comment"}
            </button>
          </div>

          {(comments.length > 0 || composing) && (
            <div className="mt-2.5 flex flex-col gap-2 border-t border-zinc-100 pt-2.5 dark:border-zinc-800/70">
              {comments.map((c) => (
                <CommentRow
                  key={c.id}
                  comment={c}
                  path={path}
                  onPlanUpdate={onPlanUpdate}
                />
              ))}
              {composing && (
                <CommentForm
                  path={path}
                  stepNumber={step.number}
                  author={author}
                  onAuthorChange={onAuthorChange}
                  onDone={(p) => {
                    onPlanUpdate(p);
                    setComposing(false);
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function CommentRow({
  comment,
  path,
  onPlanUpdate,
}: {
  comment: PlanComment;
  path: string;
  onPlanUpdate: (p: Plan) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const remove = useCallback(async () => {
    setDeleting(true);
    try {
      const res = await fetch("/api/comment", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, raw: comment.raw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      onPlanUpdate(data.plan as Plan);
    } catch {
      setDeleting(false);
    }
  }, [comment.raw, path, onPlanUpdate]);

  return (
    <div className="group rounded-lg bg-indigo-50/70 px-3 py-2 text-sm dark:bg-indigo-950/30">
      <div className="mb-0.5 flex items-center gap-2 text-[11px] text-indigo-500 dark:text-indigo-300">
        <span className="font-semibold">@{comment.author || "me"}</span>
        {comment.date && <span className="text-zinc-400">{comment.date}</span>}
        <button
          onClick={remove}
          disabled={deleting}
          className="ml-auto opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
          title="Delete note"
        >
          ✕
        </button>
      </div>
      <p className="text-zinc-700 dark:text-zinc-200">{comment.text}</p>
    </div>
  );
}

function CommentForm({
  path,
  stepNumber,
  author,
  onAuthorChange,
  onDone,
}: {
  path: string;
  stepNumber?: number;
  author: string;
  onAuthorChange: (a: string) => void;
  onDone: (p: Plan) => void;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, stepNumber, author: author || undefined, text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setText("");
      onDone(data.plan as Plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [text, saving, path, stepNumber, author, onDone]);

  return (
    <div className="rounded-lg border border-indigo-200 bg-white p-2 dark:border-indigo-500/30 dark:bg-zinc-950">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
        }}
        rows={2}
        autoFocus
        placeholder="Leave an @me note — it's written into the .md file…"
        className="w-full resize-y rounded-md bg-zinc-50 p-2 text-sm outline-none focus:ring-1 focus:ring-indigo-400 dark:bg-zinc-900"
      />
      <div className="mt-2 flex items-center gap-2">
        <input
          value={author}
          onChange={(e) => onAuthorChange(e.target.value)}
          placeholder="name (optional)"
          className="w-28 rounded-md bg-zinc-50 px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-indigo-400 dark:bg-zinc-900"
        />
        <button
          onClick={submit}
          disabled={saving || !text.trim()}
          className="ml-auto rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save note"}
        </button>
      </div>
      {error && <p className="mt-1 text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
