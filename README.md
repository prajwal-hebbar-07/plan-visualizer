# Plan Visualizer

A local-first review surface for Markdown implementation plans. Point it at an
absolute file path, read the plan as a clean, editorial document, and attach
review comments that are written **directly back into the original file** as
`<!-- @me -->` HTML markers. When you're ready, hand the annotated plan to
Claude Code to resolve every note in place.

Nothing leaves your machine: the app runs on `127.0.0.1`, reads and writes the
file with the Node filesystem API, and stores no database and no account.

```
  read a plan  ─▶  annotate  ─▶  Run plan review  ─▶  reload  ─▶  Implement plan
  (rendered)      (@me marks)     (Claude Code)      (resolved)   (Claude, on a branch)
```

---

## Table of contents

- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [The review workflow](#the-review-workflow)
- [The `@me` marker format](#the-me-marker-format)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Using the app](#using-the-app)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Configuration](#configuration)
- [Safety model](#safety-model)
- [Project layout](#project-layout)
- [API reference](#api-reference)
- [Scripts](#scripts)
- [Tech stack](#tech-stack)

---

## What it does

- **Beautiful preview.** Renders GitHub-flavored Markdown — headings, code,
  tables, and task lists — with editorial typography and a focused reading surface.
- **Contextual comments.** Hover any block and click the margin control to
  comment on the whole block, or select a phrase and use the floating
  **Comment** pill to comment on that exact text.
- **File-native.** Every note is appended to the source `.md` as an `@me` HTML
  comment right beside the block it refers to. There is no separate store to
  keep in sync — the plan file *is* the state.
- **One-click resolution.** **Run plan review** invokes Claude Code with
  `/plan-review <plan>`; Claude edits the plan to satisfy your notes, and the
  app reloads the updated file when it finishes.
- **One-click implementation.** **Implement plan** checks out a dedicated
  `plan/<slug>` branch and runs Claude Code with full tool access to build the
  plan, streaming its narration, tool calls, and result into a live log you can
  **Stop** at any time.
- **Ask about the plan.** The **Ask** tab is a read-only Q&A with Claude about
  the open plan — grounded in the plan file and the repository, with a
  persistent session so follow-up questions keep their context. Select text and
  hit **Ask** to question a specific part.
- **Manual Claude context.** Choose Claude account 1 or 2, then explicitly pick
  an existing repository chat or **New chat**. Ask, review, and implementation
  use that choice but retain their own command-specific permissions.
- **Safe writes.** Saves are atomic and guarded by the file's modification time
  and the exact source text of the annotated block, so a plan edited elsewhere
  is never silently clobbered.

## How it works

The frontend is a single client component (`src/app/page.tsx`) talking to a
handful of Next.js route handlers. All routes run on the Node.js runtime and are
bound to `127.0.0.1`, because they touch the local filesystem and shell and must
not be exposed to the network.

```
 browser (page.tsx)
   │
   ├─▶ POST  /api/document        read a plan file  ──▶  fs.readFile
   ├─▶ PATCH /api/document        insert an @me note ──▶ atomic write (temp + rename)
   ├─▶ POST  /api/document/pick   native file chooser ─▶ osascript (macOS)
   ├─▶ GET   /api/claude/sessions list chats ─────────▶ profile JSONL metadata
   ├─▶ POST  /api/review          resolve notes ──────▶ claude /plan-review
   ├─▶ POST  /api/implement       build the plan ─────▶ git branch + claude (streamed)
   └─▶ POST  /api/ask             answer questions ───▶ claude (read-only, streamed)
```

`/api/review`, `/api/implement`, and `/api/ask` share the Claude/git plumbing in
`src/lib/claude-cli.ts` (validating the chosen account/chat, locating the binary,
and resolving the repo).
Review blocks until Claude finishes and returns the result; implement and ask
**stream** Claude's `stream-json` events to the browser as newline-delimited JSON
so the UI can show live progress and cancel the run. Ask keeps a per-plan Claude
selected session (`--session-id` for an explicit New chat, then `--resume`) so
all command types keep the chosen context. Ask restricts Claude to read-only
tools (`Read`, `Grep`, `Glob`); review and implementation select their own
permissions from the action that was clicked.

Plan text is parsed **client-side** by `src/lib/plan-document.ts` into a flat
list of blocks — content blocks (paragraphs, headings, fenced code) and comment
blocks (parsed `@me` markers) — plus a heading outline, title, word count, and
comment count. The renderer uses that model to lay out the document, position
the hover/selection controls, and list pending notes in the review panel.

## The review workflow

1. **Open** a plan by pasting an absolute path or using **Browse…** (the native
   macOS file chooser). The last opened path and your theme choice are
   remembered in the browser; `?path=/abs/path/plan.md` opens a file on load.
2. **Annotate.** Hover a block and click the margin comment control, or select
   text (≥ 3 characters) and click the **Comment** pill. Write what should
   change and save — the note is inserted into the file next to that block.
3. Each saved note renders inline in the document *and* in the right-hand
   **Review notes** panel, tagged **Pending review**. Click a card to jump to
   its location.
4. **Run plan review.** Claude Code opens the plan, resolves every `@me` note
   (editing the plan and removing the markers as your `/plan-review` workflow
   dictates), and the app reloads the file so you see the result.
5. Repeat until the plan reads the way you want.
6. **Implement plan.** When you're happy with it, hit **Implement plan**. The
   app checks out a `plan/<slug>` branch and runs Claude Code with full tool
   access to build the plan, streaming a live log of what it edits and runs.
   **Stop** ends the run immediately; when it finishes the plan is reloaded.

This mirrors the file-native `/plan` → annotate → `/plan-review` loop: the
markers this app writes are ordinary `@me` HTML comments that plan-review
tooling already knows how to discover and resolve.

## The `@me` marker format

Comments are stored as HTML comments so they're invisible in normal Markdown
rendering but trivial to find. Literal `--` in your text is replaced with an
em dash (`—`) so it can't terminate the comment early.

**A block comment** (single line):

```md
<!-- @me: explain the rollback behavior for this migration -->
```

**A selection comment** quotes the exact text under a `Regarding:` section, so
the resolver has precise context while still discovering it as a normal `@me`
note:

```md
<!-- @me:
Regarding:
> the worker retries with exponential backoff

cap this at 5 attempts and surface a dead-letter path
-->
```

The parser reads both forms back into comment blocks, extracting the quoted
selection (if any) and the comment body.

## Prerequisites

- **Node.js 20+** (built with 24) and npm.
- **macOS** for the native **Browse…** file chooser (it shells out to
  `osascript`). On other platforms, paste an absolute path instead — everything
  else works cross-platform.
- **Claude Code** for the **Run plan review** and **Implement plan** buttons,
  with a profile that contains the `plan-review` skill. Optional otherwise.
- **Git**: the plan must live inside a git repository to use **Implement plan**
  (it works on a dedicated branch). Reading and reviewing don't require git.

## Setup

```bash
npm install
cp .env.example .env.local   # defaults work out of the box
npm run dev
```

Open **http://localhost:4823** — a non-standard port set in the `dev` / `start`
scripts (not in `.env`; Next.js does not read `PORT` from env files for the dev
server). Both commands bind to `127.0.0.1`.

## Using the app

- **Open a file:** paste an absolute `.md` / `.markdown` path in the header and
  press Enter (or **Preview**), or click **Browse…** / **Choose a plan file**.
- **Choose Claude context:** select Claude account 1 or 2, then choose an
  existing repository chat or **New chat**. No account or chat is preselected.
- **Comment on a block:** hover it and click the round control that appears in
  the left margin.
- **Comment on a selection:** select text in the document and click the floating
  **Comment** pill.
- **Save a note:** write it in the composer and click **Save note** (or press
  `⌘↵` / `Ctrl+↵`). Comments are capped at 4,000 characters, selections at
  2,000.
- **Run the review:** open the **Review notes** panel and click **Run plan
  review**. The button is disabled while Claude is working; the plan reloads
  automatically when it finishes.
- **Implement the plan:** in the **Implement** section click **Implement plan**.
  Claude works on a fresh `plan/<slug>` branch and its progress streams into a
  live log; click **Stop implementation** to end it early. Editing is disabled
  while a run is in progress. The plan is reloaded when the run ends.
- **Ask about the plan:** switch to the **Ask about plan** tab and type a
  question (Enter to send, Shift+Enter for a newline). Answers stream in and the
  thread keeps context across follow-ups. Selecting text and clicking **Ask** on
  the pill attaches that excerpt to your next question.
- **Reload from disk:** use the reload control in the document meta bar. If the
  file changed underneath you, the app shows a conflict banner instead of
  overwriting your view.
- **Toggle theme:** the header sun/moon toggle switches light/dark and remembers
  your choice; the app follows the system scheme until you choose.

## Keyboard shortcuts

| Shortcut        | Action                                            |
| --------------- | ------------------------------------------------- |
| `⌘O` / `Ctrl+O` | Focus and select the path input                   |
| `⌘↵` / `Ctrl+↵` | Save the note you're composing                    |
| `Esc`           | Close the composer / dismiss the selection pill   |

## Configuration

Set in `.env.local` (see `.env.example`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `CLAUDE_ONE_CONFIG_DIR` | `~/.claude-one` | Profile for Claude account 1 |
| `CLAUDE_TWO_CONFIG_DIR` | `~/.claude-two` | Profile for Claude account 2 |
| `CLAUDE_ONE_LABEL` | `Claude account 1` | Optional account 1 display label |
| `CLAUDE_TWO_LABEL` | `Claude account 2` | Optional account 2 display label |
| `CLAUDE_BIN` | `~/.local/bin/claude` or `PATH` | Path to the Claude Code executable |

All Claude actions use the manually selected account. When `CLAUDE_BIN` is
unset the app tries `~/.local/bin/claude` and then `claude` on `PATH`. Review
runs with `cwd` at the nearest `.git` ancestor of the plan;
implement uses the plan's git top-level directory and requires the plan to live
inside a git repository (so it can work on a branch).

## Safety model

- **Local only.** All routes run on `127.0.0.1`; the file APIs never accept
  network connections.
- **Path validation.** Paths must be **absolute** and end in `.md` /
  `.markdown`; they're resolved with `realpath` and must point at a regular
  file under the 5 MB preview limit (`src/lib/plan-file.ts`).
- **Atomic writes.** A note is written to a sibling temp file (with the
  original's mode) and then `rename`d over the target, so a reader never sees a
  half-written plan.
- **Conflict detection.** Every write includes the document's expected `mtimeMs`
  *and* the exact source text of the annotated block. If either has changed on
  disk, the API returns `409 DOCUMENT_CHANGED` and the UI asks you to reload
  instead of overwriting the newer version.
- **Concurrency guard.** All command types share a lock for the manually chosen
  account/chat, so a question, review, and implementation can never resume the
  same chat concurrently. Locks are released on completion, error, timeout,
  abort, and stream cancellation. Review times out after 15 minutes,
  implementation after 60, and questions after 10.
- **Ask is read-only.** `/api/ask` runs Claude with `--allowedTools Read Grep
  Glob` — it can read and search the repo to answer, but has no ability to edit
  files or run commands.
- **Implement is a deliberate, powerful action.** `/api/implement` runs Claude
  Code with `--permission-mode bypassPermissions`, so it edits files and runs
  commands unattended. To contain that, it always works on a dedicated
  `plan/<slug>` branch (created/checked out first) and refuses to run on a plan
  that isn't inside a git repository — so the generated work is isolated and
  easy to review, diff, or discard. **Stop** aborts the request, which kills the
  Claude process.

## Project layout

```
src/
├── lib/
│   ├── plan-file.ts      Absolute-path validation + size/type guard (shared by routes)
│   ├── plan-document.ts  Client-side Markdown → blocks/outline/@me-comment parser
│   └── claude-cli.ts     Manual account/chat validation + Claude/git helpers
└── app/
    ├── api/
    │   ├── claude/sessions/route.ts  GET repository chats for one account
    │   ├── document/
    │   │   ├── route.ts        POST read a plan · PATCH insert an @me note (atomic)
    │   │   └── pick/route.ts   POST native macOS file chooser (osascript)
    │   ├── review/route.ts     POST run Claude Code /plan-review for the plan
    │   ├── implement/route.ts  POST implement the plan on a branch (streamed NDJSON)
    │   └── ask/route.ts        POST read-only Q&A about the plan (streamed NDJSON)
    ├── layout.tsx        Fonts, no-flash theme bootstrap, document metadata
    ├── globals.css       The full visual design system
    └── page.tsx          The reader + reviewer client component
```

## API reference

All routes use the Node.js runtime.

- **`POST /api/document`** — body `{ path }`. Returns
  `{ path, content, mtimeMs, size }` for the resolved plan.
- **`PATCH /api/document`** — body
  `{ path, comment, startLine, endLine, anchor, selection?, expectedMtimeMs }`.
  Inserts an `@me` marker next to the block and returns the reloaded document.
  Returns `409 DOCUMENT_CHANGED` if the file or the anchored block changed on
  disk.
- **`POST /api/document/pick`** — no body. Opens the native macOS file chooser
  and returns `{ path }` (or `204` if cancelled, `501` off macOS).
- **`GET /api/claude/sessions`** — query `{ path, accountId }`. Returns safe
  chat metadata for that account and repository; transcript contents and paths
  are never returned.
- **`POST /api/review`** — body `{ path, accountId, sessionId?, newChat }`.
  Runs Claude Code `/plan-review <path>` and returns `{ ok, output, sessionId }`. Returns `409` if a review
  of that plan is already running.
- **`POST /api/implement`** — body `{ path, accountId, sessionId?, newChat }`. Checks out a `plan/<slug>` branch
  and runs Claude Code with `bypassPermissions`, streaming newline-delimited
  JSON events as it works: `{type:"status"|"assistant"|"tool"}`, then
  `{type:"result", text, ok}`, and finally `{type:"done", branch, sessionId}` (or
  `{type:"error", error}`). Returns `400` if the plan isn't in a git repo and
  `409` if that plan or selected chat is already running a command. Aborting
  the request stops the run and releases its locks.
- **`POST /api/ask`** — body
  `{ path, question, selection?, accountId, sessionId?, newChat }`. Runs
  Claude Code read-only (`Read`/`Grep`/`Glob`) and streams newline-delimited
  JSON: `{type:"research"}` for each file/search, `{type:"answer", text}` chunks,
  then `{type:"done", sessionId}` (or `{type:"error", error}`). Pass the returned
  `sessionId` back to continue the same conversation. Returns `409` if the
  selected chat is already handling a question, review, or implementation;
  aborting stops the run and releases the chat.

## Scripts

| Command         | Description                          |
| --------------- | ------------------------------------ |
| `npm run dev`   | Dev server on `127.0.0.1:4823`       |
| `npm run build` | Production build                     |
| `npm run start` | Serve the build on `127.0.0.1:4823`  |
| `npm run lint`  | ESLint                               |

## Tech stack

- **Next.js 16** (App Router) and **React 19**
- **react-markdown** + **remark-gfm** for rendering
- **Tailwind CSS v4** (via `@tailwindcss/postcss`) alongside the design system
  in `globals.css`
- **TypeScript** throughout
