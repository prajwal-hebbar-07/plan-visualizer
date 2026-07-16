/** Provider-neutral selection and locking facade for Claude Code and Codex. */
import {
  acquireClaudeSession,
  ClaudeContextError,
  listClaudeSessions,
  resolveClaudeRunContext,
  type ClaudeCommand,
  type ClaudeRunContext,
} from "@/lib/claude-cli";
import {
  acquireCodexSession,
  CodexContextError,
  listCodexSessions,
  resolveCodexRunContext,
  type CodexRunContext,
} from "@/lib/codex-cli";

export type AgentProvider = "claude" | "codex";
export type AgentRunContext =
  | ({ provider: "claude" } & ClaudeRunContext)
  | ({ provider: "codex" } & CodexRunContext);

export class AgentContextError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "INVALID_AGENT_CONTEXT",
  ) {
    super(message);
  }
}

function provider(value: unknown): AgentProvider {
  if (value === "claude" || value === "codex") return value;
  throw new AgentContextError("Choose Claude or Codex first.", 400, "PROVIDER_REQUIRED");
}

function normalizeError(error: unknown): never {
  if (error instanceof ClaudeContextError || error instanceof CodexContextError) {
    throw new AgentContextError(error.message, error.status, error.code);
  }
  throw error;
}

export async function listAgentSessions(providerValue: unknown, accountId: unknown, planPath: string) {
  try {
    return provider(providerValue) === "claude"
      ? await listClaudeSessions(accountId, planPath)
      : await listCodexSessions(accountId, planPath);
  } catch (error) {
    normalizeError(error);
  }
}

export async function resolveAgentRunContext(
  planPath: string,
  selection: { provider?: unknown; accountId?: unknown; sessionId?: unknown; newChat?: unknown },
): Promise<AgentRunContext> {
  const selectedProvider = provider(selection.provider);
  try {
    return selectedProvider === "claude"
      ? { provider: "claude", ...(await resolveClaudeRunContext(planPath, selection)) }
      : { provider: "codex", ...(await resolveCodexRunContext(planPath, selection)) };
  } catch (error) {
    normalizeError(error);
  }
}

export function acquireAgentSession(context: AgentRunContext, command: ClaudeCommand) {
  try {
    return context.provider === "claude"
      ? acquireClaudeSession(context, command)
      : acquireCodexSession(context, command);
  } catch (error) {
    normalizeError(error);
  }
}
