"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ContentBlock,
  parsePlan,
  type CommentBlock,
} from "@/lib/plan-document";

type DocumentData = {
  path: string;
  content: string;
  mtimeMs: number;
  size: number;
};

type SelectionPrompt = {
  target: ContentBlock;
  text: string;
  x: number;
  y: number;
  above: boolean;
};

type IconName =
  | "logo"
  | "folder"
  | "sun"
  | "moon"
  | "warning"
  | "comment"
  | "doc"
  | "shieldCheck"
  | "file"
  | "reload"
  | "play"
  | "close"
  | "toastCheck";

const ICONS: Record<IconName, { vb: string; sw: number; node: React.ReactNode }> = {
  logo: {
    vb: "0 0 16 16",
    sw: 1.5,
    node: <path d="M2.5 3h11v7.5H8.5L5.5 13.5v-3h-3z" fill="none" stroke="currentColor" strokeLinejoin="round" />,
  },
  folder: {
    vb: "0 0 16 16",
    sw: 1.3,
    node: (
      <path
        d="M1.5 4a1 1 0 0 1 1-1h3l1.5 1.5h6.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"
        fill="none"
        stroke="currentColor"
      />
    ),
  },
  sun: {
    vb: "0 0 16 16",
    sw: 1.4,
    node: (
      <>
        <circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" />
        <path
          d="M8 1.2v1.8M8 13v1.8M1.2 8H3M13 8h1.8M3.2 3.2l1.3 1.3M11.5 11.5l1.3 1.3M12.8 3.2l-1.3 1.3M4.5 11.5l-1.3 1.3"
          stroke="currentColor"
          strokeLinecap="round"
        />
      </>
    ),
  },
  moon: {
    vb: "0 0 16 16",
    sw: 1.4,
    node: (
      <path
        d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
      />
    ),
  },
  warning: {
    vb: "0 0 16 16",
    sw: 1.4,
    node: (
      <>
        <path d="M8 1.5 15 14H1z" fill="none" stroke="currentColor" strokeLinejoin="round" />
        <path d="M8 6v3.4M8 11.3v.4" stroke="currentColor" strokeLinecap="round" />
      </>
    ),
  },
  comment: {
    vb: "0 0 16 16",
    sw: 1.4,
    node: <path d="M2 3h12v8H8l-3 3v-3H2z" fill="none" stroke="currentColor" strokeLinejoin="round" />,
  },
  doc: {
    vb: "0 0 16 16",
    sw: 1.3,
    node: (
      <>
        <path d="M3 1.5h7L13 4.5V14.5H3z" fill="none" stroke="currentColor" strokeLinejoin="round" />
        <path d="M5.5 7h5M5.5 9.5h5M5.5 12h3" stroke="currentColor" strokeLinecap="round" />
      </>
    ),
  },
  shieldCheck: {
    vb: "0 0 16 16",
    sw: 1.3,
    node: (
      <>
        <path
          d="M13 5.5V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h5.5z"
          fill="none"
          stroke="currentColor"
          strokeLinejoin="round"
        />
        <path d="M6 8.5l1.5 1.5L10.5 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  file: {
    vb: "0 0 16 16",
    sw: 1.3,
    node: <path d="M3 1.5h7L13 4.5V14.5H3z" fill="none" stroke="currentColor" strokeLinejoin="round" />,
  },
  reload: {
    vb: "0 0 16 16",
    sw: 1.4,
    node: (
      <>
        <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" fill="none" stroke="currentColor" strokeLinecap="round" />
        <path d="M13.7 1.8v2.7H11" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  play: {
    vb: "0 0 16 16",
    sw: 1.4,
    node: <path d="m5 3 7 5-7 5z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" />,
  },
  close: {
    vb: "0 0 12 12",
    sw: 1.5,
    node: <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeLinecap="round" />,
  },
  toastCheck: {
    vb: "0 0 16 16",
    sw: 1.4,
    node: (
      <>
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" />
        <path d="M5.2 8.2 7.2 10l3.6-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
};

function Icon({ name, size = 13, sw }: { name: IconName; size?: number; sw?: number }) {
  const def = ICONS[name];
  return (
    <svg width={size} height={size} viewBox={def.vb} aria-hidden="true" strokeWidth={sw ?? def.sw}>
      {def.node}
    </svg>
  );
}

async function readApiError(response: Response) {
  const body = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
  return { message: body?.error ?? `Request failed (${response.status})`, code: body?.code };
}

function filename(filePath: string) {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function dirname(filePath: string) {
  const parts = filePath.split(/[\\/]/);
  parts.pop();
  return `${parts.join("/") || "/"}/`;
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function blockPreview(block: ContentBlock) {
  if (block.heading?.text) return block.heading.text;
  return block.source
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#>*_`~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function MarkdownBlock({ block }: { block: ContentBlock }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children, ...props }) => (
          <a {...props} target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
        table: ({ children, ...props }) => (
          <div className="table-scroll">
            <table {...props}>{children}</table>
          </div>
        ),
        input: ({ ...props }) => <input {...props} readOnly />,
      }}
    >
      {block.source}
    </ReactMarkdown>
  );
}

export default function Home() {
  const [pathInput, setPathInput] = useState("");
  const [document, setDocument] = useState<DocumentData | null>(null);
  const [opening, setOpening] = useState(false);
  const [picking, setPicking] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<ContentBlock | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const [selectionPrompt, setSelectionPrompt] = useState<SelectionPrompt | null>(null);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  const [gutterTop, setGutterTop] = useState<number | null>(null);

  const pathRef = useRef<HTMLInputElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  const documentPathRef = useRef<string | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const parsed = useMemo(() => (document ? parsePlan(document.content) : null), [document]);

  useEffect(() => {
    hoveredIdRef.current = hoveredBlockId;
  }, [hoveredBlockId]);

  useEffect(() => {
    documentPathRef.current = document?.path ?? null;
  }, [document?.path]);

  const showToast = useCallback((message: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const openDocument = useCallback(async (requestedPath: string): Promise<boolean> => {
    const cleanPath = requestedPath.trim();
    if (!cleanPath) {
      setOpenError("Enter the absolute path to a plan file.");
      pathRef.current?.focus();
      return false;
    }

    setPathInput(cleanPath);
    setOpening(true);
    setOpenError(null);
    try {
      const response = await fetch("/api/document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: cleanPath }),
      });
      if (!response.ok) throw new Error((await readApiError(response)).message);
      const data = (await response.json()) as DocumentData;
      setDocument(data);
      setPathInput(data.path);
      setSelectedBlock(null);
      setSelectedText("");
      setSelectionPrompt(null);
      setComment("");
      setConflict(false);
      setReviewError(null);
      window.localStorage.setItem("plan-visualizer:last-path", data.path);
      return true;
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : "Unable to open the plan.");
      return false;
    } finally {
      setOpening(false);
    }
  }, []);

  useEffect(() => {
    const queryPath = new URLSearchParams(window.location.search).get("path");
    const savedPath = window.localStorage.getItem("plan-visualizer:last-path");
    const initialPath = queryPath || savedPath;
    if (initialPath) {
      const timer = window.setTimeout(() => void openDocument(initialPath), 0);
      return () => window.clearTimeout(timer);
    }
  }, [openDocument]);

  const closeComposer = useCallback(() => {
    setSelectedBlock(null);
    setSelectedText("");
    setSelectionPrompt(null);
    setComment("");
    setCommentError(null);
  }, []);

  const saveComment = useCallback(async () => {
    if (!document || !selectedBlock || !comment.trim() || saving || reviewing) return;
    setSaving(true);
    setCommentError(null);
    try {
      const response = await fetch("/api/document", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: document.path,
          comment,
          startLine: selectedBlock.startLine,
          endLine: selectedBlock.endLine,
          anchor: selectedBlock.source,
          selection: selectedText || undefined,
          expectedMtimeMs: document.mtimeMs,
        }),
      });
      if (!response.ok) {
        const apiError = await readApiError(response);
        throw Object.assign(new Error(apiError.message), { code: apiError.code });
      }
      const data = (await response.json()) as DocumentData;
      setDocument(data);
      closeComposer();
      showToast("Note saved to the plan");
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "DOCUMENT_CHANGED") setConflict(true);
      setCommentError(error instanceof Error ? error.message : "Unable to save the comment.");
    } finally {
      setSaving(false);
    }
  }, [comment, document, reviewing, saving, selectedBlock, selectedText, closeComposer, showToast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        pathRef.current?.focus();
        pathRef.current?.select();
        return;
      }
      if (event.key === "Escape") {
        if (selectedBlock) closeComposer();
        else if (selectionPrompt) setSelectionPrompt(null);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && selectedBlock && comment.trim()) {
        event.preventDefault();
        void saveComment();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedBlock, selectionPrompt, comment, closeComposer, saveComment]);

  // Selection pill tracking
  useEffect(() => {
    if (!document || !parsed) return;

    let frame = 0;
    const updateSelection = (event?: Event) => {
      const eventTarget = event?.target;
      if (eventTarget instanceof Element && eventTarget.closest(".pv-pill, .pv-review")) return;

      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount) {
          setSelectionPrompt(null);
          return;
        }

        const text = selection.toString().replace(/ /g, " ").replace(/\s+/g, " ").trim();
        if (!text || text.length < 3) {
          setSelectionPrompt(null);
          return;
        }

        const range = selection.getRangeAt(0);
        const elementForNode = (node: Node) => (node instanceof Element ? node : node.parentElement);
        const startElement = elementForNode(range.startContainer)?.closest<HTMLElement>(
          ".pv-block[data-start-line]",
        );
        const endElement = elementForNode(range.endContainer)?.closest<HTMLElement>(".pv-block[data-end-line]");
        if (!startElement || !endElement) {
          setSelectionPrompt(null);
          return;
        }

        const startLine = Number(startElement.dataset.startLine);
        const endLine = Number(endElement.dataset.endLine);
        const firstLine = Math.min(startLine, endLine);
        const lastLine = Math.max(startLine, endLine);
        const baseBlock = parsed.blocks.find(
          (block): block is ContentBlock => block.kind === "content" && block.startLine === firstLine,
        );
        if (!baseBlock || !Number.isInteger(firstLine) || !Number.isInteger(lastLine)) {
          setSelectionPrompt(null);
          return;
        }

        const source = document.content
          .replace(/\r\n?/g, "\n")
          .split("\n")
          .slice(firstLine - 1, lastLine)
          .join("\n");
        const rect = range.getBoundingClientRect();
        if (!rect.width && !rect.height) return;
        const above = rect.top > 74;
        const x = Math.min(Math.max(rect.left + rect.width / 2, 80), window.innerWidth - 80);
        const y = above ? rect.top - 9 : rect.bottom + 9;

        setSelectionPrompt({
          target: { ...baseBlock, source, startLine: firstLine, endLine: lastLine },
          text: text.length > 2000 ? `${text.slice(0, 1999)}…` : text,
          x,
          y,
          above,
        });
      });
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.shiftKey) updateSelection(event);
    };
    const hideOnScroll = () => setSelectionPrompt(null);
    window.document.addEventListener("pointerup", updateSelection);
    window.document.addEventListener("keyup", handleKeyUp);
    window.addEventListener("scroll", hideOnScroll, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.document.removeEventListener("pointerup", updateSelection);
      window.document.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("scroll", hideOnScroll, true);
    };
  }, [document, parsed]);

  // Gutter comment control tracks the hovered block
  useEffect(() => {
    if (!document) return;
    const onOver = (event: MouseEvent) => {
      const surface = surfaceRef.current;
      if (!surface) return;
      const target = event.target as Element | null;
      if (!target) return;
      if (target.closest?.(".pv-gutter-btn")) return;
      const block = target.closest?.(".pv-block") as HTMLElement | null;
      if (block && surface.contains(block)) {
        const top = Math.max(6, Math.round(block.getBoundingClientRect().top - surface.getBoundingClientRect().top));
        const id = block.dataset.blockId ?? null;
        setHoveredBlockId((prev) => (prev === id ? prev : id));
        setGutterTop(top);
      } else if (!surface.contains(target)) {
        setHoveredBlockId(null);
      }
    };
    const onScroll = () => {
      const surface = surfaceRef.current;
      const id = hoveredIdRef.current;
      if (!surface || !id) return;
      const blocks = surface.querySelectorAll<HTMLElement>(".pv-block");
      for (const block of blocks) {
        if (block.dataset.blockId === id) {
          setGutterTop(Math.max(6, Math.round(block.getBoundingClientRect().top - surface.getBoundingClientRect().top)));
          return;
        }
      }
    };
    window.document.addEventListener("mouseover", onOver);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.document.removeEventListener("mouseover", onOver);
      window.removeEventListener("scroll", onScroll);
    };
  }, [document]);

  // Active outline section tracking
  useEffect(() => {
    if (!document || !parsed || !parsed.outline.length) return;
    const slugs = parsed.outline.map((item) => item.slug);
    const update = () => {
      let current = slugs[0];
      for (const slug of slugs) {
        const el = window.document.getElementById(slug);
        if (el && el.getBoundingClientRect().top < 150) current = slug;
      }
      setActiveSlug(current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [document, parsed]);

  const openDocumentAndToast = useCallback(
    async (path: string) => {
      const ok = await openDocument(path);
      if (ok) showToast(`Opened ${filename(path.trim())}`);
    },
    [openDocument, showToast],
  );

  const openPathAction = () => void openDocumentAndToast(pathInput);

  const toggleTheme = () => {
    const current = window.document.documentElement.getAttribute("data-pv-theme");
    const next = current === "dark" ? "light" : "dark";
    window.document.documentElement.setAttribute("data-pv-theme", next);
    try {
      window.localStorage.setItem("pv-theme", next);
    } catch {}
  };

  const pickPlan = useCallback(async () => {
    if (picking) return;
    setPicking(true);
    setOpenError(null);
    try {
      const response = await fetch("/api/document/pick", { method: "POST" });
      if (response.status === 204) return;
      if (!response.ok) throw new Error((await readApiError(response)).message);
      const data = (await response.json()) as { path: string };
      const ok = await openDocument(data.path);
      if (ok) showToast(`Opened ${filename(data.path)}`);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : "Unable to choose a plan.");
    } finally {
      setPicking(false);
    }
  }, [openDocument, picking, showToast]);

  const chooseBlock = (block: ContentBlock, selection = "") => {
    if (reviewing) return;
    setSelectedBlock(block);
    setSelectedText(selection);
    setSelectionPrompt(null);
    setComment("");
    setCommentError(null);
    window.setTimeout(() => commentRef.current?.focus(), 60);
  };

  const onGutterClick = () => {
    if (!hoveredBlockId || !parsed) return;
    const block = parsed.blocks.find(
      (candidate): candidate is ContentBlock => candidate.kind === "content" && candidate.id === hoveredBlockId,
    );
    if (block) chooseBlock(block);
  };

  const reload = useCallback(async () => {
    if (!document || reloading) return;
    setReloading(true);
    const ok = await openDocument(document.path);
    setReloading(false);
    if (ok) showToast("Reloaded from disk");
  }, [document, openDocument, reloading, showToast]);

  const runPlanReview = useCallback(async () => {
    if (!document || reviewing) return;

    const reviewedPath = document.path;
    setReviewing(true);
    setReviewError(null);
    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: reviewedPath }),
      });
      if (!response.ok) throw new Error((await readApiError(response)).message);

      if (documentPathRef.current === reviewedPath) {
        const refreshed = await openDocument(reviewedPath);
        if (!refreshed) throw new Error("Claude finished, but the updated plan could not be reloaded.");
      }
      showToast("Claude finished the plan review");
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "Claude could not run the plan review.");
    } finally {
      setReviewing(false);
    }
  }, [document, openDocument, reviewing, showToast]);

  const jumpTo = (id: string) => {
    const el = window.document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    el.classList.remove("pv-flash");
    void el.offsetWidth;
    el.classList.add("pv-flash");
    window.setTimeout(() => el.classList.remove("pv-flash"), 1300);
  };

  const comments = parsed?.blocks.filter((block): block is CommentBlock => block.kind === "comment") ?? [];
  const title = parsed?.title ?? (document ? filename(document.path).replace(/\.(md|markdown)$/i, "") : "");
  const titleBlock = parsed?.blocks.find(
    (block): block is ContentBlock => block.kind === "content" && block.heading?.depth === 1,
  );
  const wordCount = parsed?.wordCount ?? 0;
  const readMinutes = Math.max(1, Math.ceil(wordCount / 210));

  return (
    <div style={{ minHeight: "100vh" }}>
      {/* ============ HEADER ============ */}
      <header className="pv-header">
        <div className="pv-header-inner">
          <Link className="pv-brand" href="/" aria-label="Plan Visualizer home">
            <span className="pv-brand-mark">
              <Icon name="logo" size={12} />
            </span>
            <span className="pv-brand-name">Plan Visualizer</span>
          </Link>

          <div className="pv-path">
            <span className="pv-path-icon">
              <Icon name="folder" size={13} />
            </span>
            <input
              ref={pathRef}
              className={`pv-path-input${openError ? " is-error" : ""}`}
              aria-label="Absolute path to a Markdown plan file"
              spellCheck={false}
              value={pathInput}
              onChange={(event) => {
                setPathInput(event.target.value);
                setOpenError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") openPathAction();
              }}
              placeholder="/absolute/path/to/plans/plan-feature.md"
            />
            <kbd className="pv-kbd">⌘O</kbd>
          </div>

          <button
            className="pv-btn-quiet"
            type="button"
            onClick={() => void pickPlan()}
            disabled={picking}
            title="Open the native file picker"
          >
            <Icon name="folder" size={12} />
            {picking ? "Opening…" : "Browse…"}
          </button>
          <button className="pv-btn-primary" type="button" onClick={openPathAction} disabled={opening}>
            {opening ? "Opening…" : "Preview"}
          </button>

          <div className="pv-divider" />

          <button
            className="pv-icon-btn"
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle color theme"
            title="Toggle light and dark mode"
          >
            <span className="pv-theme-moon">
              <Icon name="moon" size={14} />
            </span>
            <span className="pv-theme-sun">
              <Icon name="sun" size={14} />
            </span>
          </button>

          <div className="pv-local" title="Files never leave this machine">
            <span />
            <small>Local only</small>
          </div>
        </div>

        {openError && (
          <div className="pv-path-error" role="alert">
            <div className="pv-path-error-inner">
              <Icon name="warning" size={13} />
              <span className="msg">{openError}</span>
              <span className="hint">
                Enter an absolute path ending in <code>.md</code>, or use Browse.
              </span>
              <button type="button" onClick={() => setOpenError(null)} aria-label="Dismiss error">
                <Icon name="close" size={11} />
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ============ EMPTY STATE ============ */}
      {!document ? (
        <main className="pv-empty">
          <div className="pv-empty-inner">
            <div className="pv-empty-icon">
              <Icon name="logo" size={20} sw={1.4} />
            </div>
            <h1 className="pv-empty-title">Read, review, and annotate implementation plans.</h1>
            <p className="pv-empty-copy">
              Plan Visualizer renders a local Markdown plan as a beautiful document. Your review notes are written back
              into the original file, ready for a coding agent to resolve.
            </p>
            <button
              className="pv-btn-primary pv-btn-lg"
              type="button"
              onClick={() => void pickPlan()}
              disabled={picking}
            >
              {picking ? "Opening file chooser…" : "Choose a plan file"}
            </button>
            <div className="pv-empty-kbd-hint">
              or press <kbd>⌘O</kbd> and paste an absolute path above
            </div>

            <div className="pv-features">
              <div className="pv-feature">
                <Icon name="doc" size={15} />
                <strong>Beautiful preview</strong>
                <p>Editorial typography for headings, code, tables, and task lists.</p>
              </div>
              <div className="pv-feature">
                <Icon name="comment" size={15} sw={1.3} />
                <strong>Contextual comments</strong>
                <p>Annotate whole blocks or the exact sentence you selected.</p>
              </div>
              <div className="pv-feature">
                <Icon name="shieldCheck" size={15} />
                <strong>File-native workflow</strong>
                <p>Notes update the original Markdown — no database, no account.</p>
              </div>
            </div>

            <div className="pv-empty-note">
              Comments are saved into the document as <code>&lt;!-- @me: … --&gt;</code> markers.
            </div>
          </div>
        </main>
      ) : (
        /* ============ WORKSPACE ============ */
        <div className="pv-workspace">
          {/* Outline */}
          <aside className="pv-outline" aria-label="Document outline">
            <div className="pv-outline-label">On this page</div>
            <nav className="pv-outline-nav">
              {parsed?.outline.map((item) => (
                <button
                  key={item.slug}
                  type="button"
                  className={`pv-outline-link depth-${item.depth}${activeSlug === item.slug ? " is-active" : ""}`}
                  onClick={() => jumpTo(item.slug)}
                >
                  {item.text}
                </button>
              ))}
              {!parsed?.outline.length && <span className="pv-outline-empty">No headings found</span>}
            </nav>
            <div className="pv-outline-meta">
              {wordCount.toLocaleString()} words
              <br />
              {readMinutes} min read
            </div>
          </aside>

          {/* Document */}
          <main className="pv-doc">
            {conflict && (
              <div className="pv-conflict" role="alert">
                <Icon name="warning" size={15} />
                <div className="pv-conflict-body">
                  <strong>{filename(document.path)} changed on disk</strong>
                  <span>Another process edited this file. Reload to pick up the changes.</span>
                </div>
                <button
                  className="pv-btn-primary"
                  type="button"
                  onClick={() => {
                    setConflict(false);
                    void reload();
                  }}
                >
                  Reload file
                </button>
                <button className="pv-conflict-dismiss" type="button" onClick={() => setConflict(false)}>
                  Keep my view
                </button>
              </div>
            )}

            <div className="pv-doc-meta">
              <span className="doc-icon">
                <Icon name="file" size={13} />
              </span>
              <span className="file-name">{filename(document.path)}</span>
              <span className="dir-path">{dirname(document.path)}</span>
              <span className="spacer" />
              <button
                className={`pv-reload-btn${reloading ? " is-spinning" : ""}`}
                type="button"
                onClick={() => void reload()}
                disabled={reloading}
                title="Reload from disk"
                aria-label="Reload from disk"
              >
                <Icon name="reload" size={13} />
              </button>
            </div>

            <article className="pv-surface" ref={surfaceRef}>
              {!reviewing && hoveredBlockId && gutterTop !== null && (
                <button
                  className="pv-gutter-btn"
                  type="button"
                  style={{ top: gutterTop }}
                  onClick={onGutterClick}
                  title="Comment on this block"
                  aria-label="Comment on this block"
                >
                  <Icon name="comment" size={13} />
                </button>
              )}

              <h1 className="pv-doc-title">{title}</h1>
              <div className="pv-doc-sub">Implementation plan</div>

              {parsed?.blocks.map((block) => {
                if (block.kind === "content" && block.id === titleBlock?.id) return null;
                if (block.kind === "comment") {
                  return (
                    <aside className="pv-note" id={block.id} key={block.id}>
                      <div className="pv-note-head">
                        <Icon name="comment" size={12} sw={1.5} />
                        <span className="pv-note-label">Your review note</span>
                        <span className="pv-note-badge">Pending review</span>
                      </div>
                      {block.selection && <div className="pv-note-quote">“{block.selection}”</div>}
                      <div className="pv-note-text">{block.text}</div>
                    </aside>
                  );
                }
                return (
                  <section
                    key={`${block.id}-${block.startLine}`}
                    id={block.id}
                    className={`pv-block${block.heading ? ` is-heading depth-${block.heading.depth}` : ""}${selectedBlock?.id === block.id ? " is-selected" : ""}`}
                    data-block-id={block.id}
                    data-start-line={block.startLine}
                    data-end-line={block.endLine}
                  >
                    <div className="markdown-body">
                      <MarkdownBlock block={block} />
                    </div>
                  </section>
                );
              })}
            </article>
          </main>

          {/* Review panel */}
          <aside className={`pv-review${selectedBlock ? " is-composing" : ""}`} aria-label="Review notes">
            {selectedBlock ? (
              <div className="pv-composer">
                <div className="pv-composer-head">
                  <Icon name="comment" size={13} />
                  <strong>{selectedText ? "Note on selection" : "New review note"}</strong>
                  <button
                    className="pv-composer-close"
                    type="button"
                    onClick={closeComposer}
                    title="Close (Esc)"
                    aria-label="Close composer"
                  >
                    <Icon name="close" size={11} />
                  </button>
                </div>
                <div className="pv-composer-ref">
                  <span className="section">{selectedBlock.section}</span>
                  <span className="line">L{selectedBlock.startLine}</span>
                </div>

                {selectedText ? (
                  <>
                    <div className="pv-composer-cap">Selected text</div>
                    <div className="pv-composer-quote">“{selectedText}”</div>
                  </>
                ) : (
                  <>
                    <div className="pv-composer-cap">Block</div>
                    <div className="pv-composer-preview">{blockPreview(selectedBlock)}</div>
                  </>
                )}

                <label className="pv-composer-label" htmlFor="pv-comment">
                  {selectedText ? "What should change about this selection?" : "What should change?"}
                </label>
                <textarea
                  id="pv-comment"
                  ref={commentRef}
                  className="pv-composer-textarea"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      void saveComment();
                    }
                  }}
                  placeholder="Describe the change you want the agent to make…"
                  rows={4}
                  maxLength={4000}
                />

                {commentError && (
                  <div className="pv-composer-error" role="alert">
                    {commentError}
                  </div>
                )}

                <div className="pv-composer-actions">
                  <span className="pv-composer-meta">
                    {comment.length} chars · <code>⌘↵</code> saves
                  </span>
                  <span className="spacer" />
                  <button className="pv-btn-cancel" type="button" onClick={closeComposer}>
                    Cancel
                  </button>
                  <button
                    className="pv-btn-save"
                    type="button"
                    onClick={() => void saveComment()}
                    disabled={saving || reviewing || !comment.trim()}
                  >
                    {saving ? "Saving…" : "Save note"}
                  </button>
                </div>

                <div className="pv-composer-foot">
                  Saved as an <code>@me</code> marker in {filename(document.path)} — the original file is updated in
                  place.
                </div>
              </div>
            ) : (
              <>
                <div className="pv-review-head">
                  <strong>Review notes</strong>
                  {comments.length > 0 && <span className="count">{comments.length} pending</span>}
                </div>

                <div className="pv-review-run">
                  <button type="button" onClick={() => void runPlanReview()} disabled={reviewing}>
                    <Icon name={reviewing ? "reload" : "play"} size={12} />
                    {reviewing ? "Claude is reviewing…" : "Run plan review"}
                  </button>
                  <span>
                    {reviewing
                      ? "Claude will update the plan when the review is complete."
                      : comments.length > 0
                        ? `Resolve ${comments.length} ${comments.length === 1 ? "note" : "notes"} with Claude.`
                        : "Ask Claude to finalize this review round."}
                  </span>
                  {reviewError && (
                    <div className="pv-review-run-error" role="alert">
                      {reviewError}
                    </div>
                  )}
                </div>

                {comments.length === 0 ? (
                  <div className="pv-review-empty">
                    <Icon name="comment" size={18} sw={1.3} />
                    <strong>No review notes yet</strong>
                    <p>
                      Hover any block and click the round control in the margin, or select text in the document to
                      comment on it.
                    </p>
                  </div>
                ) : (
                  comments.map((item) => (
                    <button key={item.id} className="pv-card" type="button" onClick={() => jumpTo(item.id)}>
                      <div className="pv-card-top">
                        <span className="pv-card-section">{item.section}</span>
                        <span className="pv-card-line">L{item.startLine}</span>
                      </div>
                      {item.selection && <div className="pv-card-quote">“{item.selection}”</div>}
                      <div className="pv-card-text">{item.text}</div>
                      <div className="pv-card-status">
                        <span />
                        <small>Pending review</small>
                      </div>
                    </button>
                  ))
                )}

                <div className="pv-review-foot">
                  Notes are written into the file as <code>&lt;!-- @me --&gt;</code> markers, ready for your plan-review
                  workflow to resolve.
                </div>
              </>
            )}
          </aside>
        </div>
      )}

      {/* ============ SELECTION PILL ============ */}
      {selectionPrompt && !selectedBlock && !reviewing && (
        <div
          className="pv-pill-wrap"
          style={{
            left: selectionPrompt.x,
            top: selectionPrompt.y,
            transform: selectionPrompt.above ? "translate(-50%,-100%)" : "translate(-50%,0)",
            flexDirection: selectionPrompt.above ? "column" : "column-reverse",
          }}
        >
          <button
            className="pv-pill"
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              chooseBlock(selectionPrompt.target, selectionPrompt.text);
              window.getSelection()?.removeAllRanges();
            }}
          >
            <Icon name="comment" size={12} sw={1.5} />
            Comment
          </button>
          <span
            className="pv-pill-tick"
            aria-hidden="true"
            style={
              selectionPrompt.above
                ? { transform: "rotate(45deg) translate(-3px,-3px)", marginTop: -4 }
                : { transform: "rotate(225deg) translate(-3px,-3px)", marginBottom: -4 }
            }
          />
        </div>
      )}

      {/* ============ TOAST ============ */}
      {toast && (
        <div className="pv-toast" role="status">
          <Icon name="toastCheck" size={13} />
          {toast}
        </div>
      )}
    </div>
  );
}
