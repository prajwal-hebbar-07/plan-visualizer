/**
 * POST /api/implement — implement a plan with Claude Code on a dedicated branch.
 *
 * Checks out `plan/<slug>` in the plan's git repository (so generated changes
 * stay isolated), then spawns `claude --print --output-format stream-json` with
 * `--permission-mode bypassPermissions` so Claude can edit files and run
 * commands unattended. Claude's events are transformed into a small NDJSON
 * protocol and streamed to the browser as they arrive:
 *
 *   { "type": "status",    "text": "..." }        setup / lifecycle notes
 *   { "type": "assistant", "text": "..." }        assistant narration
 *   { "type": "tool",      "text": "..." }         a tool Claude ran
 *   { "type": "result",    "text": "...", "ok": true }  final summary
 *   { "type": "error",     "error": "..." }
 *   { "type": "done",      "branch": "plan/<slug>" }
 *
 * Aborting the request (the UI's Stop button) kills the child process. A second
 * implement of the same plan is rejected with 409, and a 60-minute safety cap
 * stops a run that never finishes.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { resolvePlanPath } from "@/lib/plan-file";
import {
  claudeEnv,
  execFileAsync,
  findClaudeBinary,
  findClaudeConfigDir,
  gitToplevel,
} from "@/lib/claude-cli";

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
  | { type: "done"; branch: string };

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

/** Turn one Claude stream-json line into zero or more client events. */
function transformLine(line: string, cwd: string): ClientEvent[] {
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
  try {
    const body = (await request.json()) as { path?: unknown };
    filePath = await resolvePlanPath(body.path);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The plan path is invalid.";
    return Response.json({ error: message }, { status: 400 });
  }

  if (activeImplements.has(filePath)) {
    return Response.json({ error: "Claude is already implementing this plan." }, { status: 409 });
  }

  const cwd = await gitToplevel(filePath);
  if (!cwd) {
    return Response.json(
      {
        error:
          "This plan is not inside a git repository. Implement needs one so it can work on a dedicated branch.",
      },
      { status: 400 },
    );
  }

  const [configDir, claudeBinary] = await Promise.all([findClaudeConfigDir(), findClaudeBinary()]);
  const env = claudeEnv(configDir);
  const branch = branchName(filePath);

  let branchStatus: string;
  try {
    branchStatus = await ensureBranch(cwd, branch);
  } catch (error) {
    return Response.json({ error: branchError(error, branch) }, { status: 500 });
  }

  activeImplements.add(filePath);

  const encoder = new TextEncoder();
  let child: ChildProcess | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
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
      send({ type: "status", text: "Claude is implementing the plan…" });

      child = spawn(
        claudeBinary,
        [
          "--print",
          "--permission-mode",
          "bypassPermissions",
          "--no-session-persistence",
          "--output-format",
          "stream-json",
          "--verbose",
          implementPrompt(filePath),
        ],
        { cwd, env },
      );

      let stoppedByClient = false;
      let timedOut = false;
      let stdoutBuffer = "";
      let stderrTail = "";

      const killChild = () => {
        if (child && !child.killed) child.kill("SIGTERM");
      };
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
        request.signal.removeEventListener("abort", onAbort);
        activeImplements.delete(filePath);
      };

      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdoutBuffer += chunk;
        let index: number;
        while ((index = stdoutBuffer.indexOf("\n")) >= 0) {
          const line = stdoutBuffer.slice(0, index).trim();
          stdoutBuffer = stdoutBuffer.slice(index + 1);
          if (line) for (const event of transformLine(line, cwd)) send(event);
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
              ? "Claude Code was not found. Set CLAUDE_BIN to the Claude executable and restart the app."
              : error.message,
        });
        send({ type: "done", branch });
        finish();
      });

      child.on("close", (code) => {
        cleanup();
        const rest = stdoutBuffer.trim();
        if (rest) for (const event of transformLine(rest, cwd)) send(event);

        if (timedOut) {
          send({ type: "error", error: "Implementation stopped after 60 minutes." });
        } else if (stoppedByClient) {
          send({ type: "status", text: "Stopped." });
        } else if (code !== 0) {
          send({
            type: "error",
            error: stderrTail.trim() || `Claude exited with code ${code ?? "unknown"}.`,
          });
        }
        send({ type: "done", branch });
        finish();
      });
    },
    cancel() {
      if (child && !child.killed) child.kill("SIGTERM");
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
