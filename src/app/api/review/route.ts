/** POST /api/review — run the review command in the manually selected Claude chat. */
import { resolvePlanPath } from "@/lib/plan-file";
import {
  acquireClaudeSession,
  claudeEnv,
  ClaudeContextError,
  claudeSessionArgs,
  execFileAsync,
  findClaudeBinary,
  resolveClaudeRunContext,
} from "@/lib/claude-cli";

export const runtime = "nodejs";

const activeReviews = new Set<string>();

function commandError(error: unknown) {
  if (!(error instanceof Error)) return "Claude could not run the plan review.";
  const details = error as Error & { code?: string | number; killed?: boolean; stderr?: string };
  if (details.killed) return "Claude did not finish the plan review within 15 minutes.";
  if (details.code === "ENOENT") {
    return "Claude Code was not found. Set CLAUDE_BIN to the Claude executable and restart the app.";
  }
  return (details.stderr?.trim() || details.message).slice(0, 4000);
}

export async function POST(request: Request) {
  let filePath: string;
  let context: Awaited<ReturnType<typeof resolveClaudeRunContext>>;

  try {
    const body = (await request.json()) as {
      path?: unknown;
      accountId?: unknown;
      sessionId?: unknown;
      newChat?: unknown;
    };
    filePath = await resolvePlanPath(body.path);
    context = await resolveClaudeRunContext(filePath, body);
  } catch (error) {
    if (error instanceof ClaudeContextError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "The request is invalid.";
    return Response.json({ error: message }, { status: 400 });
  }

  if (activeReviews.has(filePath)) {
    return Response.json({ error: "Claude is already reviewing this plan.", code: "PLAN_BUSY" }, { status: 409 });
  }

  let releaseSession: () => void;
  try {
    releaseSession = acquireClaudeSession(context, "review");
  } catch (error) {
    if (error instanceof ClaudeContextError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }

  activeReviews.add(filePath);
  try {
    const claudeBinary = await findClaudeBinary();
    const prompt = `/plan-review ${JSON.stringify(filePath)}`;
    const { stdout } = await execFileAsync(
      claudeBinary,
      [
        "--print",
        "--permission-mode",
        "acceptEdits",
        "--output-format",
        "text",
        ...claudeSessionArgs(context),
        prompt,
      ],
      {
        cwd: context.cwd,
        env: claudeEnv(context.configDir),
        encoding: "utf8",
        timeout: 15 * 60_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    return Response.json({
      ok: true,
      output: stdout.trim().slice(0, 8000),
      sessionId: context.sessionId,
    });
  } catch (error) {
    return Response.json(
      { error: commandError(error), sessionId: context.sessionId },
      { status: 500 },
    );
  } finally {
    activeReviews.delete(filePath);
    releaseSession();
  }
}
