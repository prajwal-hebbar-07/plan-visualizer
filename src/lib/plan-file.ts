/**
 * Shared validation for user-supplied plan paths, used by the document and
 * review routes. A plan must be an absolute `.md`/`.markdown` file that exists
 * and is under the preview size limit; anything else throws a message safe to
 * show the user. Paths are resolved with `realpath` before use.
 */
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export const MAX_PLAN_FILE_BYTES = 5 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([".md", ".markdown"]);

export async function resolvePlanPath(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Enter an absolute path to a Markdown plan.");
  }

  const requestedPath = value.trim();
  if (!path.isAbsolute(requestedPath)) {
    throw new Error("The plan path must be absolute.");
  }
  if (!ALLOWED_EXTENSIONS.has(path.extname(requestedPath).toLowerCase())) {
    throw new Error("The plan must be a .md or .markdown file.");
  }

  const filePath = await realpath(requestedPath);
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error("That path does not point to a file.");
  if (fileStat.size > MAX_PLAN_FILE_BYTES) {
    throw new Error("The plan is larger than the 5 MB preview limit.");
  }

  return filePath;
}
