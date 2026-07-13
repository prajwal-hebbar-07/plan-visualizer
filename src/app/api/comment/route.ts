import type { NextRequest } from "next/server";
import { readPlanFile, writePlanFile } from "@/lib/plan/fs";
import { addComment, removeComment } from "@/lib/plan/comments";
import { parsePlan } from "@/lib/plan/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/comment — add an `@me` review note to a plan file, anchored under
 * a step (or appended). Writes the file and returns the re-parsed plan.
 *
 * Body: { path, text, stepNumber?, author? }
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const path = typeof body.path === "string" ? body.path : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!path) return Response.json({ error: "`path` is required" }, { status: 400 });
  if (!text) return Response.json({ error: "`text` is required" }, { status: 400 });

  const stepNumber =
    typeof body.stepNumber === "number" ? body.stepNumber : undefined;
  const author = typeof body.author === "string" ? body.author : undefined;

  try {
    const { abs, raw } = await readPlanFile(path);
    const next = addComment(raw, abs, { stepNumber, author, text });
    await writePlanFile(path, next);
    return Response.json({ plan: parsePlan(next, abs) });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

/**
 * DELETE /api/comment — remove a previously-added note by its exact raw text.
 * Body: { path, raw }
 */
export async function DELETE(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const path = typeof body.path === "string" ? body.path : "";
  const rawComment = typeof body.raw === "string" ? body.raw : "";
  if (!path || !rawComment) {
    return Response.json({ error: "`path` and `raw` are required" }, { status: 400 });
  }
  try {
    const { abs, raw } = await readPlanFile(path);
    const next = removeComment(raw, rawComment);
    await writePlanFile(path, next);
    return Response.json({ plan: parsePlan(next, abs) });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
