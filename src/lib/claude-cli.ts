/**
 * Shared helpers for shelling out to Claude Code from the review and implement
 * routes: locating the Claude profile and binary, resolving the plan's repo,
 * and the small filesystem/git primitives they need. Kept server-only.
 */
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);

/** Expand a leading `~` / `~/` to the user's home directory. */
export function expandHome(value: string) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

/** Whether `filePath` is accessible with the given mode (default: exists). */
export async function exists(filePath: string, mode = constants.F_OK) {
  try {
    await access(filePath, mode);
    return true;
  } catch {
    return false;
  }
}

/** Nearest ancestor of `filePath` that contains a `.git`, else the file's dir. */
export async function findProjectRoot(filePath: string) {
  let current = path.dirname(filePath);

  while (true) {
    if (await exists(path.join(/* turbopackIgnore: true */ current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.dirname(filePath);
    current = parent;
  }
}

/**
 * The git top-level directory containing `filePath`, or `null` when the file is
 * not inside a git working tree.
 */
export async function gitToplevel(filePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: path.dirname(filePath),
      encoding: "utf8",
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Locate a Claude profile directory. Honors `CLAUDE_CONFIG_DIR`; otherwise
 * picks the first local `.claude*` profile that contains the plan-review skill.
 */
export async function findClaudeConfigDir() {
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

/** Path to the Claude executable: `CLAUDE_BIN`, else `~/.local/bin/claude`, else `PATH`. */
export async function findClaudeBinary() {
  const configured = process.env.CLAUDE_BIN?.trim();
  if (configured) return expandHome(configured);

  const localBinary = path.join(/* turbopackIgnore: true */ os.homedir(), ".local", "bin", "claude");
  if (await exists(localBinary, constants.X_OK)) return localBinary;
  return "claude";
}

/** Process env with `CLAUDE_CONFIG_DIR` applied when a profile was detected. */
export function claudeEnv(configDir: string | undefined): NodeJS.ProcessEnv {
  return configDir ? { ...process.env, CLAUDE_CONFIG_DIR: configDir } : process.env;
}
