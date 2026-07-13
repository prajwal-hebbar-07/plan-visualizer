# Plan Visualizer

A local-first [Next.js](https://nextjs.org) app that turns `/plan` markdown files
into the view a full-stack engineer actually reviews from: an end-to-end **system
flow** of each feature — trigger → request payload → API contract → server
processing → response shape → how the frontend applies it — with the concrete
typed data contract at every boundary. Reconstructed by **MiniMax** (via **Ollama
Cloud**). Inline notes are written **straight back into the `.md` file** as `@me`
comments — the exact format `/plan-review` consumes.

## What it does

The plan opens in three tabs; **System flow** is the default and the point.

1. **Pick a plan** — a sidebar file picker browses `.md` files under a configured
   plans directory (`PLANS_DIR`).
2. **System flow (the centerpiece, auto)** — for each feature the plan builds,
   MiniMax reconstructs the runtime data flow the way a senior dev traces it: an
   ordered list of **hops** (frontend → api → service → db → …), each showing the
   component/endpoint, the concrete action (`POST /api/autofill`), the server-side
   **processing** steps, and the **data contract crossing that boundary** rendered
   as a typed schema (`AutofillRequest { formId: string, context: Record<string,string> }`).
   Plus per-feature error/edge cases, "scrutinise" points, and which plan steps
   implement it. Because the terse `/plan` markdown doesn't spell this out, it's
   AI-inferred — a concrete proposal to review, clearly labelled as analysis.
3. **Plan tab** — the parsed plan: phases, steps with status/effort/dependencies,
   milestones, risks, open questions. Comment on any step (see below).
4. **Structure tab** — a deterministic **dependency DAG** (critical path,
   ready/blocked, max parallelism) and the author's `## Shape` diagrams rendered by
   MiniMax as clean technical SVGs. Secondary by design — diagrams aren't the point.
5. **Comment** — leave an inline note on any step; it's inserted into the source
   file as `<!-- @me (author, date): … -->` and picked up verbatim by `/plan-review`.

Parsing, the dependency DAG, and comment round-trips are 100% deterministic; MiniMax
provides the system-flow reconstruction and the shape-diagram rendering.

## How the integration works

You run Ollama locally. The local daemon (`http://127.0.0.1:11434`) serves local
models directly and transparently **proxies cloud model tags** (anything ending
in `:cloud`) to Ollama Cloud. So the app only ever talks to `localhost`, and
switching between local and cloud models is just a change of model tag.

```
 browser ──▶ Next.js API routes ──▶ local Ollama daemon ──▶ Ollama Cloud
 (page)      /api/health, /api/chat   127.0.0.1:11434         minimax-m2.7:cloud
```

## Prerequisites

- **Node.js** 20+ (built with 24) and npm
- **[Ollama](https://ollama.com)** installed and running (`ollama serve`)
- Signed in for cloud models: `ollama signin`

The default model is `minimax-m2.7:cloud`.
(`minimax-m2` was retired 2026-06-16; `minimax-m2.7` is the current MiniMax.)

## Setup

```bash
npm install
cp .env.example .env.local   # defaults already work for a local Ollama
npm run dev
```

Open **http://localhost:4823** — a non-standard port set in the `dev`/`start`
scripts. Pick a plan from the sidebar to render it.

## Configuration

Set in `.env.local` (see `.env.example`):

| Variable       | Default                     | Purpose                                              |
| -------------- | --------------------------- | ---------------------------------------------------- |
| `OLLAMA_HOST`  | `http://127.0.0.1:11434`    | URL of your local Ollama daemon                      |
| `OLLAMA_MODEL` | `minimax-m2.7:cloud`        | Model tag (`:cloud` = cloud model, needs `signin`)   |
| `PLANS_DIR`    | the plan-training-data corpus | Directory the file picker browses and writes comments into (paths are confined to it) |

The port (`4823`) lives in `package.json` scripts, not `.env` — Next.js does not
read `PORT` from env files for the dev server.

## Project layout

```
src/
├── lib/
│   ├── env.ts          Runtime config (host, model, plansDir) + cloud helper
│   ├── ollama.ts       Ollama client, health check, streaming chat helper
│   ├── stream.ts       Client NDJSON stream reader + SVG sanitizer
│   ├── json.ts         Balanced-object extraction + truncation repair for LLM JSON
│   └── plan/
│       ├── types.ts    Plan/Step/Phase + system-flow (Feature/Hop/DataContract) model
│       ├── parse.ts    Deterministic plan-grammar parser (with source lines)
│       ├── graph.ts    Dependency-DAG layout + scheduling insights
│       ├── fs.ts       Root-confined file listing/read/write
│       ├── comments.ts Insert/remove `@me` notes in the raw markdown
│       └── display.ts  Status/effort presentational metadata
└── app/
    ├── api/
    │   ├── health/     GET  — is the daemon reachable? which model?
    │   ├── chat/       POST — streams a chat completion as NDJSON
    │   ├── plans/      GET  — list `.md` files/dirs under PLANS_DIR
    │   ├── plan/       GET  — read + parse a plan file
    │   ├── comment/    POST/DELETE — add/remove an `@me` note, rewrite the file
    │   ├── flow/       POST — AI-reconstructed system flow (features → hops + contracts)
    │   └── visualize/  POST — stream an SVG diagram from MiniMax
    ├── components/     FilePicker, PlanView (tabs), FlowView, DependencyGraph, DiagramBlock
    ├── layout.tsx
    └── page.tsx        Sidebar picker + rendered plan
```

### API

- `GET /api/health` → `{ ok, host, model, cloud, localModels?, error? }`
- `POST /api/chat` — body `{ messages, model?, think? }`, NDJSON events.
- `GET /api/plans?dir=` → `{ root, dir, parent, entries }`
- `GET /api/plan?path=` → `{ plan }` (parsed structure)
- `POST /api/comment` — body `{ path, text, stepNumber?, author? }` → `{ plan }`
- `DELETE /api/comment` — body `{ path, raw }` → `{ plan }`
- `POST /api/flow` — body `{ path }` → `{ flow }` (summary, features[] with hops +
  data contracts + processing + errors + scrutinise, cross-cutting decisions)
- `POST /api/visualize` — body `{ mode:"diagram"|"narrative", prompt?, ascii?, planTitle?, mood? }`,
  streams `{type:"content", text}` NDJSON.

## Scripts

| Command         | Description                          |
| --------------- | ------------------------------------ |
| `npm run dev`   | Dev server on port 4823              |
| `npm run build` | Production build                     |
| `npm run start` | Serve the build on port 4823         |
| `npm run lint`  | ESLint                               |
