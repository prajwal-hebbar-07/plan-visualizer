import { Ollama } from "ollama";
import { config, isCloudModel } from "@/lib/env";

/**
 * Single Ollama client pointed at the local daemon (`config.ollamaHost`).
 *
 * The local daemon serves local models directly and transparently proxies
 * cloud model tags (e.g. `minimax-m2.7:cloud`) to Ollama Cloud, so all calls
 * go through this one client regardless of where the model actually runs.
 */
export const ollama = new Ollama({ host: config.ollamaHost });

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface HealthResult {
  /** Whether the Ollama daemon is reachable. */
  ok: boolean;
  /** Daemon URL that was probed. */
  host: string;
  /** Configured model tag. */
  model: string;
  /** Whether the configured model is a cloud model. */
  cloud: boolean;
  /** Names of locally pulled models (cloud models are not listed here). */
  localModels?: string[];
  /** Populated when `ok` is false. */
  error?: string;
}

/**
 * Cheap liveness probe: lists local models to confirm the daemon is up.
 * Cloud models are validated by actually calling them (see the chat route),
 * not here, to avoid billing a cloud request on every health check.
 */
export async function checkHealth(): Promise<HealthResult> {
  const base = {
    host: config.ollamaHost,
    model: config.ollamaModel,
    cloud: isCloudModel(config.ollamaModel),
  };
  try {
    const res = await ollama.list();
    return { ok: true, ...base, localModels: res.models.map((m) => m.name) };
  } catch (err) {
    return {
      ok: false,
      ...base,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface ChatChunk {
  /** Incremental reasoning text (reasoning models only). */
  thinking?: string;
  /** Incremental answer text. */
  content?: string;
}

/**
 * Streams a chat completion from the configured (or overridden) model,
 * yielding incremental `thinking` / `content` chunks as they arrive.
 */
export async function* streamChat(
  messages: ChatMessage[],
  opts: { model?: string; think?: boolean } = {},
): AsyncGenerator<ChatChunk> {
  const stream = await ollama.chat({
    model: opts.model?.trim() || config.ollamaModel,
    messages,
    stream: true,
    // Leave `think` undefined to use the model's default behavior.
    ...(opts.think === undefined ? {} : { think: opts.think }),
  });

  for await (const part of stream) {
    const chunk: ChatChunk = {};
    if (part.message.thinking) chunk.thinking = part.message.thinking;
    if (part.message.content) chunk.content = part.message.content;
    if (chunk.thinking || chunk.content) yield chunk;
  }
}
