import { checkHealth } from "@/lib/ollama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/health — reports whether the local Ollama daemon is reachable. */
export async function GET() {
  const health = await checkHealth();
  return Response.json(health, { status: health.ok ? 200 : 503 });
}
