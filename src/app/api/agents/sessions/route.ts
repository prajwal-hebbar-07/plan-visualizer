import { AgentContextError, listAgentSessions } from "@/lib/agent-cli";
import { resolvePlanPath } from "@/lib/plan-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filePath = await resolvePlanPath(url.searchParams.get("path"));
    const result = await listAgentSessions(
      url.searchParams.get("provider"),
      url.searchParams.get("accountId"),
      filePath,
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AgentContextError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Agent chats could not be listed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
