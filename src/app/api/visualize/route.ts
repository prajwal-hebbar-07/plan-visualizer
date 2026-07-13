import type { NextRequest } from "next/server";
import { streamChat, type ChatMessage } from "@/lib/ollama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * System prompts that turn the plan's own `[DIAGRAM PROMPT]` / content into a
 * web-friendly artifact. MiniMax is a text model, so we ask for a single,
 * self-contained SVG (no external assets) that inherits the page's theme via
 * `currentColor`, plus a short narrative for the "story mode" intro.
 */
const DIAGRAM_SYSTEM = `You are a software architecture diagrammer. Convert the description into ONE clean, TECHNICAL SVG diagram of the kind an engineer sketches on a whiteboard — boxes-and-arrows, state machines, data flow, sequence, or before/after component wiring. The audience is a senior engineer scanning for structure, not a child.

Output rules:
- Output ONLY the SVG markup: a single <svg>…</svg>. No markdown fences, no prose, no explanation.
- Set viewBox="0 0 820 H" (pick H to fit), width="100%", height="auto". Do NOT hardcode a pixel width.
- NEVER use <script>, external images, <foreignObject>, or web fonts.

Style rules (important):
- Minimal, precise, monochrome. Use stroke="currentColor"/fill="currentColor" for boxes and text so it adapts to light/dark themes.
- Use AT MOST two accents: #6366f1 (emphasis / target / primary path) and #ef4444 (risk / removed / "before"). Nothing else.
- ABSOLUTELY NO illustrations, mascots, landscapes, castles, parchment, textures, emojis, or decorative gradients. This is a technical diagram, not an infographic.
- Nodes: plain rectangles (rx 4-6), 1.5px stroke, with a concise label. Use font-family="ui-monospace, monospace" font-size 12-13 for identifiers (files, components, states, services).
- Edges: straight or right-angled connectors with an arrowhead marker; label the relationship on the edge (e.g. "toggle", "writes", "needs", "proxies").
- Group related nodes; keep whitespace generous and the layout uncluttered. Clarity over prettiness. Faithfully encode the named elements, relationships, and emphasis from the description.`;

const NARRATIVE_SYSTEM = `You are a witty technical narrator. Given a project plan, write a SHORT, energetic intro (2-3 sentences, max ~60 words) that captures the plan's vibe and stakes in plain language. No headings, no lists, no markdown — just punchy prose. Match the plan's mood if one is given.`;

interface Body {
  mode?: "diagram" | "narrative";
  prompt?: string;
  ascii?: string;
  planTitle?: string;
  mood?: string;
  model?: string;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const mode = body.mode === "narrative" ? "narrative" : "diagram";
  let messages: ChatMessage[];

  if (mode === "narrative") {
    const context = [
      body.planTitle && `Plan: ${body.planTitle}`,
      body.mood && `Mood: ${body.mood}`,
      body.prompt && `Details: ${body.prompt}`,
    ]
      .filter(Boolean)
      .join("\n");
    messages = [
      { role: "system", content: NARRATIVE_SYSTEM },
      { role: "user", content: context || "A software project plan." },
    ];
  } else {
    const desc = body.prompt?.trim();
    const ascii = body.ascii?.trim();
    if (!desc && !ascii) {
      return Response.json(
        { error: "`prompt` or `ascii` is required for a diagram" },
        { status: 400 },
      );
    }
    const user = [
      desc && `Diagram description:\n${desc}`,
      ascii && `ASCII reference (reproduce its structure, don't copy verbatim):\n${ascii}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    messages = [
      { role: "system", content: DIAGRAM_SYSTEM },
      { role: "user", content: user },
    ];
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        // Diagrams shouldn't burn tokens on visible reasoning; keep think off.
        for await (const chunk of streamChat(messages, {
          model: body.model,
          think: false,
        })) {
          if (chunk.content) send({ type: "content", text: chunk.content });
        }
        send({ type: "done" });
      } catch (err) {
        send({
          type: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
