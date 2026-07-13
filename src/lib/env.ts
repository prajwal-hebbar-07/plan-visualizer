/**
 * Centralized runtime configuration.
 *
 * These are read on the server only. Values come from the environment
 * (see `.env.example`) with sensible local-first defaults so the app
 * works out of the box against a locally running Ollama daemon.
 */
export const config = {
  /** URL of the local Ollama daemon. Cloud models are proxied through it. */
  ollamaHost: process.env.OLLAMA_HOST?.trim() || "http://127.0.0.1:11434",
  /**
   * Model to use. Cloud models end with ":cloud" and require `ollama signin`.
   * minimax-m2 was retired 2026-06-16; minimax-m2.7 is the current MiniMax.
   */
  ollamaModel: process.env.OLLAMA_MODEL?.trim() || "minimax-m2.7:cloud",
  /**
   * Root directory the file picker is allowed to browse and write comments
   * into. All plan paths are resolved and confined to this root (no escaping
   * via `..`). Defaults to the plan training-data corpus so the app is useful
   * out of the box; point it at your own `plans/` folder via env.
   */
  plansDir:
    process.env.PLANS_DIR?.trim() ||
    "/Users/hebbar/chaotic-thoughts/opensource/dotfiles/plan-training-data",
} as const;

/** Whether a model tag refers to an Ollama Cloud model. */
export function isCloudModel(model: string): boolean {
  return model.includes(":cloud") || model.endsWith("-cloud");
}
