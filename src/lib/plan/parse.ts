import type {
  Diagram,
  Effort,
  Phase,
  Plan,
  PlanComment,
  PlanFrontmatter,
  Risk,
  Step,
  StepStatus,
} from "./types";

const STATUS_BY_CHAR: Record<string, StepStatus> = {
  " ": "todo",
  x: "done",
  X: "done",
  "~": "in_progress",
  "!": "blocked",
};

const STEP_RE = /^(\s*)- \[([ xX~!])\]\s*(\d+)\.\s*(.*)$/;
const MILESTONE_RE = /^\s*- 🎉\s*MILESTONE:\s*(.*)$/;
const RISK_RE = /^\s*⚠️\s*RISK:\s*(.*)$/;
const EFFORT_RE = /\(effort:\s*(S|M|L|XL)\)/i;
const NEEDS_RE = /needs:\s*([\d,\s]+)/i;

/** Pull the `effort` and `needs` tags out of a step's text, returning the rest. */
function extractTags(text: string): {
  text: string;
  effort?: Effort;
  needs: number[];
} {
  let effort: Effort | undefined;
  let needs: number[] = [];

  const effortMatch = text.match(EFFORT_RE);
  if (effortMatch) effort = effortMatch[1].toUpperCase() as Effort;

  const needsMatch = text.match(NEEDS_RE);
  if (needsMatch) {
    needs = needsMatch[1]
      .split(",")
      .map((n) => parseInt(n.trim(), 10))
      .filter((n) => Number.isFinite(n));
  }

  const cleaned = text
    .replace(EFFORT_RE, "")
    .replace(NEEDS_RE, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { text: cleaned, effort, needs };
}

/** Parse the leading `--- … ---` YAML-ish frontmatter (flat `key: value`). */
function parseFrontmatter(lines: string[]): {
  frontmatter: PlanFrontmatter;
  bodyStart: number;
} {
  if (lines[0]?.trim() !== "---") return { frontmatter: {}, bodyStart: 0 };
  const fm: PlanFrontmatter = {};
  let i = 1;
  for (; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      i++;
      break;
    }
    const m = lines[i].match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim();
  }
  return { frontmatter: fm, bodyStart: i };
}

/** Section name from a `## Heading` line, lowercased and trimmed of trailing comments. */
function sectionKey(heading: string): string {
  return heading
    .replace(/^##\s+/, "")
    .replace(/#.*$/, "") // strip trailing `# inline comment`
    .trim()
    .toLowerCase();
}

/** Collect ` ```text ` fences (+ following `[DIAGRAM PROMPT: …]`) within a range. */
function parseDiagrams(lines: string[], start: number, end: number): Diagram[] {
  const diagrams: Diagram[] = [];
  let i = start;
  let n = 0;
  while (i < end) {
    const fence = lines[i].match(/^\s*```(\w*)\s*$/);
    if (!fence) {
      i++;
      continue;
    }
    const openLine = i;
    i++;
    const asciiLines: string[] = [];
    while (i < end && !/^\s*```\s*$/.test(lines[i])) {
      asciiLines.push(lines[i]);
      i++;
    }
    i++; // consume closing fence

    // An optional `[DIAGRAM PROMPT: …]` block may follow (can span lines
    // until the closing `]`). Skip blank lines in between.
    let prompt: string | undefined;
    let j = i;
    while (j < end && lines[j].trim() === "") j++;
    if (j < end && /^\s*\[DIAGRAM PROMPT:/i.test(lines[j])) {
      const promptLines: string[] = [];
      while (j < end) {
        promptLines.push(lines[j]);
        if (lines[j].includes("]")) {
          j++;
          break;
        }
        j++;
      }
      prompt = promptLines
        .join(" ")
        .replace(/^\s*\[DIAGRAM PROMPT:\s*/i, "")
        .replace(/\]\s*$/, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      i = j;
    }

    diagrams.push({
      id: `diagram-${n++}`,
      ascii: asciiLines.join("\n").replace(/\s+$/, ""),
      prompt,
      line: openLine,
    });
  }
  return diagrams;
}

/** Parse the `## Plan` body into phases, each holding step/milestone items. */
function parsePlanSection(
  lines: string[],
  start: number,
  end: number,
): { phases: Phase[]; steps: Step[] } {
  const phases: Phase[] = [];
  const steps: Step[] = [];

  let current: Phase = { id: "phase-0", items: [], line: start };
  let phaseCount = 0;
  const pushCurrent = () => {
    if (current.items.length > 0 || current.title) phases.push(current);
  };

  for (let i = start; i < end; i++) {
    const line = lines[i];

    const h3 = line.match(/^###\s+(.*)$/);
    if (h3) {
      pushCurrent();
      phaseCount++;
      current = {
        id: `phase-${phaseCount}`,
        title: h3[1].trim(),
        items: [],
        line: i,
      };
      continue;
    }

    const stepMatch = line.match(STEP_RE);
    if (stepMatch) {
      const { text, effort, needs } = extractTags(stepMatch[4]);
      const step: Step = {
        id: `step-${stepMatch[3]}`,
        number: parseInt(stepMatch[3], 10),
        status: STATUS_BY_CHAR[stepMatch[2]] ?? "todo",
        text,
        effort,
        needs,
        line: i,
      };
      steps.push(step);
      current.items.push({ kind: "step", step });
      continue;
    }

    const ms = line.match(MILESTONE_RE);
    if (ms) {
      current.items.push({
        kind: "milestone",
        milestone: { text: ms[1].trim(), line: i },
      });
    }
  }
  pushCurrent();

  // If a plan has no `###` headings, keep the single implicit phase.
  if (phases.length === 0 && current.items.length > 0) phases.push(current);

  return { phases, steps };
}

/** Find every `<!-- … @me … -->` comment and anchor it to the nearest step above. */
function parseComments(lines: string[], steps: Step[]): PlanComment[] {
  const raw = lines.join("\n");
  const comments: PlanComment[] = [];
  const re = /<!--([\s\S]*?)-->/g;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(raw))) {
    const inner = m[1];
    if (!/@me/i.test(inner)) continue;
    // The `plan-review guide` banner mentions `@me` only as an example; the
    // README says to skip it, so it is not a real review note.
    if (/plan-review guide/i.test(inner)) continue;
    const line = raw.slice(0, m.index).split("\n").length - 1;

    // `@me (Author, 2026-07-13): text` — author/date are optional.
    const body = inner.trim();
    const meMatch = body.match(
      /@me\s*(?:\(([^)]*)\))?\s*:?\s*([\s\S]*)/i,
    );
    let author: string | undefined;
    let date: string | undefined;
    let text = body;
    if (meMatch) {
      text = meMatch[2].trim();
      const meta = meMatch[1]?.trim();
      if (meta) {
        const dateM = meta.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateM) date = dateM[1];
        author = meta.replace(/,?\s*\d{4}-\d{2}-\d{2}/, "").replace(/,\s*$/, "").trim() || undefined;
      }
    }

    // Anchor to the last step that appears at or before this comment line.
    let anchorStep: number | undefined;
    for (const s of steps) {
      if (s.line <= line) anchorStep = s.number;
      else break;
    }

    comments.push({
      id: `comment-${n++}`,
      author,
      date,
      text,
      line,
      anchorStep,
      raw: m[0],
    });
  }
  return comments;
}

/** Parse a plan markdown string into the structured {@link Plan} model. */
export function parsePlan(raw: string, path: string): Plan {
  const lines = raw.split("\n");
  const { frontmatter, bodyStart } = parseFrontmatter(lines);

  // Index the `## ` section boundaries.
  const sections: { key: string; start: number; end: number }[] = [];
  const headingIdx: number[] = [];
  for (let i = bodyStart; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) headingIdx.push(i);
  }
  for (let h = 0; h < headingIdx.length; h++) {
    const start = headingIdx[h];
    const end = h + 1 < headingIdx.length ? headingIdx[h + 1] : lines.length;
    sections.push({ key: sectionKey(lines[start]), start, end });
  }
  const find = (needle: string) =>
    sections.find((s) => s.key.includes(needle));

  // Title + status line live above the first `##`.
  const firstSection = headingIdx[0] ?? lines.length;
  let title = frontmatter.plan ?? "";
  let status: string | undefined;
  for (let i = bodyStart; i < firstSection; i++) {
    const h1 = lines[i].match(/^#\s+(.*)$/);
    if (h1 && !title) title = h1[1].trim();
    const st = lines[i].match(/^Status:\s*(.*)$/i);
    if (st) status = st[1].trim();
  }
  if (!title) title = frontmatter.slug ?? "Untitled plan";

  const sliceText = (needle: string) => {
    const sec = find(needle);
    if (!sec) return "";
    return lines
      .slice(sec.start + 1, sec.end)
      .join("\n")
      .replace(/<!--[\s\S]*?-->/g, "")
      .trim();
  };

  const goal = sliceText("goal");

  const shape = find("shape");
  const diagrams = shape
    ? parseDiagrams(lines, shape.start + 1, shape.end)
    : [];

  const planSec = find("plan");
  const { phases, steps } = planSec
    ? parsePlanSection(lines, planSec.start + 1, planSec.end)
    : { phases: [], steps: [] };

  const risksSec = find("risk"); // matches "edge cases & risks"
  const risks: Risk[] = [];
  if (risksSec) {
    for (let i = risksSec.start + 1; i < risksSec.end; i++) {
      const m = lines[i].match(RISK_RE);
      if (m) risks.push({ text: m[1].trim(), line: i });
    }
  }

  const questionsSec = find("open question");
  const openQuestions: string[] = [];
  if (questionsSec) {
    for (let i = questionsSec.start + 1; i < questionsSec.end; i++) {
      const m = lines[i].match(/^\s*-\s+(.*)$/);
      if (m && m[1].trim()) openQuestions.push(m[1].trim());
    }
  }

  const changelog = sliceText("changelog");
  const comments = parseComments(lines, steps);

  return {
    frontmatter,
    title,
    status,
    goal,
    diagrams,
    phases,
    steps,
    risks,
    openQuestions,
    changelog,
    comments,
    path,
    name: path.split("/").pop() ?? path,
    raw,
  };
}
