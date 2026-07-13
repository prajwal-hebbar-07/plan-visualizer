import type { NextRequest } from "next/server";
import { streamChat, type ChatMessage, type ChatRole } from "@/lib/ollama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES: readonly ChatRole[] = ["system", "user", "assistant"];

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.role === "string" &&
    ROLES.includes(m.role as ChatRole) &&
    typeof m.content === "string"
  );
}

/**
 * POST /api/chat — streams a chat completion from the configured model.
 *
 * Body: { messages: ChatMessage[], model?: string, think?: boolean }
 * Response: newline-delimited JSON (NDJSON), one event per line:
 *   { "type": "thinking", "text": "..." }
 *   { "type": "content",  "text": "..." }
 *   { "type": "done" }
 *   { "type": "error", "error": "..." }
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = (body as Record<string, unknown>)?.messages;
  if (!Array.isArray(raw) || raw.length === 0) {
    return Response.json(
      { error: "`messages` must be a non-empty array" },
      { status: 400 },
    );
  }
  if (!raw.every(isChatMessage)) {
    return Response.json(
      { error: "Each message needs a `role` (system|user|assistant) and string `content`" },
      { status: 400 },
    );
  }
  const messages = raw as ChatMessage[];

  const b = body as Record<string, unknown>;
  const model = typeof b.model === "string" ? b.model : undefined;
  const think = typeof b.think === "boolean" ? b.think : undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        for await (const chunk of streamChat(messages, { model, think })) {
          if (chunk.thinking) send({ type: "thinking", text: chunk.thinking });
          if (chunk.content) send({ type: "content", text: chunk.content });
        }
        send({ type: "done" });
      } catch (err) {
        send({ type: "error", error: err instanceof Error ? err.message : String(err) });
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
