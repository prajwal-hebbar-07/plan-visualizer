import { readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { config } from "@/lib/env";

/** The single directory the app is allowed to read plans from / write into. */
export const PLANS_ROOT = resolve(config.plansDir);

/**
 * Resolve a user-supplied path and confine it to {@link PLANS_ROOT}.
 * Accepts either an absolute path inside the root or a path relative to it.
 * Throws if the result escapes the root — the only trust boundary in the app.
 */
export function safeResolve(userPath: string): string {
  const abs = isAbsolute(userPath)
    ? resolve(userPath)
    : resolve(PLANS_ROOT, userPath);
  const rel = relative(PLANS_ROOT, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Path is outside the allowed plans directory");
  }
  return abs;
}

export interface DirEntry {
  name: string;
  /** Path relative to PLANS_ROOT (what the client passes back). */
  path: string;
  isDir: boolean;
}

/** List `.md` files and subdirectories directly under `relDir` (relative to root). */
export async function listPlans(relDir = ""): Promise<{
  root: string;
  dir: string;
  parent: string | null;
  entries: DirEntry[];
}> {
  const absDir = relDir ? safeResolve(relDir) : PLANS_ROOT;
  const dirents = await readdir(absDir, { withFileTypes: true });

  const entries: DirEntry[] = [];
  for (const d of dirents) {
    if (d.name.startsWith(".")) continue;
    const isDir = d.isDirectory();
    if (!isDir && !d.name.toLowerCase().endsWith(".md")) continue;
    entries.push({
      name: d.name,
      path: relative(PLANS_ROOT, join(absDir, d.name)),
      isDir,
    });
  }
  entries.sort((a, b) =>
    a.isDir === b.isDir
      ? a.name.localeCompare(b.name)
      : a.isDir
        ? -1
        : 1,
  );

  const rel = relative(PLANS_ROOT, absDir);
  const parent =
    absDir === PLANS_ROOT ? null : rel.split(sep).slice(0, -1).join(sep);

  return { root: PLANS_ROOT, dir: rel, parent, entries };
}

export async function readPlanFile(userPath: string): Promise<{
  abs: string;
  raw: string;
}> {
  const abs = safeResolve(userPath);
  const raw = await readFile(abs, "utf8");
  return { abs, raw };
}

export async function writePlanFile(
  userPath: string,
  content: string,
): Promise<void> {
  const abs = safeResolve(userPath);
  await writeFile(abs, content, "utf8");
}
