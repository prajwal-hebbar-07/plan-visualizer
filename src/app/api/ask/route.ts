/**
 * POST /api/ask — answer a question about a plan with Claude Code or Codex (read-only).
 *
 * Runs the selected provider with read-only permissions so it can research the
 * repo but cannot edit anything. Answers stream back as newline-delimited JSON:
 *
 *   { "type": "research", "text": "..." }        a file/search Claude looked at
 *   { "type": "answer",   "text": "..." }        answer text (append in order)
 *   { "type": "error",    "error": "..." }
 *   { "type": "done",     "sessionId": "..." }    reuse to keep the conversation
 *
 * The account and existing/New chat are chosen manually in the UI. This route
 * always interprets the request as a read-only question command regardless of
 * what previously ran in the selected chat. For Claude, the prompt is written
 * to stdin so the variadic `--allowedTools` cannot swallow it. Aborting releases
 * the shared chat lock after terminating the child process.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { resolvePlanPath } from "@/lib/plan-file";
import { acquireAgentSession, AgentContextError, resolveAgentRunContext } from "@/lib/agent-cli";
import {
  claudeSessionArgs,
  claudeEnv,
  findClaudeBinary,
} from "@/lib/claude-cli";
import {
  codexEnv,
  codexEventError,
  codexExecArgs,
  findCodexBinary,
  parseCodexJsonLine,
} from "@/lib/codex-cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ASK_TIMEOUT_MS = 10 * 60_000;

function askPrompt(filePath: string, question: string, selection?: string) {
  const context = selection
    ? `The question is about this excerpt from the plan:\n"""\n${selection}\n"""\n\n`
    : "";
  return (
    `You are answering questions about the implementation plan in the file ${JSON.stringify(filePath)}. ` +
    `Read the plan and research the repository as needed to answer accurately and concretely. ` +
    `Do not modify any files — only answer.\n\n` +
    context +
    `Question: ${question}`
  );
}

type ClientEvent =
  | { type: "research"; text: string }
  | { type: "answer"; text: string }
  | { type: "error"; error: string }
  | { type: "session"; sessionId: string }
  | { type: "done"; sessionId?: string };

function summarizeToolUse(name: string, input: unknown): string {
  if (!input || typeof input !== "object") return name;
  const i = input as Record<string, unknown>;
  if (name === "Read" && typeof i.file_path === "string") return `Read ${i.file_path}`;
  if (name === "Grep" && typeof i.pattern === "string") return `Search “${i.pattern}”`;
  if (name === "Glob" && typeof i.pattern === "string") return `Find ${i.pattern}`;
  return name;
}

export async function POST(request: Request) {
  let filePath: string;
  let question: string;
  let selection: string | undefined;
  let context: Awaited<ReturnType<typeof resolveAgentRunContext>>;

  try {
    const body = (await request.json()) as {
      path?: unknown;
      provider?: unknown;
      question?: unknown;
      selection?: unknown;
      sessionId?: unknown;
      accountId?: unknown;
      newChat?: unknown;
    };
    filePath = await resolvePlanPath(body.path);
    if (typeof body.question !== "string" || !body.question.trim()) {
      return Response.json({ error: "Type a question first." }, { status: 400 });
    }
    if (body.question.length > 4000) {
      return Response.json({ error: "Questions are limited to 4,000 characters." }, { status: 400 });
    }
    question = body.question.trim();
    if (typeof body.selection === "string" && body.selection.trim()) {
      selection = body.selection.trim().slice(0, 2000);
    }
    context = await resolveAgentRunContext(filePath, body);
  } catch (error) {
    if (error instanceof AgentContextError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "The request is invalid.";
    return Response.json({ error: message }, { status: 400 });
  }

  let releaseSession: () => void;
  try {
    releaseSession = acquireAgentSession(context, "question");
  } catch (error) {
    if (error instanceof AgentContextError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }

  const binary = context.provider === "claude" ? await findClaudeBinary() : await findCodexBinary();
  const env = context.provider === "claude" ? claudeEnv(context.configDir) : codexEnv(context.configDir);
  let sessionId = context.provider === "claude" ? context.sessionId : "";

  const encoder = new TextEncoder();
  let child: ChildProcess | null = null;
  let terminateChild: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let answered = false;
      let resultText = "";
      const send = (event: ClientEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
        }
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {}
      };

      if (context.provider === "claude") send({ type: "session", sessionId });

      const transform = (line: string) => {
        if (context.provider === "codex") {
          const event = parseCodexJsonLine(line);
          if (!event) return;
          if (event.type === "thread.started" && event.thread_id) {
            sessionId = event.thread_id;
            send({ type: "session", sessionId });
          } else if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) {
            answered = true;
            send({ type: "answer", text: event.item.text });
          } else if (event.type === "item.completed" && event.item?.type === "command_execution") {
            send({ type: "research", text: `$ ${event.item.command || "command"}`.slice(0, 300) });
          } else if (event.type === "turn.failed" || event.type === "error") {
            const message = codexEventError(event);
            if (message) send({ type: "error", error: message });
          }
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          return;
        }
        if (!parsed || typeof parsed !== "object") return;
        const event = parsed as Record<string, unknown>;

        if (event.type === "assistant") {
          const message = event.message as { content?: unknown } | undefined;
          const content = Array.isArray(message?.content) ? message.content : [];
          for (const block of content) {
            if (!block || typeof block !== "object") continue;
            const b = block as Record<string, unknown>;
            if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
              answered = true;
              send({ type: "answer", text: b.text });
            } else if (b.type === "tool_use" && typeof b.name === "string") {
              send({ type: "research", text: summarizeToolUse(b.name, b.input).slice(0, 300) });
            }
          }
        } else if (event.type === "result" && typeof event.result === "string") {
          resultText = event.result;
        }
      };

      try {
        child = spawn(
          binary,
          context.provider === "claude"
            ? [
                "--print",
                "--output-format",
                "stream-json",
                "--verbose",
                "--allowedTools",
                "Read",
                "Grep",
                "Glob",
                ...claudeSessionArgs(context),
              ]
            : codexExecArgs(context, "question", askPrompt(filePath, question, selection)),
          { cwd: context.cwd, env },
        );
      } catch (error) {
        releaseSession();
        send({ type: "error", error: error instanceof Error ? error.message : "The agent could not start." });
        send({ type: "done", ...(sessionId ? { sessionId } : {}) });
        finish();
        return;
      }
      if (context.provider === "claude") child.stdin?.end(askPrompt(filePath, question, selection));

      let stoppedByClient = false;
      let timedOut = false;
      let stdoutBuffer = "";
      let stderrTail = "";
      let forceKill: NodeJS.Timeout | undefined;

      const killChild = () => {
        if (!child || child.exitCode !== null) return;
        child.kill("SIGTERM");
        forceKill ??= setTimeout(() => {
          if (child && child.exitCode === null) child.kill("SIGKILL");
        }, 2_000);
      };
      terminateChild = killChild;
      const timeout = setTimeout(() => {
        timedOut = true;
        killChild();
      }, ASK_TIMEOUT_MS);
      const onAbort = () => {
        stoppedByClient = true;
        killChild();
      };
      request.signal.addEventListener("abort", onAbort);

      const cleanup = () => {
        clearTimeout(timeout);
        clearTimeout(forceKill);
        request.signal.removeEventListener("abort", onAbort);
        releaseSession();
      };

      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdoutBuffer += chunk;
        let index: number;
        while ((index = stdoutBuffer.indexOf("\n")) >= 0) {
          const line = stdoutBuffer.slice(0, index).trim();
          stdoutBuffer = stdoutBuffer.slice(index + 1);
          if (line) transform(line);
        }
      });

      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        stderrTail = (stderrTail + chunk).slice(-4000);
      });

      child.on("error", (error: NodeJS.ErrnoException) => {
        cleanup();
        send({
          type: "error",
          error:
            error.code === "ENOENT"
              ? "The selected agent CLI was not found. Configure CLAUDE_BIN or CODEX_BIN and restart the app."
              : error.message,
        });
        send({ type: "done", ...(sessionId ? { sessionId } : {}) });
        finish();
      });

      child.on("close", (code) => {
        cleanup();
        const rest = stdoutBuffer.trim();
        if (rest) transform(rest);
        // If the model only emitted a final result, use it as the answer.
        if (!answered && resultText.trim()) send({ type: "answer", text: resultText });

        if (timedOut) {
          send({ type: "error", error: "The agent did not answer within 10 minutes." });
        } else if (stoppedByClient) {
          // client asked to stop; nothing more to say
        } else if (code !== 0 && !answered && !resultText.trim()) {
          send({
            type: "error",
            error: stderrTail.trim() || `The agent exited with code ${code ?? "unknown"}.`,
          });
        }
        send({ type: "done", ...(sessionId ? { sessionId } : {}) });
        finish();
      });
    },
    cancel() {
      if (terminateChild) terminateChild();
      else releaseSession();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
