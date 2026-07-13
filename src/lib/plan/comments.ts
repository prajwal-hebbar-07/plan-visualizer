import { parsePlan } from "./parse";
import type { Plan } from "./types";

export interface AddCommentInput {
  /** Step number to anchor under; omit to append to the end of the file. */
  stepNumber?: number;
  author?: string;
  text: string;
  /** ISO date; defaults to today. */
  date?: string;
}

/** Escape a run so it can't prematurely close the HTML comment. */
function sanitizeForComment(text: string): string {
  return text.replace(/-->/g, "-- >").replace(/\r?\n/g, " ").trim();
}

/**
 * Insert an `@me` review note into the raw plan markdown, anchored under the
 * given step (or appended if no anchor). Returns the new markdown.
 *
 * The `<!-- @me (author, date): text -->` shape is exactly what the `/plan`
 * skill's review flow expects, so notes added here are picked up verbatim by
 * `/plan-review`.
 */
export function addComment(raw: string, path: string, input: AddCommentInput): string {
  const plan = parsePlan(raw, path);
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const author = input.author?.trim();
  const meta = author ? `(${author}, ${date})` : `(${date})`;
  const note = `<!-- @me ${meta}: ${sanitizeForComment(input.text)} -->`;

  const lines = raw.split("\n");

  if (input.stepNumber == null) {
    // Append near the end, before a trailing blank run.
    let end = lines.length;
    while (end > 0 && lines[end - 1].trim() === "") end--;
    lines.splice(end, 0, "", note);
    return lines.join("\n");
  }

  const step = plan.steps.find((s) => s.number === input.stepNumber);
  if (!step) {
    throw new Error(`Step ${input.stepNumber} not found`);
  }

  // Insert on the line directly after the step, matching its indentation.
  const indent = lines[step.line].match(/^\s*/)?.[0] ?? "";
  lines.splice(step.line + 1, 0, `${indent}${note}`);
  return lines.join("\n");
}

/** Remove a specific `@me` comment (matched by its exact raw text) if present. */
export function removeComment(raw: string, rawComment: string): string {
  const idx = raw.indexOf(rawComment);
  if (idx === -1) return raw;
  // Drop the whole line the comment sits on if it becomes blank.
  const before = raw.slice(0, idx);
  const after = raw.slice(idx + rawComment.length);
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineEnd = idx + rawComment.length + (after.startsWith("\n") ? 0 : 0);
  const linePrefix = raw.slice(lineStart, idx);
  const lineSuffix = after.slice(0, after.indexOf("\n") === -1 ? after.length : after.indexOf("\n"));
  if (linePrefix.trim() === "" && lineSuffix.trim() === "") {
    // Remove the entire line (including its trailing newline).
    return raw.slice(0, lineStart) + raw.slice(lineEnd + lineSuffix.length + 1);
  }
  return before + after;
}

export function reparse(raw: string, path: string): Plan {
  return parsePlan(raw, path);
}
