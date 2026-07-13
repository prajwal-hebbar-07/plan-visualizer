/** Client-safe helpers: NDJSON streaming + minimal SVG sanitizing. */

export type NdjsonEvent =
  | { type: "thinking"; text: string }
  | { type: "content"; text: string }
  | { type: "done" }
  | { type: "error"; error: string };

/**
 * POST `body` to `url` and invoke `onEvent` for each newline-delimited JSON
 * event as it streams in. Resolves when the stream ends. Throws on transport
 * errors or an `{ type: "error" }` event.
 */
export async function streamNdjson(
  url: string,
  body: unknown,
  onEvent: (evt: NdjsonEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
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
      const evt = JSON.parse(line) as NdjsonEvent;
      if (evt.type === "error") throw new Error(evt.error);
      onEvent(evt);
    }
  }
}

/**
 * Extract and defang an `<svg>` from model output: strip markdown fences,
 * remove `<script>` blocks and inline `on*=` handlers, and only return markup
 * that actually contains an `<svg>` root. Returns null if none is found.
 */
export function sanitizeSvg(raw: string): string | null {
  let s = raw.replace(/```(?:svg|html|xml)?/gi, "").replace(/```/g, "").trim();
  const start = s.search(/<svg[\s>]/i);
  if (start === -1) return null;
  const end = s.lastIndexOf("</svg>");
  if (end === -1) return null;
  s = s.slice(start, end + "</svg>".length);
  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/(href|xlink:href)\s*=\s*("|')\s*javascript:[^"']*\2/gi, "");
  return s;
}
