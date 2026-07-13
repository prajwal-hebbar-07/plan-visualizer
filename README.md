# Plan Visualizer

A local-first [Next.js](https://nextjs.org) app wired up to **Ollama Cloud** via
your **local Ollama daemon**, using a **MiniMax** model by default.

> **Status:** scaffold. The Next.js app, the Ollama/MiniMax integration, and the
> local port are set up and verified. The plan-visualization/review features are
> built on top of this foundation.

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
scripts. The home page shows the Ollama connection status and a box to stream a
test prompt through the model, so you can confirm the integration end-to-end.

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
    │   ├── health/     GET  — is the daemon reachable? which model?
    │   └── chat/       POST — streams a chat completion as NDJSON
    ├── layout.tsx
    └── page.tsx        Connection status + model test box
```

### API

- `GET /api/health` → `{ ok, host, model, cloud, localModels?, error? }`
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
