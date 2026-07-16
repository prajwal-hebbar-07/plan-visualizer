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

type AskTurn = {
  id: number;
  question: string;
  selection?: string;
  research: string[];
  answer: string;
  streaming: boolean;
  error?: string;
};

type ClaudeAccountId = "claude-one" | "claude-two";

type ClaudeSessionOption = {
  id: string;
  title: string;
  updatedAt: string;
  preview?: string;
};

type ClaudeChatChoice =
  | { kind: "new"; title: string }
  | { kind: "existing"; id: string; title: string };

type IconName =
  | "logo"
  | "folder"
  | "sun"
  | "moon"
  | "warning"
  | "comment"
  | "doc"
  | "file"
  | "reload"
  | "branch"
  | "chat"
  | "close"
  | "toastCheck"
  | "spinner"
  | "arrowUp"
  | "chevron";

const ICONS: Record<IconName, { vb: string; sw: number; node: React.ReactNode }> = {
  logo: {
    vb: "0 0 16 16",
    sw: 1.5,
    node: (
      <>
        <path d="M3 2.5h7l3 3V13.5H3z" fill="none" stroke="currentColor" strokeLinejoin="round" />
        <path d="M5.5 8h5M5.5 10.4h3.2" stroke="currentColor" strokeLinecap="round" />
      </>
    ),
  },
  folder: {
    vb: "0 0 16 16",
    sw: 1.3,
    node: (
      <path
        d="M2 4a1 1 0 0 1 1-1h3l1.4 1.5h6.6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"
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
        <circle cx="8" cy="8" r="3.1" fill="none" stroke="currentColor" />
        <path
          d="M8 1.4v1.7M8 12.9v1.7M1.4 8h1.7M12.9 8h1.7M3.3 3.3l1.2 1.2M11.5 11.5l1.2 1.2M12.7 3.3l-1.2 1.2M4.5 11.5l-1.2 1.2"
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
        d="M13.4 9.4A5.8 5.8 0 0 1 6.6 2.6a5.8 5.8 0 1 0 6.8 6.8z"
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
        <path d="M8 2 14.5 13.5h-13z" fill="none" stroke="currentColor" strokeLinejoin="round" />
        <path d="M8 6.4v3.2M8 11.2v.3" stroke="currentColor" strokeLinecap="round" />
      </>
    ),
  },
  comment: {
    vb: "0 0 16 16",
    sw: 1.4,
    node: <path d="M2 3.5h12v7H8l-3 3v-3H2z" fill="none" stroke="currentColor" strokeLinejoin="round" />,
  },
  doc: {
    vb: "0 0 16 16",
    sw: 1.3,
    node: (
      <>
        <path d="M3 1.5h6L13 5V14.5H3z" fill="none" stroke="currentColor" strokeLinejoin="round" />
        <path d="M5.5 7.5h5M5.5 10h3.5" stroke="currentColor" strokeLinecap="round" />
      </>
    ),
  },
  file: {
    vb: "0 0 16 16",
    sw: 1.3,
    node: <path d="M3 1.5h6L13 5V14.5H3z" fill="none" stroke="currentColor" strokeLinejoin="round" />,
  },
  reload: {
    vb: "0 0 16 16",
    sw: 1.4,
    node: (
      <>
        <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" fill="none" stroke="currentColor" strokeLinecap="round" />
        <path d="M13.7 1.9v2.6H11.1" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  branch: {
    vb: "0 0 16 16",
    sw: 1.3,
    node: (
      <>
        <path d="M4 2v5.5a2.5 2.5 0 0 0 2.5 2.5H11" fill="none" stroke="currentColor" strokeLinecap="round" />
        <circle cx="4" cy="2" r="1.5" fill="none" stroke="currentColor" />
        <circle cx="12" cy="10" r="1.5" fill="none" stroke="currentColor" />
        <circle cx="4" cy="13.5" r="1.5" fill="none" stroke="currentColor" />
      </>
    ),
  },
  chat: {
    vb: "0 0 16 16",
    sw: 1.3,
    node: (
      <path
        d="M2.5 3h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6l-3 2.5V11H2.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
      />
    ),
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
  spinner: {
    vb: "0 0 16 16",
    sw: 1.5,
    node: <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" stroke="currentColor" strokeLinecap="round" />,
  },
  arrowUp: {
    vb: "0 0 16 16",
    sw: 1.6,
    node: <path d="M8 13V3.5M4 7l4-4 4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />,
  },
  chevron: {
    vb: "0 0 16 16",
    sw: 1.6,
    node: <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />,
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
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    code?: string;
    sessionId?: string;
  } | null;
  return {
    message: body?.error ?? `Request failed (${response.status})`,
    code: body?.code,
    sessionId: body?.sessionId,
  };
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

// Turn a research summary ("Read plan.md") into a mono label + detail for the
// collapsible research trail shown under an answer.
function splitStep(step: string): { kind: string; text: string } {
  const match = step.trim().match(/^(\w+)\s+([\s\S]+)$/);
  if (match) return { kind: match[1].toLowerCase(), text: match[2] };
  return { kind: "·", text: step.trim() };
}

function formatLoaded(loadedAt: number, now: number) {
  if (!loadedAt) return "";
  const seconds = Math.max(0, Math.floor((now - loadedAt) / 1000));
  if (seconds < 45) return "loaded just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "loaded just now";
  if (minutes < 60) return `loaded ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `loaded ${hours}h ago`;
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
  const [loadedAt, setLoadedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
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
  const [implementing, setImplementing] = useState(false);
  const [implementLog, setImplementLog] = useState<{ id: number; kind: string; text: string }[]>([]);
  const [implementError, setImplementError] = useState<string | null>(null);
  const [implementBranch, setImplementBranch] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"review" | "ask">("review");
  const [askThread, setAskThread] = useState<AskTurn[]>([]);
  const [askInput, setAskInput] = useState("");
  const [askSelection, setAskSelection] = useState("");
  const [asking, setAsking] = useState(false);
  const [claudeAccount, setClaudeAccount] = useState<ClaudeAccountId | null>(null);
  const [claudeAccountLabel, setClaudeAccountLabel] = useState("");
  const [claudeSessions, setClaudeSessions] = useState<ClaudeSessionOption[]>([]);
  const [claudeSessionsLoading, setClaudeSessionsLoading] = useState(false);
  const [claudeSessionsError, setClaudeSessionsError] = useState<string | null>(null);
  const [claudeChat, setClaudeChat] = useState<ClaudeChatChoice | null>(null);
  const [stepsOpen, setStepsOpen] = useState<Record<number, boolean>>({});
  const [commentError, setCommentError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  const [gutterTop, setGutterTop] = useState<number | null>(null);

  const pathRef = useRef<HTMLInputElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  const documentPathRef = useRef<string | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const implementAbort = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const askAbort = useRef<AbortController | null>(null);
  const sessionListAbort = useRef<AbortController | null>(null);
  const askThreadRef = useRef<HTMLDivElement>(null);
  const askInputRef = useRef<HTMLTextAreaElement>(null);

  const busy = reviewing || implementing;
  const claudeBusy = reviewing || implementing || asking;
  const claudeReady = claudeAccount !== null && claudeChat !== null;

  const claudeSelection = useMemo(() => {
    if (!claudeAccount || !claudeChat) return null;
    return {
      accountId: claudeAccount,
      ...(claudeChat.kind === "existing"
        ? { sessionId: claudeChat.id, newChat: false }
        : { newChat: true }),
    };
  }, [claudeAccount, claudeChat]);

  const parsed = useMemo(() => (document ? parsePlan(document.content) : null), [document]);

  useEffect(() => {
    hoveredIdRef.current = hoveredBlockId;
  }, [hoveredBlockId]);

  useEffect(() => {
    documentPathRef.current = document?.path ?? null;
  }, [document?.path]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [implementLog]);

  useEffect(() => {
    if (askThreadRef.current) askThreadRef.current.scrollTop = askThreadRef.current.scrollHeight;
  }, [askThread]);

  // Keep the "loaded Xm ago" label fresh without a per-second re-render.
  useEffect(() => {
    if (!document) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [document]);

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
      const switchedPlan = data.path !== documentPathRef.current;
      setDocument(data);
      setLoadedAt(Date.now());
      setNow(Date.now());
      setPathInput(data.path);
      setSelectedBlock(null);
      setSelectedText("");
      setSelectionPrompt(null);
      setComment("");
      setConflict(false);
      setReviewError(null);
      // Only clear the implement panel and Q&A thread when opening a different
      // plan — a reload of the same file (e.g. after a run) keeps them visible.
      if (switchedPlan) {
        sessionListAbort.current?.abort();
        sessionListAbort.current = null;
        setImplementLog([]);
        setImplementError(null);
        setImplementBranch(null);
        setAskThread([]);
        setAskInput("");
        setAskSelection("");
        setStepsOpen({});
        setClaudeAccount(null);
        setClaudeAccountLabel("");
        setClaudeSessions([]);
        setClaudeSessionsLoading(false);
        setClaudeSessionsError(null);
        setClaudeChat(null);
      }
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
    if (!document || !selectedBlock || !comment.trim() || saving || busy) return;
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
      setLoadedAt(Date.now());
      closeComposer();
      showToast("Note saved to the plan");
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "DOCUMENT_CHANGED") setConflict(true);
      setCommentError(error instanceof Error ? error.message : "Unable to save the comment.");
    } finally {
      setSaving(false);
    }
  }, [comment, document, busy, saving, selectedBlock, selectedText, closeComposer, showToast]);

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
      if (eventTarget instanceof Element && eventTarget.closest(".pv-pill, .pv-panel, .pv-composer")) return;

      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount) {
          setSelectionPrompt(null);
          return;
        }

        const text = selection.toString().replace(/ /g, " ").replace(/\s+/g, " ").trim();
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
        const x = Math.min(Math.max(rect.left + rect.width / 2, 96), window.innerWidth - 96);
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

  const clearClaudeOutput = useCallback(() => {
    setAskThread([]);
    setAskInput("");
    setAskSelection("");
    setStepsOpen({});
    setReviewError(null);
    setImplementLog([]);
    setImplementError(null);
    setImplementBranch(null);
  }, []);

  const chooseClaudeAccount = useCallback(
    async (accountId: ClaudeAccountId) => {
      if (!document || claudeBusy) return;
      sessionListAbort.current?.abort();
      const controller = new AbortController();
      sessionListAbort.current = controller;

      setClaudeAccount(accountId);
      setClaudeAccountLabel(accountId === "claude-one" ? "Claude account 1" : "Claude account 2");
      setClaudeChat(null);
      setClaudeSessions([]);
      setClaudeSessionsError(null);
      setClaudeSessionsLoading(true);
      clearClaudeOutput();

      try {
        const query = new URLSearchParams({ path: document.path, accountId });
        const response = await fetch(`/api/claude/sessions?${query}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error((await readApiError(response)).message);
        const data = (await response.json()) as {
          account: { id: ClaudeAccountId; label: string };
          sessions: ClaudeSessionOption[];
        };
        if (controller.signal.aborted) return;
        setClaudeAccountLabel(data.account.label);
        setClaudeSessions(data.sessions);
      } catch (error) {
        if (!controller.signal.aborted) {
          setClaudeSessionsError(error instanceof Error ? error.message : "Claude chats could not be loaded.");
        }
      } finally {
        if (sessionListAbort.current === controller) {
          setClaudeSessionsLoading(false);
          sessionListAbort.current = null;
        }
      }
    },
    [document, claudeBusy, clearClaudeOutput],
  );

  const refreshClaudeSessions = useCallback(() => {
    if (claudeAccount) void chooseClaudeAccount(claudeAccount);
  }, [claudeAccount, chooseClaudeAccount]);

  const chooseClaudeChat = useCallback(
    (value: string) => {
      if (claudeBusy) return;
      clearClaudeOutput();
      if (!value) {
        setClaudeChat(null);
      } else if (value === "__new__") {
        setClaudeChat({ kind: "new", title: "New chat" });
      } else {
        const session = claudeSessions.find((candidate) => candidate.id === value);
        setClaudeChat(session ? { kind: "existing", id: session.id, title: session.title } : null);
      }
    },
    [claudeBusy, claudeSessions, clearClaudeOutput],
  );

  const promoteClaudeSession = useCallback((sessionId?: string) => {
    if (!sessionId) return;
    setClaudeChat((current) =>
      current?.kind === "new"
        ? { kind: "existing", id: sessionId, title: `New chat · ${sessionId.slice(0, 8)}` }
        : current,
    );
  }, []);

  const chooseBlock = (block: ContentBlock, selection = "") => {
    if (busy) return;
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
    if (!document || !claudeSelection || claudeBusy) return;

    const reviewedPath = document.path;
    setReviewing(true);
    setReviewError(null);
    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: reviewedPath, ...claudeSelection }),
      });
      if (!response.ok) {
        const failure = await readApiError(response);
        promoteClaudeSession(failure.sessionId);
        throw new Error(failure.message);
      }
      const result = (await response.json()) as { sessionId?: string };
      promoteClaudeSession(result.sessionId);

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
  }, [document, claudeSelection, claudeBusy, openDocument, promoteClaudeSession, showToast]);

  const stopImplement = useCallback(() => {
    implementAbort.current?.abort();
  }, []);

  const runImplement = useCallback(async () => {
    if (!document || !claudeSelection || claudeBusy) return;

    const targetPath = document.path;
    const controller = new AbortController();
    implementAbort.current = controller;
    setImplementing(true);
    setImplementError(null);
    setImplementLog([]);
    setImplementBranch(null);

    let sawError: string | null = null;
    try {
      const response = await fetch("/api/implement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: targetPath, ...claudeSelection }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const failure = await readApiError(response);
        promoteClaudeSession(failure.sessionId);
        throw new Error(failure.message);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let seq = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          let event: { type: string; text?: string; error?: string; branch?: string; sessionId?: string };
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event.type === "session") {
            promoteClaudeSession(event.sessionId);
          } else if (event.type === "error") {
            sawError = event.error ?? "Claude could not implement the plan.";
          } else if (event.type === "done") {
            if (event.branch) setImplementBranch(event.branch);
            promoteClaudeSession(event.sessionId);
          } else {
            const nextSeq = seq++;
            setImplementLog((prev) => [
              ...prev,
              { id: nextSeq, kind: event.type, text: event.text ?? "" },
            ]);
          }
        }
      }

      if (sawError) setImplementError(sawError);
      else showToast("Claude finished implementing the plan");
    } catch (error) {
      if (controller.signal.aborted) showToast("Stopped implementation");
      else setImplementError(error instanceof Error ? error.message : "Claude could not implement the plan.");
    } finally {
      setImplementing(false);
      implementAbort.current = null;
      // Claude may have changed files (including the plan); reload it in place.
      if (documentPathRef.current === targetPath) await openDocument(targetPath);
    }
  }, [document, claudeSelection, claudeBusy, openDocument, promoteClaudeSession, showToast]);

  const stopAsk = useCallback(() => {
    askAbort.current?.abort();
  }, []);

  const runAsk = useCallback(
    async (rawQuestion: string, selection?: string) => {
      const question = rawQuestion.trim();
      if (!document || !claudeSelection || claudeBusy || !question) return;

      const turnId = Date.now();
      const controller = new AbortController();
      askAbort.current = controller;
      setAsking(true);
      setAskThread((prev) => [
        ...prev,
        { id: turnId, question, selection, research: [], answer: "", streaming: true },
      ]);
      setAskInput("");
      setAskSelection("");

      const update = (patch: (turn: AskTurn) => AskTurn) =>
        setAskThread((prev) => prev.map((turn) => (turn.id === turnId ? patch(turn) : turn)));

      try {
        const response = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: document.path,
            question,
            selection,
            ...claudeSelection,
          }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const failure = await readApiError(response);
          promoteClaudeSession(failure.sessionId);
          throw new Error(failure.message);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line) continue;
            let event: { type: string; text?: string; error?: string; sessionId?: string };
            try {
              event = JSON.parse(line);
            } catch {
              continue;
            }
            if (event.type === "session") {
              promoteClaudeSession(event.sessionId);
            } else if (event.type === "research" && event.text) {
              const note = event.text;
              update((turn) => ({ ...turn, research: [...turn.research, note] }));
            } else if (event.type === "answer" && event.text) {
              const chunk = event.text;
              update((turn) => ({ ...turn, answer: turn.answer + chunk }));
            } else if (event.type === "error" && event.error) {
              const message = event.error;
              update((turn) => ({ ...turn, error: message }));
            } else if (event.type === "done" && event.sessionId) {
              promoteClaudeSession(event.sessionId);
            }
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : "Claude could not answer.";
          update((turn) => ({ ...turn, error: message }));
        }
      } finally {
        update((turn) => ({ ...turn, streaming: false }));
        setAsking(false);
        askAbort.current = null;
      }
    },
    [document, claudeSelection, claudeBusy, promoteClaudeSession],
  );

  const askAboutSelection = useCallback((text: string) => {
    setSidebarTab("ask");
    setAskSelection(text);
    window.setTimeout(() => askInputRef.current?.focus(), 60);
  }, []);

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
            <button
              className="pv-browse"
              type="button"
              onClick={() => void pickPlan()}
              disabled={picking}
              title="Open the native file picker"
            >
              <Icon name="folder" size={12} />
              {picking ? "Opening…" : "Browse"}
            </button>
          </div>

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
              <Icon name="moon" size={15} />
            </span>
            <span className="pv-theme-sun">
              <Icon name="sun" size={15} />
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
            <div className="pv-empty-eyebrow">Local-first plan review</div>
            <h1 className="pv-empty-title">Read, review, and act on implementation plans.</h1>
            <p className="pv-empty-copy">
              Render a local Markdown plan as a precise, readable document. Annotate any block, ask questions about the
              plan, and hand it to a coding agent — every note is written straight back into the file.
            </p>
            <div className="pv-empty-cta">
              <button
                className="pv-btn-primary pv-btn-lg"
                type="button"
                onClick={() => void pickPlan()}
                disabled={picking}
              >
                {picking ? "Opening file chooser…" : "Choose a plan file"}
              </button>
              <span className="pv-empty-kbd-hint">
                or press <kbd>⌘O</kbd> and paste a path
              </span>
            </div>

            <div className="pv-features">
              <div className="pv-feature">
                <Icon name="doc" size={16} />
                <strong>Editorial preview</strong>
                <p>Typeset headings, code, tables, and task lists.</p>
              </div>
              <div className="pv-feature">
                <Icon name="comment" size={16} sw={1.3} />
                <strong>Notes &amp; questions</strong>
                <p>Comment on any block or ask about the plan.</p>
              </div>
              <div className="pv-feature">
                <Icon name="branch" size={16} />
                <strong>Implement in place</strong>
                <p>Delegate the plan to an agent on a branch.</p>
              </div>
            </div>

            <div className="pv-empty-note">
              Notes are saved into the document as <code>&lt;!-- @me: … --&gt;</code> markers — no database, no account.
            </div>
          </div>
        </main>
      ) : (
        /* ============ WORKSPACE ============ */
        <div className="pv-workspace">
          {/* Document */}
          <main className="pv-doc">
            {conflict && (
              <div className="pv-conflict" role="alert">
                <Icon name="warning" size={15} />
                <div className="pv-conflict-body">
                  <strong>{filename(document.path)} changed on disk</strong>
                  <span>Another process edited this file. Reload to pick up changes — unsaved notes are kept.</span>
                </div>
                <button
                  className="pv-btn-primary"
                  type="button"
                  onClick={() => {
                    setConflict(false);
                    void reload();
                  }}
                >
                  Reload
                </button>
                <button className="pv-conflict-dismiss" type="button" onClick={() => setConflict(false)}>
                  Keep view
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
              <span className="loaded">{formatLoaded(loadedAt, now)}</span>
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
              {!busy && !selectedBlock && hoveredBlockId && gutterTop !== null && (
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
                        <span className="pv-note-label">Review note</span>
                        <span className="pv-note-badge">Pending</span>
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
                    className={`pv-block${block.heading ? ` is-heading depth-${block.heading.depth}` : ""}${selectedBlock?.id === block.id ? " is-composing" : ""}`}
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

          {/* Work panel */}
          <aside className="pv-panel" aria-label="Work panel">
            <div className="pv-claude-context">
              <div className="pv-claude-context-head">
                <div>
                  <strong>Claude context</strong>
                  <span>Choose account, then chat</span>
                </div>
                {claudeAccount && (
                  <button
                    type="button"
                    className="pv-claude-refresh"
                    onClick={refreshClaudeSessions}
                    disabled={claudeBusy || claudeSessionsLoading}
                    title="Refresh chats"
                    aria-label="Refresh Claude chats"
                  >
                    <Icon name="reload" size={12} />
                  </button>
                )}
              </div>

              <div className="pv-claude-accounts" role="group" aria-label="Choose Claude account">
                {(["claude-one", "claude-two"] as const).map((accountId, index) => (
                  <button
                    key={accountId}
                    type="button"
                    className={claudeAccount === accountId ? "is-selected" : ""}
                    onClick={() => void chooseClaudeAccount(accountId)}
                    disabled={claudeBusy}
                    aria-pressed={claudeAccount === accountId}
                  >
                    Account {index + 1}
                  </button>
                ))}
              </div>

              {claudeAccount && (
                <div className="pv-claude-chat-row">
                  <label htmlFor="pv-claude-chat">Chat</label>
                  <select
                    id="pv-claude-chat"
                    value={
                      claudeChat
                        ? claudeChat.kind === "new"
                          ? "__new__"
                          : claudeChat.id
                        : ""
                    }
                    onChange={(event) => chooseClaudeChat(event.target.value)}
                    disabled={claudeBusy || claudeSessionsLoading}
                  >
                    <option value="">
                      {claudeSessionsLoading ? "Loading chats…" : "Choose a chat…"}
                    </option>
                    {!claudeSessionsLoading && <option value="__new__">＋ New chat</option>}
                    {claudeChat?.kind === "existing" &&
                      !claudeSessions.some((session) => session.id === claudeChat.id) && (
                        <option value={claudeChat.id}>{claudeChat.title}</option>
                      )}
                    {claudeSessions.map((session) => (
                      <option key={session.id} value={session.id}>
                        {session.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {claudeSessionsError && (
                <div className="pv-claude-context-error" role="alert">
                  {claudeSessionsError}
                </div>
              )}

              <div className={`pv-claude-context-status${claudeReady ? " is-ready" : ""}`}>
                {claudeReady
                  ? `${claudeAccountLabel} · ${claudeChat.title}`
                  : claudeAccount
                    ? "Choose an existing chat or New chat."
                    : "No Claude account selected."}
              </div>
            </div>

            <div className="pv-panel-tabs">
              <div className="pv-seg" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={sidebarTab === "review"}
                  className={`pv-seg-tab${sidebarTab === "review" ? " is-active" : ""}`}
                  onClick={() => setSidebarTab("review")}
                >
                  <Icon name="comment" size={13} />
                  Review
                  {comments.length > 0 && <span className="pv-seg-count">{comments.length}</span>}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sidebarTab === "ask"}
                  className={`pv-seg-tab${sidebarTab === "ask" ? " is-active" : ""}`}
                  onClick={() => setSidebarTab("ask")}
                >
                  <Icon name="chat" size={13} />
                  Ask about plan
                </button>
              </div>
            </div>

            {sidebarTab === "review" ? (
              <div className="pv-panel-body">
                {/* Run review */}
                <div className="pv-runcard">
                  <div className="pv-runcard-row">
                    <div className="pv-runcard-text">
                      <div className="pv-runcard-title">Run plan review</div>
                      <div className="pv-runcard-desc">Have an agent read the plan and draft review notes.</div>
                    </div>
                    <button
                      className={`pv-runcard-btn${reviewing ? " is-running" : ""}`}
                      type="button"
                      onClick={() => void runPlanReview()}
                      disabled={claudeBusy || !claudeReady}
                      title={!claudeReady ? "Choose a Claude account and chat first" : "Run review command"}
                    >
                      {reviewing && <Icon name="spinner" size={12} />}
                      {reviewing ? "Reviewing…" : "Run review"}
                    </button>
                  </div>
                  {reviewing && (
                    <div className="pv-runcard-progress">
                      <span className="dot" />
                      Claude is reviewing the plan…
                    </div>
                  )}
                  {reviewError && <div className="pv-runcard-error" role="alert">{reviewError}</div>}
                </div>

                {/* Implement */}
                <div className="pv-impl">
                  <div className="pv-impl-inner">
                    <div className="pv-impl-head">
                      <Icon name="branch" size={14} sw={1.4} />
                      <strong>Implement</strong>
                      <span className="pv-impl-tag">Writes code</span>
                    </div>

                    <button
                      className={`pv-impl-btn${implementing ? " is-running" : ""}`}
                      type="button"
                      onClick={() => (implementing ? stopImplement() : void runImplement())}
                      disabled={reviewing || asking || (!implementing && !claudeReady)}
                    >
                      {implementing && <span className="stop-glyph" />}
                      {implementing ? "Stop implementation" : "Implement plan"}
                    </button>

                    <div className="pv-impl-foot">
                      <div className={`pv-impl-hint${implementError ? " is-error" : ""}`}>
                        {implementing
                          ? "Agent is editing files on a branch — nothing is pushed until it finishes."
                          : implementError
                            ? "Last run failed before commit. Review the log, then retry."
                            : "Delegates the whole plan to a coding agent on a new branch."}
                      </div>
                      {implementBranch && (
                        <span className="pv-impl-branch" title={implementBranch}>
                          <Icon name="branch" size={10} sw={1.5} />
                          {implementBranch}
                        </span>
                      )}
                    </div>
                  </div>

                  {(implementing || implementLog.length > 0 || implementError) && (
                    <div className="pv-impl-log">
                      <div className="pv-impl-log-head">
                        <span className="label">Live log</span>
                        {implementing && (
                          <span className="running">
                            <span className="dot" />
                            running
                          </span>
                        )}
                      </div>
                      <div className="pv-impl-log-body" ref={logRef}>
                        {implementLog.map((line) => (
                          <div key={line.id} className={`pv-log-line kind-${line.kind}`}>
                            {line.kind === "tool" && <span className="pv-log-caret">›</span>}
                            {line.kind === "result" && <span className="pv-log-caret">✓</span>}
                            <span className="pv-log-text">{line.text}</span>
                          </div>
                        ))}
                        {implementError && (
                          <div className="pv-log-line kind-error">
                            <span className="pv-log-caret">✕</span>
                            <span className="pv-log-text">{implementError}</span>
                          </div>
                        )}
                        {implementing && <span className="pv-log-cursor" />}
                      </div>
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div className="pv-notes-head">
                  <span className="label">Review notes</span>
                  {comments.length > 0 && <span className="count">{comments.length} pending</span>}
                </div>

                {comments.length === 0 ? (
                  <div className="pv-notes-empty">
                    <Icon name="comment" size={17} sw={1.3} />
                    <strong>No review notes yet</strong>
                    <p>Hover a block and click the margin control, or select text to comment.</p>
                  </div>
                ) : (
                  comments.map((item) => (
                    <button key={item.id} className="pv-card" type="button" onClick={() => jumpTo(item.id)}>
                      <div className="pv-card-top">
                        <span className="pv-card-section">{item.section}</span>
                        <span className="pv-card-line">L{item.startLine}</span>
                        <span className="pv-card-pending">Pending</span>
                      </div>
                      {item.selection && <div className="pv-card-quote">“{item.selection}”</div>}
                      <div className="pv-card-text">{item.text}</div>
                    </button>
                  ))
                )}

                <div className="pv-notes-foot">
                  Notes are written into the file as <code>&lt;!-- @me --&gt;</code> markers.
                </div>
              </div>
            ) : (
              <div className="pv-ask">
                <div className="pv-ask-body" ref={askThreadRef}>
                  {askThread.length === 0 ? (
                    <div className="pv-ask-empty">
                      <div className="pv-ask-empty-icon">
                        <Icon name="chat" size={19} sw={1.3} />
                      </div>
                      <strong>Ask about this plan</strong>
                      <p>
                        {claudeReady
                          ? "Questions use the selected chat in read-only mode. Review and implementation use their own command permissions."
                          : "Choose a Claude account and chat above before sending a question."}
                      </p>
                    </div>
                  ) : (
                    <div className="pv-ask-thread">
                      {askThread.map((turn) => {
                        const showThinking = turn.streaming && !turn.answer && turn.research.length === 0 && !turn.error;
                        const open = stepsOpen[turn.id] ?? (turn.streaming && !turn.answer);
                        return (
                          <div key={turn.id}>
                            <div className="pv-ask-user">
                              {turn.selection && <div className="pv-ask-user-quote">“{turn.selection}”</div>}
                              <div className="pv-ask-bubble">{turn.question}</div>
                            </div>
                            <div className="pv-ask-assistant">
                              {showThinking && (
                                <div className="pv-ask-thinking">
                                  <span className="dots">
                                    <span />
                                    <span />
                                    <span />
                                  </span>
                                  <em>Thinking…</em>
                                </div>
                              )}
                              {turn.research.length > 0 && (
                                <div>
                                  <button
                                    type="button"
                                    className={`pv-ask-steps-toggle${open ? " is-open" : ""}`}
                                    onClick={() => setStepsOpen((prev) => ({ ...prev, [turn.id]: !open }))}
                                  >
                                    <Icon name="chevron" size={10} />
                                    {turn.research.length} research {turn.research.length === 1 ? "step" : "steps"}
                                  </button>
                                  {open && (
                                    <div className="pv-ask-steps">
                                      {turn.research.map((step, index) => {
                                        const parts = splitStep(step);
                                        return (
                                          <div className="pv-ask-step" key={index}>
                                            <span className="kind">{parts.kind}</span>
                                            <span>{parts.text}</span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}
                              {turn.answer && (
                                <div className="pv-ask-answer markdown-body">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.answer}</ReactMarkdown>
                                  {turn.streaming && <span className="pv-log-cursor" />}
                                </div>
                              )}
                              {turn.error && (
                                <div className="pv-ask-error" role="alert">
                                  {turn.error}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="pv-ask-input">
                  {askSelection && (
                    <div className="pv-ask-sel">
                      <div className="pv-ask-sel-body">
                        <div className="pv-ask-sel-label">Selection context</div>
                        <div className="pv-ask-sel-quote">“{askSelection}”</div>
                      </div>
                      <button
                        type="button"
                        className="pv-ask-sel-close"
                        onClick={() => setAskSelection("")}
                        aria-label="Remove selection context"
                      >
                        <Icon name="close" size={10} />
                      </button>
                    </div>
                  )}
                  <div className="pv-ask-field">
                    <textarea
                      ref={askInputRef}
                      value={askInput}
                      onChange={(event) => setAskInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void runAsk(askInput, askSelection || undefined);
                        }
                      }}
                      placeholder={askThread.length ? "Ask a follow-up…" : "Ask about this plan…"}
                      rows={1}
                      maxLength={4000}
                      disabled={!claudeReady || reviewing || implementing}
                      aria-label="Ask a question about the plan"
                    />
                    <button
                      type="button"
                      className={`pv-ask-send${asking ? " is-running" : ""}`}
                      onClick={() => (asking ? stopAsk() : void runAsk(askInput, askSelection || undefined))}
                      disabled={!asking && (!askInput.trim() || !claudeReady || reviewing || implementing)}
                      aria-label={asking ? "Stop" : "Send question"}
                      title={asking ? "Stop" : "Send"}
                    >
                      {asking ? <span className="stop-glyph" /> : <Icon name="arrowUp" size={15} />}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* ============ FLOATING COMPOSER ============ */}
      {document && selectedBlock && (
        <div className="pv-composer" role="dialog" aria-label="Review note composer">
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
            <div className="pv-composer-quote">“{selectedText}”</div>
          ) : (
            <div className="pv-composer-preview">{blockPreview(selectedBlock)}</div>
          )}

          <textarea
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
            <button className="pv-btn-cancel" type="button" onClick={closeComposer}>
              Cancel
            </button>
            <button
              className="pv-btn-save"
              type="button"
              onClick={() => void saveComment()}
              disabled={saving || busy || !comment.trim()}
            >
              {saving ? "Saving…" : "Save note"}
            </button>
          </div>
        </div>
      )}

      {/* ============ SELECTION PILL ============ */}
      {selectionPrompt && !selectedBlock && !busy && (
        <div
          className="pv-pill-wrap"
          style={{
            left: selectionPrompt.x,
            top: selectionPrompt.y,
            transform: selectionPrompt.above ? "translate(-50%,-100%)" : "translate(-50%,0)",
            flexDirection: selectionPrompt.above ? "column" : "column-reverse",
          }}
        >
          <div className="pv-pill">
            <button
              className="pv-pill-btn"
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
            <span className="pv-pill-sep" aria-hidden="true" />
            <button
              className="pv-pill-btn"
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                askAboutSelection(selectionPrompt.text);
                window.getSelection()?.removeAllRanges();
                setSelectionPrompt(null);
              }}
            >
              <Icon name="chat" size={12} sw={1.5} />
              Ask
            </button>
          </div>
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
