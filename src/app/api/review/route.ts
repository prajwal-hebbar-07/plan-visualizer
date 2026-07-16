/** POST /api/review — resolve plan review notes with the manually selected agent chat. */
import { resolvePlanPath } from "@/lib/plan-file";
import { acquireAgentSession, AgentContextError, resolveAgentRunContext } from "@/lib/agent-cli";
import {
  claudeEnv,
  claudeSessionArgs,
  execFileAsync,
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

const activeReviews = new Set<string>();

function commandError(error: unknown) {
  if (!(error instanceof Error)) return "The agent could not run the plan review.";
  const details = error as Error & { code?: string | number; killed?: boolean; stderr?: string };
  if (details.killed) return "The agent did not finish the plan review within 15 minutes.";
  if (details.code === "ENOENT") {
    return "The selected agent CLI was not found. Configure CLAUDE_BIN or CODEX_BIN and restart the app.";
  }
  return (details.stderr?.trim() || details.message).slice(0, 4000);
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
    const message = error instanceof Error ? error.message : "The request is invalid.";
    return Response.json({ error: message }, { status: 400 });
  }

  if (activeReviews.has(filePath)) {
    return Response.json({ error: "An agent is already reviewing this plan.", code: "PLAN_BUSY" }, { status: 409 });
  }

  let releaseSession: () => void;
  try {
    releaseSession = acquireAgentSession(context, "review");
  } catch (error) {
    if (error instanceof AgentContextError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }

  activeReviews.add(filePath);
  let responseSessionId = context.provider === "claude" ? context.sessionId : undefined;
  try {
    let output = "";
    if (context.provider === "claude") {
      const claudeBinary = await findClaudeBinary();
      const { stdout } = await execFileAsync(
        claudeBinary,
        [
          "--print",
          "--permission-mode",
          "acceptEdits",
          "--output-format",
          "text",
          ...claudeSessionArgs(context),
          `/plan-review ${JSON.stringify(filePath)}`,
        ],
        {
          cwd: context.cwd,
          env: claudeEnv(context.configDir),
          encoding: "utf8",
          timeout: 15 * 60_000,
          maxBuffer: 2 * 1024 * 1024,
        },
      );
      output = stdout.trim();
    } else {
      const prompt =
        `Review the implementation plan at ${JSON.stringify(filePath)}. ` +
        `Resolve every inline HTML comment beginning with "@me" by updating the plan, remove each resolved marker, ` +
        `and preserve the plan as a self-contained implementation guide. Do not implement the plan's code changes.`;
      const { stdout } = await execFileAsync(
        await findCodexBinary(),
        codexExecArgs(context, "review", prompt),
        {
          cwd: context.cwd,
          env: codexEnv(context.configDir),
          encoding: "utf8",
          timeout: 15 * 60_000,
          maxBuffer: 8 * 1024 * 1024,
        },
      );
      for (const line of stdout.split("\n")) {
        const event = parseCodexJsonLine(line);
        if (!event) continue;
        if (event.type === "thread.started" && event.thread_id) responseSessionId = event.thread_id;
        if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) {
          output = event.item.text;
        }
        if (event.type === "turn.failed" || event.type === "error") {
          const message = codexEventError(event);
          if (message) throw new Error(message);
        }
      }
    }
    return Response.json({
      ok: true,
      output: output.slice(0, 8000),
      sessionId: responseSessionId,
    });
  } catch (error) {
    return Response.json(
      { error: commandError(error), ...(responseSessionId ? { sessionId: responseSessionId } : {}) },
      { status: 500 },
    );
  } finally {
    activeReviews.delete(filePath);
    releaseSession();
  }
}
