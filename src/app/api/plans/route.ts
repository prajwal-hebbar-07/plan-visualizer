import type { NextRequest } from "next/server";
import { listPlans } from "@/lib/plan/fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/plans?dir=<relative dir> — list `.md` files and subdirectories
 * under the configured plans root. `dir` is confined to the root.
 */
export async function GET(req: NextRequest) {
  const dir = req.nextUrl.searchParams.get("dir") ?? "";
  try {
    const result = await listPlans(dir);
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
