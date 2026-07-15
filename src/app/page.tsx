"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  placement: "above" | "below";
};

type IconName =
  | "arrow"
  | "check"
  | "comment"
  | "document"
  | "folder"
  | "moon"
  | "refresh"
  | "sparkle"
  | "sun"
  | "x";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    comment: <><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="M8 9h8M8 13h5"/></>,
    document: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></>,
    folder: <><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></>,
    moon: <path d="M20.5 14.1A8.5 8.5 0 0 1 9.9 3.5 8.5 8.5 0 1 0 20.5 14.1Z"/>,
    refresh: <><path d="M20 7h-5V2"/><path d="M20 2v5h-5M20 7a8 8 0 1 0 1 5"/></>,
    sparkle: <><path d="m12 3-1.2 3.8L7 8l3.8 1.2L12 13l1.2-3.8L17 8l-3.8-1.2Z"/><path d="m5 14-.7 2.3L2 17l2.3.7L5 20l.7-2.3L8 17l-2.3-.7Z"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/></>,
    x: <><path d="m6 6 12 12M18 6 6 18"/></>,
  };

  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
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
  return parts.join("/") || "/";
}

function CommentCard({ comment, onNavigate }: { comment: CommentBlock; onNavigate?: () => void }) {
  return (
    <button className="review-card" onClick={onNavigate} type="button">
      <span className="review-card-topline">
        <span>{comment.section}</span>
        <span>Line {comment.startLine}</span>
      </span>
      {comment.selection && <span className="review-card-selection">“{comment.selection}”</span>}
      <span className="review-card-text">{comment.text}</span>
      <span className="review-status"><span /> Pending review</span>
    </button>
  );
}

function MarkdownBlock({ block }: { block: ContentBlock }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a>,
        table: ({ children, ...props }) => <div className="table-scroll"><table {...props}>{children}</table></div>,
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
  const [openError, setOpenError] = useState<string | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<ContentBlock | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const [selectionPrompt, setSelectionPrompt] = useState<SelectionPrompt | null>(null);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const pathRef = useRef<HTMLInputElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  const parsed = useMemo(
    () => (document ? parsePlan(document.content) : null),
    [document],
  );

  const openDocument = useCallback(async (requestedPath: string) => {
    const cleanPath = requestedPath.trim();
    if (!cleanPath) {
      setOpenError("Enter the absolute path to a plan file.");
      pathRef.current?.focus();
      return;
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
      window.localStorage.setItem("plan-visualizer:last-path", data.path);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : "Unable to open the plan.");
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        pathRef.current?.focus();
        pathRef.current?.select();
      }
      if (event.key === "Escape" && selectedBlock) {
        setSelectedBlock(null);
        setSelectedText("");
        setSelectionPrompt(null);
        setComment("");
        setCommentError(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedBlock]);

  useEffect(() => {
    if (!document || !parsed) return;

    let frame = 0;
    const updateSelection = (event?: Event) => {
      const eventTarget = event?.target;
      if (
        eventTarget instanceof Element &&
        eventTarget.closest(".selection-comment-action, .review-panel")
      ) return;

      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount) {
          setSelectionPrompt(null);
          return;
        }

        const text = selection.toString().replace(/\u00a0/g, " ").trim();
        if (!text) {
          setSelectionPrompt(null);
          return;
        }

        const range = selection.getRangeAt(0);
        const elementForNode = (node: Node) =>
          node instanceof Element ? node : node.parentElement;
        const startElement = elementForNode(range.startContainer)?.closest<HTMLElement>(
          ".reviewable-block[data-start-line]",
        );
        const endElement = elementForNode(range.endContainer)?.closest<HTMLElement>(
          ".reviewable-block[data-end-line]",
        );
        if (!startElement || !endElement) {
          setSelectionPrompt(null);
          return;
        }

        const startLine = Number(startElement.dataset.startLine);
        const endLine = Number(endElement.dataset.endLine);
        const firstLine = Math.min(startLine, endLine);
        const lastLine = Math.max(startLine, endLine);
        const baseBlock = parsed.blocks.find(
          (block): block is ContentBlock =>
            block.kind === "content" && block.startLine === firstLine,
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
        const placement = rect.top >= 54 ? "above" : "below";
        const x = Math.min(window.innerWidth - 68, Math.max(68, rect.left + rect.width / 2));
        const y = placement === "above" ? rect.top - 44 : rect.bottom + 10;

        setSelectionPrompt({
          target: {
            ...baseBlock,
            source,
            startLine: firstLine,
            endLine: lastLine,
          },
          text: text.length > 2000 ? `${text.slice(0, 1999)}…` : text,
          x,
          y,
          placement,
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

  const submitPath = (event: FormEvent) => {
    event.preventDefault();
    void openDocument(pathInput);
  };

  const toggleTheme = () => {
    const currentTheme = window.document.documentElement.dataset.theme;
    const nextTheme = currentTheme === "dark" ? "light" : "dark";
    window.document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("plan-visualizer:theme", nextTheme);
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
      await openDocument(data.path);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : "Unable to choose a plan.");
    } finally {
      setPicking(false);
    }
  }, [openDocument, picking]);

  const chooseBlock = (block: ContentBlock, selection = "") => {
    setSelectedBlock(block);
    setSelectedText(selection);
    setSelectionPrompt(null);
    setComment("");
    setCommentError(null);
    window.setTimeout(() => commentRef.current?.focus(), 80);
  };

  const saveComment = useCallback(async () => {
    if (!document || !selectedBlock || !comment.trim() || saving) return;
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
      setSelectedBlock(null);
      setSelectedText("");
      setSelectionPrompt(null);
      setComment("");
      setToast("Comment saved to the plan");
      window.setTimeout(() => setToast(null), 2600);
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : "Unable to save the comment.");
    } finally {
      setSaving(false);
    }
  }, [comment, document, saving, selectedBlock, selectedText]);

  const reload = useCallback(async () => {
    if (!document) return;
    await openDocument(document.path);
    setToast("Plan reloaded from disk");
    window.setTimeout(() => setToast(null), 2200);
  }, [document, openDocument]);

  const comments = parsed?.blocks.filter((block): block is CommentBlock => block.kind === "comment") ?? [];
  const title = parsed?.title ?? (document ? filename(document.path).replace(/\.(md|markdown)$/i, "") : "");
  const titleBlock = parsed?.blocks.find(
    (block): block is ContentBlock => block.kind === "content" && block.heading?.depth === 1,
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Plan Visualizer home">
          <span className="brand-mark"><Icon name="document" size={17} /></span>
          <span>Plan Visualizer</span>
        </Link>
        <form className="path-form" onSubmit={submitPath}>
          <button
            className="path-picker-button"
            type="button"
            onClick={() => void pickPlan()}
            disabled={picking}
            aria-label="Choose a plan file"
            title="Choose a plan file"
          >
            <Icon name="folder" size={16} />
          </button>
          <input
            ref={pathRef}
            aria-label="Absolute path to plan file"
            value={pathInput}
            onChange={(event) => setPathInput(event.target.value)}
            placeholder="/absolute/path/to/plans/plan-feature.md"
            spellCheck={false}
          />
          <button className="path-submit-button" type="submit" disabled={opening || !pathInput.trim()}>
            {opening ? "Opening…" : document ? "Open" : "Preview"}
            {!opening && <Icon name="arrow" size={15} />}
          </button>
        </form>
        <div className="topbar-actions">
          <button
            className="theme-toggle"
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle color theme"
            title="Toggle light and dark mode"
          >
            <span className="theme-icon theme-icon-moon"><Icon name="moon" size={15} /></span>
            <span className="theme-icon theme-icon-sun"><Icon name="sun" size={16} /></span>
          </button>
          <span className="local-pill"><span /> Local only</span>
        </div>
      </header>

      {openError && (
        <div className="error-banner" role="alert">
          <span>{openError}</span>
          <button type="button" onClick={() => setOpenError(null)} aria-label="Dismiss error"><Icon name="x" size={16} /></button>
        </div>
      )}

      {!document ? (
        <section className="welcome">
          <div className="welcome-glow" />
          <div className="welcome-icon"><Icon name="sparkle" size={25} /></div>
          <p className="eyebrow">A calmer way to review technical plans</p>
          <h1>Read the plan.<br /><em>Shape what happens next.</em></h1>
          <p className="welcome-copy">
            Paste an absolute path above to turn any local Markdown plan into a focused review surface. Your notes are written directly back to the file.
          </p>
          <button className="welcome-action" type="button" onClick={() => void pickPlan()} disabled={picking}>
            {picking ? "Opening file chooser…" : "Choose a plan file"} {!picking && <Icon name="arrow" size={17} />}
          </button>
          <div className="welcome-features">
            <div><span>01</span><strong>Beautiful preview</strong><p>Typography and structure made for long technical documents.</p></div>
            <div><span>02</span><strong>Contextual comments</strong><p>Leave feedback beside the exact block that needs attention.</p></div>
            <div><span>03</span><strong>File-native workflow</strong><p>Review markers live in Markdown, ready for your plan review loop.</p></div>
          </div>
        </section>
      ) : (
        <div className="workspace">
          <aside className="outline-panel">
            <div className="outline-label">On this page</div>
            <nav aria-label="Document outline">
              {parsed?.outline.map((item) => (
                <a
                  key={item.slug}
                  className={`outline-link depth-${item.depth}`}
                  href={`#${item.slug}`}
                >
                  {item.text}
                </a>
              ))}
              {!parsed?.outline.length && <span className="outline-empty">No headings found</span>}
            </nav>
            <div className="outline-footer">
              <span><Icon name="document" size={15} /> {parsed?.wordCount.toLocaleString()} words</span>
              <span>{Math.max(1, Math.ceil((parsed?.wordCount ?? 0) / 220))} min read</span>
            </div>
          </aside>

          <section className="document-column">
            <div className="document-meta">
              <div className="file-identity">
                <span className="file-icon"><Icon name="document" size={19} /></span>
                <span><strong>{filename(document.path)}</strong><small>{dirname(document.path)}</small></span>
              </div>
              <button className="reload-button" type="button" onClick={() => void reload()} disabled={opening}>
                <Icon name="refresh" size={15} /> Reload
              </button>
            </div>

            <article className="plan-paper">
              <div className="paper-heading" id={titleBlock?.id}>
                <p className="eyebrow">Implementation plan</p>
                <h1>{title}</h1>
                <div className="paper-rule"><span /></div>
                <p className="paper-hint">Hover over a block for a general note, or select text for a precise comment.</p>
              </div>

              <div className="markdown-body">
                {parsed?.blocks.map((block) => block.kind === "content" && block.id === titleBlock?.id ? null : block.kind === "comment" ? (
                  <div className="inline-comment" id={block.id} key={block.id}>
                    <span className="inline-comment-icon"><Icon name="comment" size={16} /></span>
                    <div>
                      <span className="inline-comment-label">Your review note</span>
                      {block.selection && <blockquote className="inline-selection">“{block.selection}”</blockquote>}
                      <p>{block.text}</p>
                    </div>
                    <span className="review-status"><span /> Pending review</span>
                  </div>
                ) : (
                  <section
                    className={`reviewable-block${selectedBlock?.id === block.id ? " is-selected" : ""}`}
                    id={block.id}
                    key={`${block.id}-${block.startLine}`}
                    data-start-line={block.startLine}
                    data-end-line={block.endLine}
                  >
                    <MarkdownBlock block={block} />
                    <button
                      className="block-comment-button"
                      type="button"
                      onClick={() => chooseBlock(block)}
                      aria-label={`Comment on ${block.heading?.text ?? `lines ${block.startLine}–${block.endLine}`}`}
                      title="Add a comment"
                    >
                      <Icon name="comment" size={16} />
                    </button>
                  </section>
                ))}
              </div>
            </article>
          </section>

          <aside className={`review-panel${selectedBlock ? " composing" : ""}`}>
            {selectedBlock ? (
              <div className="comment-composer">
                <div className="composer-header">
                  <div><span className="composer-kicker">New comment</span><strong>{selectedBlock.section}</strong></div>
                  <button type="button" onClick={() => { setSelectedBlock(null); setSelectedText(""); setComment(""); setCommentError(null); }} aria-label="Close composer"><Icon name="x" size={17} /></button>
                </div>
                {selectedText && <span className="selection-context-label">Selected text</span>}
                <blockquote className={selectedText ? "composer-selection" : undefined}>{selectedText || selectedBlock.heading?.text || selectedBlock.source.replace(/[#>*_`~]/g, "").slice(0, 150)}</blockquote>
                <label htmlFor="comment">{selectedText ? "What should change about this selection?" : "What should change?"}</label>
                <textarea
                  id="comment"
                  ref={commentRef}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      void saveComment();
                    }
                  }}
                  placeholder="Be specific about the decision, risk, or detail you want revised…"
                  rows={7}
                  maxLength={4000}
                />
                <div className="composer-meta"><span>{selectedText ? "Selection + " : ""}<code>@me</code> review marker</span><span>{comment.length}/4000</span></div>
                {commentError && <div className="composer-error" role="alert">{commentError}</div>}
                <button className="save-comment" type="button" onClick={() => void saveComment()} disabled={saving || !comment.trim()}>
                  {saving ? "Saving to plan…" : "Save comment to plan"}
                  {!saving && <Icon name="check" size={16} />}
                </button>
                <span className="keyboard-hint">⌘/Ctrl + Enter to save</span>
              </div>
            ) : (
              <>
                <div className="review-panel-header">
                  <div><span className="outline-label">Review notes</span><strong>{comments.length}</strong></div>
                  <p>Comments saved in this plan and waiting for the next review round.</p>
                </div>
                <div className="review-list">
                  {comments.map((item) => (
                    <CommentCard
                      key={item.id}
                      comment={item}
                      onNavigate={() => window.document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                    />
                  ))}
                  {!comments.length && (
                    <div className="empty-reviews">
                      <span><Icon name="comment" size={20} /></span>
                      <strong>No review notes yet</strong>
                      <p>Hover over a document block and use the comment button to add one.</p>
                    </div>
                  )}
                </div>
                <div className="review-help">
                  <Icon name="sparkle" size={16} />
                  <p><strong>Ready for your workflow</strong>Run the plan review after commenting. Each <code>@me</code> marker gives it the exact context to revise.</p>
                </div>
              </>
            )}
          </aside>
        </div>
      )}

      {selectionPrompt && !selectedBlock && (
        <button
          className="selection-comment-action"
          type="button"
          style={{
            position: "fixed",
            zIndex: 70,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            left: selectionPrompt.x,
            top: selectionPrompt.y,
            height: 34,
            minWidth: 88,
            padding: "0 13px",
            overflow: "visible",
            border: "1px solid var(--line)",
            borderRadius: 999,
            background: "var(--paper)",
            boxShadow: "0 10px 30px rgba(0, 0, 0, .2), 0 1px 2px rgba(0, 0, 0, .12)",
            color: "var(--forest)",
            fontSize: 11,
            fontWeight: 750,
            lineHeight: 1,
            letterSpacing: "-.01em",
            whiteSpace: "nowrap",
            cursor: "pointer",
            transform: "translateX(-50%)",
          }}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            chooseBlock(selectionPrompt.target, selectionPrompt.text);
            window.getSelection()?.removeAllRanges();
          }}
        >
          <span className="selection-action-icon"><Icon name="comment" size={14} /></span>
          <span>Comment</span>
          <span
            aria-hidden="true"
            className={`selection-action-caret ${selectionPrompt.placement}`}
            style={{
              position: "absolute",
              left: "50%",
              width: 8,
              height: 8,
              background: "var(--paper)",
              pointerEvents: "none",
              ...(selectionPrompt.placement === "above"
                ? {
                    bottom: -5,
                    borderRight: "1px solid var(--line)",
                    borderBottom: "1px solid var(--line)",
                    transform: "translateX(-50%) rotate(45deg)",
                  }
                : {
                    top: -5,
                    borderTop: "1px solid var(--line)",
                    borderLeft: "1px solid var(--line)",
                    transform: "translateX(-50%) rotate(45deg)",
                  }),
            }}
          />
        </button>
      )}

      {toast && <div className="toast" role="status"><Icon name="check" size={16} /> {toast}</div>}
    </main>
  );
}
