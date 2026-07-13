import type { NextRequest } from "next/server";
import { readPlanFile } from "@/lib/plan/fs";
import { parsePlan } from "@/lib/plan/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/plan?path=<relative path> — read a plan file and return both the
 * raw markdown and the parsed structure.
 */
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path) {
    return Response.json({ error: "`path` is required" }, { status: 400 });
  }
  try {
    const { abs, raw } = await readPlanFile(path);
    const plan = parsePlan(raw, abs);
    return Response.json({ plan });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
