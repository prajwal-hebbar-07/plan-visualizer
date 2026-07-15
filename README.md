# Plan Visualizer

A local-first review surface for Markdown implementation plans. Give it an
absolute file path, read the plan in a focused preview, and attach contextual
comments that are written directly back to the document as `@me` HTML markers.

Those markers are compatible with the local plan review workflow: review the
notes to revise the plan, then implement the approved result. The existing
Ollama integration remains available through its API routes for future assisted
review features.

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
scripts. Both commands bind to `127.0.0.1`, because the document API has local
filesystem access and must not be exposed to the network. Paste an absolute path
to a `.md` or `.markdown` file into the header, or use **Choose a plan file** to
open the native macOS file chooser.
The last opened path is remembered locally in the browser. You can also open a
file with `http://localhost:4823/?path=/absolute/path/to/plan.md`.
The interface follows the system color scheme initially; use the header toggle
to choose and remember light or dark mode explicitly.

Hover over any rendered block to add a comment. Saving inserts a nearby marker:

```md
<!-- @me: explain the rollback behavior for this migration -->
```

Writes are atomic and guarded by the file modification time and selected source
text. If the file changes in another editor, the app asks you to reload instead
of overwriting it.

## Configuration

Set in `.env.local` (see `.env.example`):

| Variable       | Default                     | Purpose                                              |
| -------------- | --------------------------- | ---------------------------------------------------- |
| `OLLAMA_HOST`  | `http://127.0.0.1:11434`    | URL of your local Ollama daemon                      |
| `OLLAMA_MODEL` | `minimax-m2.7:cloud`        | Model tag (`:cloud` = cloud model, needs `signin`)   |

The port (`4823`) lives in `package.json` scripts, not `.env` — Next.js does not
read `PORT` from env files for the dev server.

## Project layout

```
src/
├── lib/
│   ├── env.ts          Runtime config (host, model) + cloud-model helper
│   └── ollama.ts       Ollama client, health check, streaming chat helper
└── app/
    ├── api/
    │   ├── document/   POST — open a local plan; PATCH — add a review marker
    │   ├── health/     GET  — is the daemon reachable? which model?
    │   └── chat/       POST — streams a chat completion as NDJSON
    ├── layout.tsx
    └── page.tsx        Plan preview and contextual review interface
```

### API

- `GET /api/health` → `{ ok, host, model, cloud, localModels?, error? }`
- `POST /api/document` — body `{path}`, returns the local Markdown and metadata
- `PATCH /api/document` — appends a guarded `@me` comment beside a source block
- `POST /api/chat` — body `{ messages: {role, content}[], model?, think? }`,
  responds with NDJSON events: `{type:"thinking"|"content", text}`, then
  `{type:"done"}` (or `{type:"error", error}`).

## Scripts

| Command         | Description                          |
| --------------- | ------------------------------------ |
| `npm run dev`   | Dev server on port 4823              |
| `npm run build` | Production build                     |
| `npm run start` | Serve the build on port 4823         |
| `npm run lint`  | ESLint                               |
