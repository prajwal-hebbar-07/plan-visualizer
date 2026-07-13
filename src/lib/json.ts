/**
 * Pull the first balanced JSON object out of a model response, tolerating
 * markdown fences and prose around it. Returns the JSON substring, or null.
 */
export function extractJsonObject(raw: string): string | null {
  const t = raw.replace(/```json/gi, "").replace(/```/g, "");
  const start = t.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return t.slice(start, i + 1);
    }
  }
  return null;
}

/** Balance + close a JSON fragment; returns the closed string, or null if the
 * fragment has an unmatched closer (structurally broken, not just truncated). */
function closeFragment(fragment: string): string | null {
  let body = fragment.replace(/,\s*$/, "");
  const open: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") open.push("}");
    else if (c === "[") open.push("]");
    else if (c === "}" || c === "]") {
      if (open.pop() === undefined) return null; // unmatched closer
    }
  }
  if (inStr) body += '"';
  for (let i = open.length - 1; i >= 0; i--) body += open[i];
  return body;
}

/**
 * Best-effort repair of a JSON object cut off mid-generation (the model hit a
 * token limit or the stream dropped). Tries the whole fragment, then backs off
 * to each earlier safe boundary (a comma/brace/bracket outside a string),
 * closing open structures and returning the FIRST candidate that actually
 * `JSON.parse`s. Returns null if nothing salvageable parses.
 */
export function repairTruncatedJsonObject(raw: string): string | null {
  const t = raw.replace(/```json/gi, "").replace(/```/g, "");
  const start = t.indexOf("{");
  if (start === -1) return null;

  // Safe truncation points: `,` `}` `]` that sit outside a string.
  const safe: number[] = [];
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "," || c === "}" || c === "]") safe.push(i);
  }

  // Candidate ends: full string first, then each safe boundary, latest first.
  const ends = [t.length - 1, ...safe.reverse()];
  for (const end of ends) {
    const closed = closeFragment(t.slice(start, end + 1));
    if (closed === null) continue;
    try {
      JSON.parse(closed);
      return closed;
    } catch {
      // back off to an earlier boundary
    }
  }
  return null;
}
