/**
 * Structured model of a `/plan` markdown file.
 *
 * The grammar is the one documented in the plan-training-data README (the
 * "parse contract"): frontmatter + `## Goal / ## Shape / ## Plan /
 * ## Edge cases & risks / ## Open questions / ## Review changelog`, with
 * checkbox steps, effort/needs tags, `### phase` headings, milestones,
 * `⚠️ RISK:` lines, and ` ```text ` diagram fences followed by
 * `[DIAGRAM PROMPT: …]`.
 *
 * Every element carries the 0-based source `line` it was parsed from so the
 * renderer can anchor inline comments and write them back into the exact spot
 * in the original file.
 */

export type StepStatus = "todo" | "done" | "in_progress" | "blocked";

export type Effort = "S" | "M" | "L" | "XL";

export interface Step {
  /** Stable id within the plan, e.g. `step-3`. */
  id: string;
  /** The step number as written (the `3` in `- [ ] 3. …`). */
  number: number;
  status: StepStatus;
  /** Step text with the effort/needs tags stripped out. */
  text: string;
  effort?: Effort;
  /** Step numbers this step depends on (from `needs: 1,2`). */
  needs: number[];
  /** 0-based source line index of the step bullet. */
  line: number;
}

export interface Milestone {
  /** Text after `🎉 MILESTONE:`. */
  text: string;
  line: number;
}

/** A milestone rides between steps inside a phase, so items are a union. */
export type PhaseItem =
  | { kind: "step"; step: Step }
  | { kind: "milestone"; milestone: Milestone };

export interface Phase {
  id: string;
  /** `### heading` text, or undefined for the implicit single phase. */
  title?: string;
  items: PhaseItem[];
  line: number;
}

export interface Diagram {
  id: string;
  /** The raw ASCII inside the ` ```text ` fence. */
  ascii: string;
  /** The `[DIAGRAM PROMPT: …]` description, if present. */
  prompt?: string;
  /** 0-based source line index of the opening fence. */
  line: number;
}

export interface Risk {
  text: string;
  line: number;
}

/** An `@me` review note, either parsed from the file or added via the UI. */
export interface PlanComment {
  id: string;
  author?: string;
  date?: string;
  text: string;
  /** 0-based source line of the HTML comment. */
  line: number;
  /** Step number this note sits under, if any (nearest preceding step). */
  anchorStep?: number;
  /** The raw HTML comment as it appears in the file. */
  raw: string;
}

/**
 * AI-reconstructed *system flow* for a plan — how the feature actually works at
 * runtime, the way a full-stack engineer traces it: trigger → request payload →
 * API contract → server processing → response shape → how the frontend applies
 * it. The terse `/plan` markdown doesn't spell this out, so MiniMax infers the
 * most likely design from the plan. Always presented as AI analysis.
 */

/** Where a hop happens in the stack. */
export type HopActor =
  | "user"
  | "frontend"
  | "api"
  | "service"
  | "db"
  | "external"
  | "worker"
  | "queue";

export interface DataField {
  name: string;
  /** Type as a full-stack dev would write it, e.g. `string`, `Record<string,string>`, `User[]`. */
  type: string;
  note?: string;
}

export interface DataContract {
  /** What this payload is at the boundary. */
  kind: "request" | "response" | "query" | "event" | "state" | "none";
  /** Contract name, e.g. `AutofillRequest`. */
  name?: string;
  fields: DataField[];
}

export interface FlowHop {
  actor: HopActor;
  /** File / function / endpoint that owns this hop, e.g. `useAutofill()` or `POST /api/autofill`. */
  component: string;
  /** The concrete action, e.g. `POST /api/autofill` or `SELECT … FROM profiles`. */
  action: string;
  /** One line of prose on what happens here. */
  detail?: string;
  /** Server-side processing steps, in order (for api/service/worker hops). */
  processing?: string[];
  /** The data contract crossing this boundary (the payload/response shape). */
  data?: DataContract;
}

export interface Feature {
  name: string;
  summary?: string;
  /** What kicks the flow off. */
  trigger?: string;
  hops: FlowHop[];
  /** Error / edge cases in this flow. */
  errors?: string[];
  /** Concrete things a reviewer should scrutinise about this feature. */
  scrutinize?: string[];
  /** Plan step numbers that implement this feature. */
  planSteps?: number[];
}

export interface PlanDecision {
  decision: string;
  rationale: string;
  /** What else was possible and why it wasn't chosen. */
  alternative?: string;
}

export interface FlowAnalysis {
  /** What the plan is, in a sentence or two. */
  summary: string;
  features: Feature[];
  /** Cross-cutting design decisions with tradeoffs. */
  decisions: PlanDecision[];
}

export interface PlanFrontmatter {
  plan?: string;
  slug?: string;
  kind?: string;
  created?: string;
  horizon?: string;
  mood?: string;
  structure?: string;
  [key: string]: string | undefined;
}

export interface Plan {
  frontmatter: PlanFrontmatter;
  /** Display title (frontmatter `plan`, falling back to the `# H1`). */
  title: string;
  /** The `Status: …` lifecycle line, verbatim. */
  status?: string;
  goal: string;
  diagrams: Diagram[];
  phases: Phase[];
  /** Flat list of every step, in document order. */
  steps: Step[];
  risks: Risk[];
  openQuestions: string[];
  /** Raw markdown of the `## Review changelog` body. */
  changelog: string;
  /** All `@me` comments found anywhere in the file. */
  comments: PlanComment[];
  /** Absolute path this plan was read from. */
  path: string;
  /** File basename. */
  name: string;
  /** The full original markdown. */
  raw: string;
}
