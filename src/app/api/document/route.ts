import { chmod, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { MAX_PLAN_FILE_BYTES, resolvePlanPath } from "@/lib/plan-file";

export const runtime = "nodejs";

type DocumentPayload = {
  path: string;
  content: string;
  mtimeMs: number;
  size: number;
};

function errorResponse(message: string, status: number, code?: string) {
  return Response.json({ error: message, code }, { status });
}

async function readDocument(filePath: string): Promise<DocumentPayload> {
  const fileStat = await stat(filePath);
  if (fileStat.size > MAX_PLAN_FILE_BYTES) {
    throw new Error("The plan is larger than the 5 MB preview limit.");
  }

  return {
    path: filePath,
    content: await readFile(filePath, "utf8"),
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
  };
}

function formatComment(comment: string, selection?: string) {
  const safeComment = comment.replace(/--+/g, "—").trim();
  if (selection) {
    const quotedSelection = selection
      .replace(/--+/g, "—")
      .trim()
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    return `<!-- @me:\nRegarding:\n${quotedSelection}\n\n${safeComment}\n-->`;
  }
  if (!safeComment.includes("\n")) return `<!-- @me: ${safeComment} -->`;
  return `<!-- @me:\n${safeComment}\n-->`;
}

function insertComment(content: string, endLine: number, comment: string, selection?: string) {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const hadFinalNewline = content.endsWith("\n");
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  if (hadFinalNewline) lines.pop();

  const insertionIndex = endLine;
  const additions: string[] = [];
  if (insertionIndex > 0 && lines[insertionIndex - 1]?.trim()) additions.push("");
  additions.push(formatComment(comment, selection));
  if (lines[insertionIndex]?.trim()) additions.push("");
  lines.splice(insertionIndex, 0, ...additions);

  return `${lines.join(newline)}${hadFinalNewline ? newline : ""}`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { path?: unknown };
    const filePath = await resolvePlanPath(body.path);
    return Response.json(await readDocument(filePath));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to open the plan.";
    return errorResponse(message, 400);
  }
}

export async function PATCH(request: Request) {
  let temporaryPath: string | null = null;

  try {
    const body = (await request.json()) as {
      path?: unknown;
      comment?: unknown;
      startLine?: unknown;
      endLine?: unknown;
      anchor?: unknown;
      selection?: unknown;
      expectedMtimeMs?: unknown;
    };
    const filePath = await resolvePlanPath(body.path);

    if (typeof body.comment !== "string" || !body.comment.trim()) {
      return errorResponse("Write a comment before saving.", 400);
    }
    if (body.comment.length > 4000) {
      return errorResponse("Comments are limited to 4,000 characters.", 400);
    }
    if (body.selection !== undefined && typeof body.selection !== "string") {
      return errorResponse("The selected text is invalid.", 400);
    }
    if (typeof body.selection === "string" && body.selection.length > 2000) {
      return errorResponse("Text selections are limited to 2,000 characters.", 400);
    }
    if (
      !Number.isInteger(body.startLine) ||
      !Number.isInteger(body.endLine) ||
      (body.startLine as number) < 1 ||
      (body.endLine as number) < (body.startLine as number)
    ) {
      return errorResponse("The selected document block is invalid.", 400);
    }
    if (typeof body.anchor !== "string" || typeof body.expectedMtimeMs !== "number") {
      return errorResponse("The document version is missing. Reload and try again.", 400);
    }

    const current = await readDocument(filePath);
    if (Math.abs(current.mtimeMs - body.expectedMtimeMs) > 0.01) {
      return errorResponse(
        "The plan changed on disk. Reload it before adding this comment.",
        409,
        "DOCUMENT_CHANGED",
      );
    }

    const normalizedLines = current.content.replace(/\r\n?/g, "\n").split("\n");
    const currentAnchor = normalizedLines
      .slice((body.startLine as number) - 1, body.endLine as number)
      .join("\n");
    if (currentAnchor !== body.anchor) {
      return errorResponse(
        "The selected text changed on disk. Reload it before adding this comment.",
        409,
        "DOCUMENT_CHANGED",
      );
    }

    const updatedContent = insertComment(
      current.content,
      body.endLine as number,
      body.comment,
      typeof body.selection === "string" ? body.selection.trim() : undefined,
    );
    const currentStat = await stat(filePath);
    temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, updatedContent, {
      encoding: "utf8",
      mode: currentStat.mode,
      flag: "wx",
    });
    await chmod(temporaryPath, currentStat.mode);
    await rename(temporaryPath, filePath);
    temporaryPath = null;

    return Response.json(await readDocument(filePath));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update the plan.";
    return errorResponse(message, 400);
  } finally {
    if (temporaryPath) await unlink(temporaryPath).catch(() => undefined);
  }
}
