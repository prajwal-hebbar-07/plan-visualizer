export type ContentBlock = {
  kind: "content";
  id: string;
  source: string;
  startLine: number;
  endLine: number;
  section: string;
  heading?: {
    depth: number;
    text: string;
    slug: string;
  };
};

export type CommentBlock = {
  kind: "comment";
  id: string;
  text: string;
  selection?: string;
  startLine: number;
  endLine: number;
  section: string;
};

export type PlanBlock = ContentBlock | CommentBlock;

export type DocumentOutlineItem = {
  depth: number;
  text: string;
  slug: string;
};

export type ParsedPlan = {
  blocks: PlanBlock[];
  outline: DocumentOutlineItem[];
  title: string | null;
  commentCount: number;
  wordCount: number;
};

function plainText(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim();
}

function slugify(value: string, used: Map<string, number>) {
  const base =
    plainText(value)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-") || "section";
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

function readComment(lines: string[], start: number) {
  if (!lines[start].trimStart().startsWith("<!--")) return null;

  let end = start;
  while (end < lines.length && !lines[end].includes("-->")) end += 1;
  if (end >= lines.length) return null;

  const raw = lines.slice(start, end + 1).join("\n");
  const inner = raw.slice(raw.indexOf("<!--") + 4, raw.lastIndexOf("-->"));
  if (!/^\s*@me\b/i.test(inner)) return null;

  const content = inner.replace(/^\s*@me\s*:?\s*/i, "").trim();
  const contentLines = content.split("\n");
  let selection: string | undefined;
  let text = content;

  if (contentLines[0]?.trim() === "Regarding:") {
    const quotedLines: string[] = [];
    let cursor = 1;
    while (cursor < contentLines.length && contentLines[cursor].startsWith(">")) {
      quotedLines.push(contentLines[cursor].replace(/^>\s?/, ""));
      cursor += 1;
    }
    while (cursor < contentLines.length && !contentLines[cursor].trim()) cursor += 1;
    if (quotedLines.length && cursor < contentLines.length) {
      selection = quotedLines.join("\n").trim();
      text = contentLines.slice(cursor).join("\n").trim();
    }
  }

  return { end, text, selection };
}

function isFence(line: string) {
  return line.match(/^\s*(`{3,}|~{3,})/i)?.[1] ?? null;
}

export function parsePlan(content: string): ParsedPlan {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: PlanBlock[] = [];
  const outline: DocumentOutlineItem[] = [];
  const usedSlugs = new Map<string, number>();
  let section = "Overview";
  let title: string | null = null;
  let i = 0;

  while (i < lines.length) {
    if (!lines[i].trim()) {
      i += 1;
      continue;
    }

    const comment = readComment(lines, i);
    if (comment) {
      blocks.push({
        kind: "comment",
        id: `comment-${i + 1}`,
        text: comment.text,
        selection: comment.selection,
        startLine: i + 1,
        endLine: comment.end + 1,
        section,
      });
      i = comment.end + 1;
      continue;
    }

    const start = i;
    const fence = isFence(lines[i]);

    if (fence) {
      i += 1;
      while (i < lines.length) {
        const closing = lines[i].match(/^\s*(`{3,}|~{3,})/i)?.[1];
        i += 1;
        if (closing?.[0] === fence[0] && closing.length >= fence.length) break;
      }
    } else {
      const headingMatch = lines[i].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (headingMatch) {
        i += 1;
      } else {
        i += 1;
        while (i < lines.length && lines[i].trim()) {
          if (readComment(lines, i) || /^(#{1,6})\s+/.test(lines[i])) break;
          i += 1;
        }
      }
    }

    const end = Math.max(start, i - 1);
    const source = lines.slice(start, end + 1).join("\n");
    const headingMatch = source.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    let heading: ContentBlock["heading"];

    if (headingMatch) {
      const text = plainText(headingMatch[2]);
      const depth = headingMatch[1].length;
      const slug = slugify(text, usedSlugs);
      heading = { depth, text, slug };
      outline.push(heading);
      section = text;
      if (depth === 1 && !title) title = text;
    }

    blocks.push({
      kind: "content",
      id: heading?.slug ?? `block-${start + 1}`,
      source,
      startLine: start + 1,
      endLine: end + 1,
      section,
      heading,
    });
  }

  const visibleText = lines
    .join("\n")
    .replace(/<!--\s*@me\b[\s\S]*?-->/gi, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#>*_`~|\[\]()!-]/g, " ");
  const wordCount = visibleText.trim()
    ? visibleText.trim().split(/\s+/).length
    : 0;

  return {
    blocks,
    outline,
    title,
    commentCount: blocks.filter((block) => block.kind === "comment").length,
    wordCount,
  };
}
