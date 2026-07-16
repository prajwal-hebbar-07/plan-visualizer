/**
 * POST /api/review — resolve a plan's `@me` notes with Claude Code.
 *
 * Runs `claude --print /plan-review <plan>` for the requested file, auto-
 * detecting the Claude profile (`CLAUDE_CONFIG_DIR`, else a local `.claude*`
 * dir containing the plan-review skill) and binary (`CLAUDE_BIN`, else
 * `~/.local/bin/claude` or `PATH`). The working directory is the nearest
 * `.git` ancestor of the plan. Concurrent reviews of the same plan are
 * rejected with 409, and the command times out after 15 minutes.
 */
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolvePlanPath } from "@/lib/plan-file";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const activeReviews = new Set<string>();

function expandHome(value: string) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

async function exists(filePath: string, mode = constants.F_OK) {
  try {
    await access(filePath, mode);
    return true;
  } catch {
    return false;
  }
}

async function findProjectRoot(filePath: string) {
  let current = path.dirname(filePath);

  while (true) {
    if (await exists(path.join(/* turbopackIgnore: true */ current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.dirname(filePath);
    current = parent;
  }
}

async function findClaudeConfigDir() {
  const configured = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (configured) return expandHome(configured);

  const home = os.homedir();
  const candidates = [".claude", ".claude-one", ".claude-two"];
  for (const candidate of candidates) {
    const configDir = path.join(/* turbopackIgnore: true */ home, candidate);
    if (
      await exists(
        path.join(/* turbopackIgnore: true */ configDir, "skills", "plan-review", "SKILL.md"),
      )
    ) {
      return configDir;
    }
  }

  return undefined;
}

async function findClaudeBinary() {
  const configured = process.env.CLAUDE_BIN?.trim();
  if (configured) return expandHome(configured);

  const localBinary = path.join(/* turbopackIgnore: true */ os.homedir(), ".local", "bin", "claude");
  if (await exists(localBinary, constants.X_OK)) return localBinary;
  return "claude";
}

function commandError(error: unknown) {
  if (!(error instanceof Error)) return "Claude could not run the plan review.";

  const details = error as Error & { code?: string | number; killed?: boolean; stderr?: string };
  if (details.killed) return "Claude did not finish the plan review within 15 minutes.";
  if (details.code === "ENOENT") {
    return "Claude Code was not found. Set CLAUDE_BIN to the Claude executable and restart the app.";
  }

  const stderr = details.stderr?.trim();
  return (stderr || details.message).slice(0, 4000);
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

  if (activeReviews.has(filePath)) {
    return Response.json({ error: "Claude is already reviewing this plan." }, { status: 409 });
  }

  activeReviews.add(filePath);
  try {
    const [cwd, configDir, claudeBinary] = await Promise.all([
      findProjectRoot(filePath),
      findClaudeConfigDir(),
      findClaudeBinary(),
    ]);
    const env = configDir ? { ...process.env, CLAUDE_CONFIG_DIR: configDir } : process.env;
    const prompt = `/plan-review ${JSON.stringify(filePath)}`;
    const { stdout } = await execFileAsync(
      claudeBinary,
      [
        "--print",
        "--permission-mode",
        "acceptEdits",
        "--no-session-persistence",
        "--output-format",
        "text",
        prompt,
      ],
      {
        cwd,
        env,
        encoding: "utf8",
        timeout: 15 * 60_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );

    return Response.json({ ok: true, output: stdout.trim().slice(0, 8000) });
  } catch (error) {
    return Response.json({ error: commandError(error) }, { status: 500 });
  } finally {
    activeReviews.delete(filePath);
  }
}
