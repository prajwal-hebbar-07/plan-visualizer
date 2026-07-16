/** Server-only helpers for Codex accounts, threads, limits, and CLI execution. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import {
  exists,
  expandHome,
  findProjectRoot,
  type ClaudeCommand,
  type ClaudeSessionOption,
  type UsageLimits,
  type UsageWindow,
} from "@/lib/claude-cli";

export type CodexAccountId = "codex-one";

export type CodexRunContext = {
  accountId: CodexAccountId;
  accountLabel: string;
  configDir: string;
  sessionId: string;
  isNewSession: boolean;
  cwd: string;
};

export class CodexContextError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "INVALID_CODEX_CONTEXT",
  ) {
    super(message);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const codexGlobal = globalThis as typeof globalThis & {
  __planVisualizerActiveCodexSessions?: Map<string, ClaudeCommand>;
};
const activeSessions =
  codexGlobal.__planVisualizerActiveCodexSessions ??
  (codexGlobal.__planVisualizerActiveCodexSessions = new Map<string, ClaudeCommand>());

export async function findCodexBinary() {
  return process.env.CODEX_BIN?.trim() ? expandHome(process.env.CODEX_BIN.trim()) : "codex";
}

export function codexEnv(configDir: string): NodeJS.ProcessEnv {
  return { ...process.env, CODEX_HOME: configDir };
}

export async function getCodexAccount(accountId: unknown) {
  if (accountId !== "codex-one") {
    throw new CodexContextError("Choose the Codex account first.", 400, "ACCOUNT_REQUIRED");
  }
  const configured = process.env.CODEX_ONE_HOME?.trim();
  const configDir = configured
    ? expandHome(configured)
    : expandHome(process.env.CODEX_HOME?.trim() || "~/.codex");
  if (!(await exists(configDir))) {
    throw new CodexContextError(
      "The Codex account is not configured on this machine.",
      404,
      "ACCOUNT_NOT_FOUND",
    );
  }
  return {
    id: accountId as CodexAccountId,
    label: process.env.CODEX_ONE_LABEL?.trim() || "Codex account 1",
    configDir,
  };
}

type RpcError = { code?: number; message?: string; data?: unknown };

/** Make one initialized JSON-RPC request to the installed Codex app-server. */
async function codexAppServerRequest<T>(configDir: string, method: string, params: unknown): Promise<T> {
  const binary = await findCodexBinary();
  return new Promise<T>((resolve, reject) => {
    const child = spawn(binary, ["app-server", "--stdio"], {
      env: codexEnv(configDir),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error, result?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdin.end();
      if (child.exitCode === null) child.kill("SIGTERM");
      if (error) reject(error);
      else resolve(result as T);
    };
    const timeout = setTimeout(
      () => finish(new Error("Codex did not return account data within 20 seconds.")),
      20_000,
    );

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      for (;;) {
        const newline = stdout.indexOf("\n");
        if (newline < 0) break;
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        if (!line) continue;
        let message: { id?: number; result?: T; error?: RpcError };
        try {
          message = JSON.parse(line) as { id?: number; result?: T; error?: RpcError };
        } catch {
          continue;
        }
        if (message.id === 1) {
          child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
          child.stdin.write(`${JSON.stringify({ id: 2, method, params })}\n`);
        } else if (message.id === 2) {
          if (message.error) finish(new Error(message.error.message || "Codex app-server request failed."));
          else finish(undefined, message.result);
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(
        new Error(
          error.code === "ENOENT"
            ? "Codex CLI was not found. Set CODEX_BIN and restart the app."
            : error.message,
        ),
      );
    });
    child.on("close", (code) => {
      if (!settled) finish(new Error(stderr.trim() || `Codex app-server exited with code ${code ?? "unknown"}.`));
    });
    child.stdin.write(
      `${JSON.stringify({
        id: 1,
        method: "initialize",
        params: {
          clientInfo: { name: "plan-visualizer", title: "Plan Visualizer", version: "0.1.0" },
          capabilities: { experimentalApi: true },
        },
      })}\n`,
    );
  });
}

type CodexThread = {
  id: string;
  name?: string | null;
  preview: string;
  updatedAt: number;
  path?: string | null;
  modelProvider: string;
};

type RateLimitWindow = {
  usedPercent: number;
  resetsAt?: number | null;
  windowDurationMins?: number | null;
};

type RateLimitSnapshot = {
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
};

function sanitizeUsageWindow(window: RateLimitWindow | null | undefined): UsageWindow | undefined {
  if (!window || !Number.isFinite(window.usedPercent) || !window.windowDurationMins) return undefined;
  return {
    usedPercent: Math.max(0, Math.min(100, Math.round(window.usedPercent))),
    windowDurationMins: window.windowDurationMins,
    ...(window.resetsAt ? { resetsAt: new Date(window.resetsAt * 1000).toISOString() } : {}),
  };
}

function codexUsage(snapshot: RateLimitSnapshot | null | undefined): UsageLimits {
  const windows = [snapshot?.primary, snapshot?.secondary].filter(Boolean) as RateLimitWindow[];
  const result: UsageLimits = {};
  for (const window of windows) {
    const sanitized = sanitizeUsageWindow(window);
    if (!sanitized) continue;
    if (window.windowDurationMins === 5 * 60) result.fiveHour = sanitized;
    if (window.windowDurationMins === 7 * 24 * 60) result.sevenDay = sanitized;
  }
  return result;
}

async function readCodexContext(filePath: string | null | undefined) {
  if (!filePath) return {} as Pick<ClaudeSessionOption, "contextTokens" | "contextWindow">;
  let contextTokens: number | undefined;
  let contextWindow: number | undefined;
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
      if (event.type !== "event_msg") continue;
      const payload = event.payload as Record<string, unknown> | undefined;
      if (payload?.type !== "token_count") continue;
      const info = payload.info as Record<string, unknown> | undefined;
      const last = info?.last_token_usage as Record<string, unknown> | undefined;
      if (typeof last?.total_tokens === "number") contextTokens = last.total_tokens;
      if (typeof info?.model_context_window === "number") contextWindow = info.model_context_window;
    }
  } catch {}
  return {
    ...(contextTokens !== undefined ? { contextTokens } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
  };
}

export async function listCodexSessions(accountId: unknown, planPath: string) {
  const [account, cwd] = await Promise.all([getCodexAccount(accountId), findProjectRoot(planPath)]);
  const [threadResult, limitResult] = await Promise.all([
    codexAppServerRequest<{ data: CodexThread[] }>(account.configDir, "thread/list", {
      cwd,
      limit: 60,
      sortKey: "updated_at",
      sortDirection: "desc",
      sourceKinds: ["cli", "vscode", "exec", "appServer"],
    }),
    codexAppServerRequest<{ rateLimits?: RateLimitSnapshot }>(
      account.configDir,
      "account/rateLimits/read",
      null,
    ).catch(() => ({ rateLimits: undefined })),
  ]);
  const sessions = await Promise.all(
    threadResult.data.map(async (thread): Promise<ClaudeSessionOption> => ({
      id: thread.id,
      title: thread.name?.trim() || thread.preview.replace(/\s+/g, " ").trim().slice(0, 80) || `Chat ${thread.id.slice(0, 8)}`,
      updatedAt: new Date(thread.updatedAt * 1000).toISOString(),
      ...(thread.preview ? { preview: thread.preview.replace(/\s+/g, " ").trim().slice(0, 180) } : {}),
      model: thread.modelProvider === "openai" ? "Codex" : thread.modelProvider,
      ...(await readCodexContext(thread.path)),
    })),
  );
  return {
    account: { id: account.id, label: account.label },
    sessions,
    usage: codexUsage(limitResult.rateLimits),
  };
}

export async function resolveCodexRunContext(
  planPath: string,
  selection: { accountId?: unknown; sessionId?: unknown; newChat?: unknown },
): Promise<CodexRunContext> {
  const [account, cwd] = await Promise.all([getCodexAccount(selection.accountId), findProjectRoot(planPath)]);
  if (typeof selection.sessionId === "string" && UUID_RE.test(selection.sessionId)) {
    const result = await listCodexSessions(account.id, planPath);
    if (!result.sessions.some((session) => session.id === selection.sessionId)) {
      throw new CodexContextError(
        "That chat does not belong to the selected Codex account and repository. Choose it again.",
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
  throw new CodexContextError(
    "Choose an existing chat or explicitly choose New chat first.",
    400,
    "CHAT_REQUIRED",
  );
}

export function acquireCodexSession(context: CodexRunContext, command: ClaudeCommand) {
  const key = `${context.accountId}:${context.sessionId}`;
  const active = activeSessions.get(key);
  if (active) {
    throw new CodexContextError(
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

export function codexExecArgs(
  context: CodexRunContext,
  command: ClaudeCommand,
  prompt: string,
): string[] {
  const permissions =
    command === "implementation"
      ? ["--dangerously-bypass-approvals-and-sandbox"]
      : ["-a", "never", "-s", command === "question" ? "read-only" : "workspace-write"];
  const base = [...permissions, "-C", context.cwd, "exec"];
  return context.isNewSession
    ? [...base, "--json", prompt]
    : [...base, "resume", "--json", context.sessionId, prompt];
}

export type CodexJsonEvent = {
  type?: string;
  thread_id?: string;
  message?: string;
  error?: { message?: string } | string;
  item?: {
    type?: string;
    text?: string;
    command?: string;
    aggregated_output?: string;
    changes?: Array<{ path?: string; kind?: string }>;
  };
};

export function parseCodexJsonLine(line: string): CodexJsonEvent | null {
  try {
    const value = JSON.parse(line) as CodexJsonEvent;
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

export function codexEventError(event: CodexJsonEvent) {
  if (typeof event.error === "string") return event.error;
  if (event.error?.message) return event.error.message;
  return event.message;
}
