/**
 * Shared helpers for shelling out to Claude Code from the review and implement
 * routes: locating the Claude profile and binary, resolving the plan's repo,
 * and the small filesystem/git primitives they need. Kept server-only.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);

export type ClaudeAccountId = "claude-one" | "claude-two";
export type ClaudeCommand = "question" | "review" | "implementation";

export type ClaudeSessionOption = {
  id: string;
  title: string;
  updatedAt: string;
  preview?: string;
  model?: string;
  contextTokens?: number;
  contextWindow?: number;
};

export type UsageWindow = {
  usedPercent: number;
  resetsAt?: string;
  windowDurationMins: number;
};

export type UsageLimits = {
  fiveHour?: UsageWindow;
  sevenDay?: UsageWindow;
};

export type ClaudeRunContext = {
  accountId: ClaudeAccountId;
  accountLabel: string;
  configDir: string;
  sessionId: string;
  isNewSession: boolean;
  cwd: string;
};

export class ClaudeContextError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "INVALID_CLAUDE_CONTEXT",
  ) {
    super(message);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const claudeGlobal = globalThis as typeof globalThis & {
  __planVisualizerActiveClaudeSessions?: Map<string, ClaudeCommand>;
};
const activeSessions =
  claudeGlobal.__planVisualizerActiveClaudeSessions ??
  (claudeGlobal.__planVisualizerActiveClaudeSessions = new Map<string, ClaudeCommand>());

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

/** The two Claude accounts exposed to the manual selector. */
export async function getClaudeAccount(accountId: unknown) {
  if (accountId !== "claude-one" && accountId !== "claude-two") {
    throw new ClaudeContextError("Choose Claude account 1 or Claude account 2 first.", 400, "ACCOUNT_REQUIRED");
  }

  const one = accountId === "claude-one";
  const configured = (one ? process.env.CLAUDE_ONE_CONFIG_DIR : process.env.CLAUDE_TWO_CONFIG_DIR)?.trim();
  const configDir = configured
    ? expandHome(configured)
    : path.join(os.homedir(), one ? ".claude-one" : ".claude-two");
  if (!(await exists(configDir))) {
    throw new ClaudeContextError(
      `${one ? "Claude account 1" : "Claude account 2"} is not configured on this machine.`,
      404,
      "ACCOUNT_NOT_FOUND",
    );
  }

  return {
    id: accountId as ClaudeAccountId,
    label:
      (one ? process.env.CLAUDE_ONE_LABEL : process.env.CLAUDE_TWO_LABEL)?.trim() ||
      (one ? "Claude account 1" : "Claude account 2"),
    configDir,
  };
}

function isInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function contextWindowForModel(model: string) {
  const normalized = model.toLowerCase();
  if (
    normalized.startsWith("claude-opus-4-8") ||
    normalized.startsWith("claude-opus-4-7") ||
    normalized.startsWith("claude-opus-4-6") ||
    normalized.startsWith("claude-sonnet-5") ||
    normalized.startsWith("claude-sonnet-4-6") ||
    normalized.startsWith("claude-fable-5") ||
    normalized.startsWith("claude-mythos")
  ) {
    return 1_000_000;
  }
  return normalized.startsWith("claude-") ? 200_000 : undefined;
}

function tokenCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

async function sessionFiles(configDir: string) {
  const projectsDir = path.join(configDir, "projects");
  let projectDirs;
  try {
    projectDirs = await readdir(projectsDir, { withFileTypes: true });
  } catch {
    return [] as string[];
  }

  const files: string[] = [];
  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory()) continue;
    const dir = path.join(projectsDir, projectDir.name);
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && UUID_RE.test(entry.name.replace(/\.jsonl$/i, "")) && entry.name.endsWith(".jsonl")) {
        files.push(path.join(dir, entry.name));
      }
    }
  }
  return files;
}

async function readSessionOption(filePath: string, projectRoot: string): Promise<ClaudeSessionOption | null> {
  const id = path.basename(filePath, ".jsonl");
  let title = "";
  let preview = "";
  let cwd = "";
  let updatedAt = "";
  let model = "";
  let contextTokens: number | undefined;

  try {
    const input = createReadStream(filePath, { encoding: "utf8" });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (event.isSidechain === true) continue;
      if (!cwd && typeof event.cwd === "string") cwd = event.cwd;
      if (typeof event.timestamp === "string" && event.timestamp > updatedAt) updatedAt = event.timestamp;
      if (event.type === "ai-title" && typeof event.aiTitle === "string" && event.aiTitle.trim()) {
        title = event.aiTitle.trim();
      }
      if (!preview && event.type === "user") {
        const message = event.message as { content?: unknown } | undefined;
        if (typeof message?.content === "string" && message.content.trim()) {
          preview = message.content.replace(/\s+/g, " ").trim().slice(0, 180);
        }
      }
      if (event.type === "assistant") {
        const message = event.message as { model?: unknown; usage?: unknown } | undefined;
        const usage = message?.usage as Record<string, unknown> | undefined;
        const candidateModel = typeof message?.model === "string" ? message.model : "";
        const used = usage
          ? tokenCount(usage.input_tokens) +
            tokenCount(usage.cache_creation_input_tokens) +
            tokenCount(usage.cache_read_input_tokens) +
            tokenCount(usage.output_tokens)
          : 0;
        if (candidateModel && candidateModel !== "<synthetic>" && used > 0) {
          model = candidateModel;
          contextTokens = used;
        }
      }
    }
  } catch {
    return null;
  }

  if (!cwd || !isInside(projectRoot, cwd)) return null;
  if (!updatedAt) {
    try {
      updatedAt = (await stat(filePath)).mtime.toISOString();
    } catch {
      updatedAt = new Date(0).toISOString();
    }
  }
  const contextWindow = model ? contextWindowForModel(model) : undefined;
  return {
    id,
    title: title || preview.slice(0, 80) || `Chat ${id.slice(0, 8)}`,
    updatedAt,
    ...(preview ? { preview } : {}),
    ...(model ? { model } : {}),
    ...(contextTokens !== undefined ? { contextTokens } : {}),
    ...(contextWindow ? { contextWindow } : {}),
  };
}

function claudeUsageWindow(value: unknown, windowDurationMins: number): UsageWindow | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.utilization !== "number" || !Number.isFinite(row.utilization)) return undefined;
  return {
    usedPercent: Math.max(0, Math.min(100, Math.round(row.utilization))),
    windowDurationMins,
    ...(typeof row.resets_at === "string" ? { resetsAt: row.resets_at } : {}),
  };
}

/** Sanitized cached subscription usage written by Claude Code for this profile. */
export async function readClaudeUsage(configDir: string): Promise<UsageLimits> {
  try {
    const raw = JSON.parse(await readFile(path.join(configDir, ".claude.json"), "utf8")) as Record<string, unknown>;
    const cache = raw.cachedUsageUtilization as Record<string, unknown> | undefined;
    const utilization = cache?.utilization as Record<string, unknown> | undefined;
    if (!utilization) return {};
    return {
      fiveHour: claudeUsageWindow(utilization.five_hour, 5 * 60),
      sevenDay: claudeUsageWindow(utilization.seven_day, 7 * 24 * 60),
    };
  } catch {
    return {};
  }
}

/** Sanitized existing chats for one account, limited to the plan repository. */
export async function listClaudeSessions(accountId: unknown, planPath: string) {
  const [account, projectRoot] = await Promise.all([
    getClaudeAccount(accountId),
    findProjectRoot(planPath),
  ]);
  const files = await sessionFiles(account.configDir);
  const sessions = (await Promise.all(files.map((file) => readSessionOption(file, projectRoot))))
    .filter((session): session is ClaudeSessionOption => session !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 60);
  const usage = await readClaudeUsage(account.configDir);
  return { account: { id: account.id, label: account.label }, sessions, usage };
}

/** Validate the user's manual account/chat choice and decide resume vs new. */
export async function resolveClaudeRunContext(
  planPath: string,
  selection: { accountId?: unknown; sessionId?: unknown; newChat?: unknown },
): Promise<ClaudeRunContext> {
  const [account, cwd] = await Promise.all([
    getClaudeAccount(selection.accountId),
    findProjectRoot(planPath),
  ]);

  if (typeof selection.sessionId === "string" && UUID_RE.test(selection.sessionId)) {
    const sessions = await listClaudeSessions(account.id, planPath);
    if (!sessions.sessions.some((session) => session.id === selection.sessionId)) {
      throw new ClaudeContextError(
        "That chat does not belong to the selected Claude account and repository. Choose it again.",
        404,
        "CHAT_NOT_FOUND",
      );
    }
    return {
      accountId: account.id,
      accountLabel: account.label,
      configDir: account.configDir,
      sessionId: selection.sessionId,
      isNewSession: false,
      cwd,
    };
  }

  if (selection.newChat === true && selection.sessionId == null) {
    return {
      accountId: account.id,
      accountLabel: account.label,
      configDir: account.configDir,
      sessionId: randomUUID(),
      isNewSession: true,
      cwd,
    };
  }

  throw new ClaudeContextError(
    "Choose an existing chat or explicitly choose New chat first.",
    400,
    "CHAT_REQUIRED",
  );
}

export function claudeSessionArgs(context: ClaudeRunContext) {
  return context.isNewSession
    ? ["--session-id", context.sessionId]
    : ["--resume", context.sessionId];
}

/** Serialize all command types that target the same manually selected chat. */
export function acquireClaudeSession(context: ClaudeRunContext, command: ClaudeCommand) {
  const key = `${context.accountId}:${context.sessionId}`;
  const active = activeSessions.get(key);
  if (active) {
    throw new ClaudeContextError(
      `This chat is already handling a ${active} command. Wait for it to finish or stop it before starting ${command}.`,
      409,
      "CHAT_BUSY",
    );
  }
  activeSessions.set(key, command);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (activeSessions.get(key) === command) activeSessions.delete(key);
  };
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
