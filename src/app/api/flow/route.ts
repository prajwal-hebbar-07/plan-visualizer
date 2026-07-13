import type { NextRequest } from "next/server";
import { readPlanFile } from "@/lib/plan/fs";
import { extractJsonObject, repairTruncatedJsonObject } from "@/lib/json";
import { streamChat, type ChatMessage } from "@/lib/ollama";
import type { DataContract, Feature, FlowAnalysis, HopActor } from "@/lib/plan/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTORS: HopActor[] = [
  "user",
  "frontend",
  "api",
  "service",
  "db",
  "external",
  "worker",
  "queue",
];

const SYSTEM = `You are a senior full-stack engineer reading a colleague's implementation plan. Produce the ONE thing a full-stack reviewer needs: an end-to-end SYSTEM FLOW of each feature the plan builds — how a request/action travels through the stack and the SHAPE OF THE DATA at every boundary.

Think exactly like this reviewer example (a form-autofill feature):
- what triggers it
- the request payload sent to the API (concrete fields + types)
- the API endpoint/contract that receives it
- what the API does internally, step by step (validation, DB reads, calls to other services, mapping)
- the response shape the API returns (concrete fields + types)
- how the frontend consumes that response to update the UI

For EACH feature in the plan, output an ordered list of "hops". Each hop is one stop in the stack:
- actor: one of user | frontend | api | service | db | external | worker | queue
- component: the file/function/endpoint that owns it (e.g. "useAutofill()", "POST /api/autofill", "profiles table")
- action: the concrete operation (e.g. "POST /api/autofill", "SELECT ... FROM profiles")
- detail: one line on what happens here
- processing: for api/service/worker hops, the ordered internal steps
- data: the contract crossing THIS boundary — { kind: request|response|query|event|state|none, name, fields: [{name, type, note}] }. Use real, specific types a dev would write (string, number, boolean, string[], Record<string,string>, ISO8601, UUID, enum values). Put the request payload on the hop that SENDS it and the response on the hop that RETURNS it.

Trace the DATA, not the plan's task list. If the plan is light on detail, infer the most idiomatic full-stack design and keep it concrete (a reviewer would rather scrutinise a specific proposal than read "TBD"). If a plan is not a software feature, model its main process as the flow.

Also give: a one-line plan summary; per-feature "errors" (edge/error cases) and "scrutinize" (specific things to push back on — missing validation, unclear contracts, N+1s, race conditions); which plan step numbers implement each feature (planSteps); and top-level cross-cutting "decisions" with rationale + rejected alternative.

STAY BOUNDED so the JSON is complete and not truncated:
- At most the 4 most important features (pick the highest-value flows; skip trivial ones).
- At most 7 hops per feature; at most 5 fields per contract; at most 4 processing steps, errors, or scrutinize items each.
- Keep every string terse (notes ≤ ~10 words). Favour completeness of the JSON over prose.

Output ONLY valid minified JSON, no markdown, matching exactly:
{"summary":"","features":[{"name":"","summary":"","trigger":"","hops":[{"actor":"frontend","component":"","action":"","detail":"","processing":[""],"data":{"kind":"request","name":"","fields":[{"name":"","type":"","note":""}]}}],"errors":[""],"scrutinize":[""],"planSteps":[1]}],"decisions":[{"decision":"","rationale":"","alternative":""}]}`;

function str(x: unknown): string {
  return typeof x === "string" ? x : "";
}
function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [];
}
function nums(x: unknown): number[] {
  return arr(x)
    .map((n) => (typeof n === "number" ? n : Number(n)))
    .filter((n) => Number.isFinite(n));
}

function coerceContract(x: unknown): DataContract | undefined {
  if (!x || typeof x !== "object") return undefined;
  const o = x as Record<string, unknown>;
  const kind = str(o.kind) as DataContract["kind"];
  const valid: DataContract["kind"][] = [
    "request",
    "response",
    "query",
    "event",
    "state",
    "none",
  ];
  return {
    kind: valid.includes(kind) ? kind : "none",
    name: str(o.name) || undefined,
    fields: arr(o.fields).map((f) => {
      const fo = (f ?? {}) as Record<string, unknown>;
      return { name: str(fo.name), type: str(fo.type), note: str(fo.note) || undefined };
    }),
  };
}

function coerceFeature(x: unknown): Feature {
  const o = (x ?? {}) as Record<string, unknown>;
  return {
    name: str(o.name) || "Feature",
    summary: str(o.summary) || undefined,
    trigger: str(o.trigger) || undefined,
    hops: arr(o.hops).map((h) => {
      const ho = (h ?? {}) as Record<string, unknown>;
      const actor = str(ho.actor) as HopActor;
      return {
        actor: ACTORS.includes(actor) ? actor : "service",
        component: str(ho.component),
        action: str(ho.action),
        detail: str(ho.detail) || undefined,
        processing: arr(ho.processing).map(str).filter(Boolean),
        data: coerceContract(ho.data),
      };
    }),
    errors: arr(o.errors).map(str).filter(Boolean),
    scrutinize: arr(o.scrutinize).map(str).filter(Boolean),
    planSteps: nums(o.planSteps),
  };
}

function coerce(value: unknown): FlowAnalysis {
  const v = (value ?? {}) as Record<string, unknown>;
  return {
    summary: str(v.summary),
    features: arr(v.features).map(coerceFeature),
    decisions: arr(v.decisions).map((d) => {
      const o = (d ?? {}) as Record<string, unknown>;
      return {
        decision: str(o.decision),
        rationale: str(o.rationale),
        alternative: str(o.alternative) || undefined,
      };
    }),
  };
}

/**
 * POST /api/flow — body { path }. Reads the plan and returns an AI-reconstructed
 * end-to-end system flow (features → hops with data contracts + processing),
 * plus cross-cutting decisions. One model call; blocks until JSON is complete.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const path = typeof body.path === "string" ? body.path : "";
  if (!path) return Response.json({ error: "`path` is required" }, { status: 400 });

  let raw: string;
  try {
    ({ raw } = await readPlanFile(path));
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: raw },
  ];

  // Accumulate content, tolerating a mid-stream drop. Long cloud generations
  // occasionally get killed by an upstream timeout before the "done" frame, so
  // the stream iterator throws — but the partial JSON we already collected is
  // still worth salvaging. `num_predict` caps length to finish well under that
  // ceiling in the first place.
  let out = "";
  let streamError: Error | null = null;
  try {
    for await (const chunk of streamChat(messages, {
      think: false,
      // Cap length so the call completes well under the upstream ~4-min stream
      // timeout; the prompt's feature/hop bounds keep most plans under this.
      options: { num_predict: 5000 },
    })) {
      if (chunk.content) out += chunk.content;
    }
  } catch (err) {
    streamError = err instanceof Error ? err : new Error(String(err));
  }

  // Try the clean balanced object; if truncated (or dropped), repair a valid
  // prefix so the reviewer still gets the flows that did complete.
  const candidates = [extractJsonObject(out), repairTruncatedJsonObject(out)];
  for (const json of candidates) {
    if (!json) continue;
    try {
      return Response.json({ flow: coerce(JSON.parse(json)) });
    } catch {
      // try the next candidate
    }
  }

  return Response.json(
    {
      error: streamError
        ? `Model stream ended early (${streamError.message}) and no partial result was recoverable — retry.`
        : "Model did not return parseable JSON",
      raw: out.slice(0, 2000),
    },
    { status: 502 },
  );
}
