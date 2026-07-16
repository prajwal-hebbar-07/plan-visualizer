/**
 * POST /api/implement — implement a plan with Claude Code or Codex on a dedicated branch.
 *
 * Checks out `plan/<slug>` in the plan's git repository (so generated changes
 * stay isolated), then starts the manually selected agent with implementation
 * permissions so it can edit files and run commands unattended. Provider
 * events are transformed into a small NDJSON
 * protocol and streamed to the browser as they arrive:
 *
 *   { "type": "status",    "text": "..." }        setup / lifecycle notes
 *   { "type": "assistant", "text": "..." }        assistant narration
 *   { "type": "tool",      "text": "..." }         a tool the agent ran
 *   { "type": "result",    "text": "...", "ok": true }  final summary
 *   { "type": "error",     "error": "..." }
 *   { "type": "done",      "branch": "plan/<slug>", "sessionId": "..." }
 *
 * The manually selected account/chat supplies context, while this endpoint
 * always supplies implementation permissions and prompt semantics. Aborting
 * kills the child (escalating when necessary) and releases both plan/chat locks.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { resolvePlanPath } from "@/lib/plan-file";
import { acquireAgentSession, AgentContextError, resolveAgentRunContext } from "@/lib/agent-cli";
import {
  claudeSessionArgs,
  claudeEnv,
  execFileAsync,
  findClaudeBinary,
  gitToplevel,
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

const activeImplements = new Set<string>();
const IMPLEMENT_TIMEOUT_MS = 60 * 60_000;

/** `plan/<slug>` branch name derived from the plan's filename. */
function branchName(filePath: string) {
  const base = path
    .basename(filePath)
    .replace(/\.(md|markdown)$/i, "")
    .replace(/^plan-/, "");
  const slug =
    base
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "plan";
  return `plan/${slug}`;
}

async function branchExists(cwd: string, branch: string) {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], {
      cwd,
      encoding: "utf8",
    });
    return true;
  } catch {
    return false;
  }
}

/** Move onto `branch`, creating it when needed. Returns a human status line. */
async function ensureBranch(cwd: string, branch: string) {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    encoding: "utf8",
  });
  if (stdout.trim() === branch) return `Already on branch ${branch}`;

  if (await branchExists(cwd, branch)) {
    await execFileAsync("git", ["checkout", branch], { cwd, encoding: "utf8" });
    return `Switched to existing branch ${branch}`;
  }
  await execFileAsync("git", ["checkout", "-b", branch], { cwd, encoding: "utf8" });
  return `Created branch ${branch}`;
}

function branchError(error: unknown, branch: string) {
  const detail = (
    (error as { stderr?: string })?.stderr || (error instanceof Error ? error.message : "")
  ).trim();
  return `Could not check out ${branch}.${detail ? ` ${detail}` : ""}`;
}

function implementPrompt(filePath: string) {
  return (
    `Implement the plan described in the file ${JSON.stringify(filePath)}. ` +
    `Work through its steps in order and make all the code changes it specifies in this repository. ` +
    `If the plan still contains unresolved "@me" review notes, treat them as additional requirements and address them. ` +
    `When you are done, run the project's tests or type-checks to verify the change, and end with a short summary of what you did.`
  );
}

type ClientEvent =
  | { type: "status"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool"; text: string }
  | { type: "result"; text: string; ok: boolean }
  | { type: "error"; error: string }
  | { type: "session"; sessionId: string }
  | { type: "done"; branch: string; sessionId?: string };

function summarizeToolUse(name: string, input: unknown, cwd: string): string {
  if (!input || typeof input !== "object") return name;
  const i = input as Record<string, unknown>;
  if (name === "Bash" && typeof i.command === "string") return `$ ${i.command}`;
  if (name === "TodoWrite") return "Updating the task checklist";
  const file = i.file_path ?? i.path ?? i.notebook_path;
  if (typeof file === "string") {
    const rel = path.isAbsolute(file) ? path.relative(cwd, file) : file;
    return `${name} ${rel}`;
  }
  return name;
}

/** Turn one provider JSONL line into zero or more client events. */
function transformLine(line: string, cwd: string, provider: "claude" | "codex"): ClientEvent[] {
  if (provider === "codex") {
    const event = parseCodexJsonLine(line);
    if (!event) return [];
    if (event.type === "thread.started" && event.thread_id) {
      return [{ type: "session", sessionId: event.thread_id }];
    }
    if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text?.trim()) {
      return [{ type: "assistant", text: event.item.text.trim().slice(0, 2000) }];
    }
    if (event.type === "item.completed" && event.item?.type === "command_execution") {
      return [{ type: "tool", text: `$ ${event.item.command || "command"}`.slice(0, 2000) }];
    }
    if (event.type === "item.completed" && event.item?.type === "file_change") {
      const changed = event.item.changes?.map((change) => change.path).filter(Boolean).join(", ");
      return [{ type: "tool", text: changed ? `Changed ${changed}`.slice(0, 2000) : "Updated files" }];
    }
    if (event.type === "turn.failed" || event.type === "error") {
      return [{ type: "error", error: codexEventError(event) || "Codex could not implement the plan." }];
    }
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const event = parsed as Record<string, unknown>;

  if (event.type === "assistant") {
    const message = event.message as { content?: unknown } | undefined;
    const content = Array.isArray(message?.content) ? message.content : [];
    const out: ClientEvent[] = [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
        out.push({ type: "assistant", text: b.text.trim().slice(0, 2000) });
      } else if (b.type === "tool_use" && typeof b.name === "string") {
        out.push({ type: "tool", text: summarizeToolUse(b.name, b.input, cwd).slice(0, 2000) });
      }
    }
    return out;
  }

  if (event.type === "result") {
    const text = typeof event.result === "string" ? event.result.slice(0, 8000) : "";
    return [{ type: "result", text, ok: event.is_error !== true }];
  }

  return [];
}

export async function POST(request: Request) {
  let filePath: string;
  let context: Awaited<ReturnType<typeof resolveAgentRunContext>>;
  try {
    const body = (await request.json()) as {
      path?: unknown;
      provider?: unknown;
      accountId?: unknown;
      sessionId?: unknown;
      newChat?: unknown;
    };
    filePath = await resolvePlanPath(body.path);
    context = await resolveAgentRunContext(filePath, body);
  } catch (error) {
    if (error instanceof AgentContextError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "The plan path is invalid.";
    return Response.json({ error: message }, { status: 400 });
  }

  if (activeImplements.has(filePath)) {
    return Response.json({ error: "An agent is already implementing this plan." }, { status: 409 });
  }
  activeImplements.add(filePath);

  const cwd = await gitToplevel(filePath);
  if (!cwd) {
    activeImplements.delete(filePath);
    return Response.json(
      {
        error:
          "This plan is not inside a git repository. Implement needs one so it can work on a dedicated branch.",
      },
      { status: 400 },
    );
  }

  const binary = context.provider === "claude" ? await findClaudeBinary() : await findCodexBinary();
  const env = context.provider === "claude" ? claudeEnv(context.configDir) : codexEnv(context.configDir);
  const branch = branchName(filePath);

  let releaseSession: () => void;
  try {
    releaseSession = acquireAgentSession(context, "implementation");
  } catch (error) {
    activeImplements.delete(filePath);
    if (error instanceof AgentContextError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }

  let branchStatus: string;
  try {
    branchStatus = await ensureBranch(cwd, branch);
  } catch (error) {
    activeImplements.delete(filePath);
    releaseSession();
    return Response.json({ error: branchError(error, branch) }, { status: 500 });
  }

  const encoder = new TextEncoder();
  let child: ChildProcess | null = null;
  let terminateChild: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let activeSessionId = context.provider === "claude" ? context.sessionId : "";
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

      send({ type: "status", text: branchStatus });
      send({
        type: "status",
        text: `${context.provider === "claude" ? "Claude" : "Codex"} is implementing the plan…`,
      });
      if (context.provider === "claude") send({ type: "session", sessionId: context.sessionId });

      try {
        child = spawn(
          binary,
          context.provider === "claude"
            ? [
                "--print",
                "--permission-mode",
                "bypassPermissions",
                "--output-format",
                "stream-json",
                "--verbose",
                ...claudeSessionArgs(context),
                implementPrompt(filePath),
              ]
            : codexExecArgs(context, "implementation", implementPrompt(filePath)),
          { cwd, env },
        );
      } catch (error) {
        activeImplements.delete(filePath);
        releaseSession();
        send({ type: "error", error: error instanceof Error ? error.message : "The agent could not start." });
        send({ type: "done", branch, ...(activeSessionId ? { sessionId: activeSessionId } : {}) });
        finish();
        return;
      }

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
      }, IMPLEMENT_TIMEOUT_MS);
      const onAbort = () => {
        stoppedByClient = true;
        killChild();
      };
      request.signal.addEventListener("abort", onAbort);

      const cleanup = () => {
        clearTimeout(timeout);
        clearTimeout(forceKill);
        request.signal.removeEventListener("abort", onAbort);
        activeImplements.delete(filePath);
        releaseSession();
      };

      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdoutBuffer += chunk;
        let index: number;
        while ((index = stdoutBuffer.indexOf("\n")) >= 0) {
          const line = stdoutBuffer.slice(0, index).trim();
          stdoutBuffer = stdoutBuffer.slice(index + 1);
          if (line) {
            for (const event of transformLine(line, cwd, context.provider)) {
              if (event.type === "session") activeSessionId = event.sessionId;
              send(event);
            }
          }
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
        send({ type: "done", branch, ...(activeSessionId ? { sessionId: activeSessionId } : {}) });
        finish();
      });

      child.on("close", (code) => {
        cleanup();
        const rest = stdoutBuffer.trim();
        if (rest) {
          for (const event of transformLine(rest, cwd, context.provider)) {
            if (event.type === "session") activeSessionId = event.sessionId;
            send(event);
          }
        }

        if (timedOut) {
          send({ type: "error", error: "Implementation stopped after 60 minutes." });
        } else if (stoppedByClient) {
          send({ type: "status", text: "Stopped." });
        } else if (code !== 0) {
          send({
            type: "error",
            error: stderrTail.trim() || `The agent exited with code ${code ?? "unknown"}.`,
          });
        }
        send({ type: "done", branch, ...(activeSessionId ? { sessionId: activeSessionId } : {}) });
        finish();
      });
    },
    cancel() {
      if (terminateChild) {
        terminateChild();
      } else {
        activeImplements.delete(filePath);
        releaseSession();
      }
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
