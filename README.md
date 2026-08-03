> [!IMPORTANT]
>
> ## Project status: Active prototype
>
> This repository contains the original implementation of the engineering-plan review tool and remains available as an active prototype and technical reference.
>
> The newer, productized version is being developed as **[SpecLens](https://github.com/prajwal-hebbar-07/spec-lens)**.

# Plan Visualizer

Plan Visualizer is a local-first Next.js application for reviewing engineering implementation plans.

It transforms `/plan` Markdown files into the view a full-stack engineer typically needs during technical review: an end-to-end representation of how each feature moves through the system.

Instead of displaying only phases, tasks, and diagrams, Plan Visualizer reconstructs the complete runtime flow:

```text
Trigger
  → frontend action
  → request payload
  → API contract
  → server-side processing
  → service and database interactions
  → response shape
  → frontend state update
```

Every major boundary includes the concrete typed data contract crossing it.

The system-flow analysis is generated using **MiniMax through Ollama Cloud**, while plan parsing, dependency analysis, and comment persistence remain deterministic.

Inline review comments are written directly back into the source Markdown file using the `@me` comment format expected by `/plan-review`.

---

## Why this exists

Engineering plans often describe what needs to be implemented without fully explaining how data moves through the application.

A plan might mention:

* Add an autofill endpoint
* Create a service layer
* Update the frontend state
* Store the generated result

However, an engineer reviewing the plan still needs to determine:

* What triggers the flow?
* Which component sends the request?
* What does the request payload contain?
* Which API route handles it?
* What processing happens on the server?
* Which services and database operations are involved?
* What response is returned?
* How does the frontend apply the response?
* What failure cases are missing?
* Which data contracts exist at each boundary?

Plan Visualizer reconstructs this information as an explicit technical proposal that can be reviewed before implementation begins.

---

## Core capabilities

### 1. Browse plan files

The sidebar file picker browses Markdown files within the configured `PLANS_DIR`.

The application can:

* Navigate directories
* List available `.md` plan files
* Read and parse a selected plan
* Write review comments back into the selected file
* Confine all file access to the configured plans directory

---

### 2. Review the system flow

The **System Flow** tab is the default view and the main purpose of the application.

For each feature identified in the plan, MiniMax reconstructs an ordered set of runtime hops.

A flow may look like:

```text
Frontend form
  → POST /api/autofill
  → API route validation
  → autofill service
  → model provider
  → normalized response
  → frontend form state
```

Each hop can contain:

* Component, route, service, or database involved
* Concrete action or endpoint
* Server-side processing steps
* Input data contract
* Output data contract
* Error and edge cases
* Areas requiring additional scrutiny
* References to the plan steps responsible for implementation

Example contract:

```ts
interface AutofillRequest {
  formId: string;
  context: Record<string, string>;
}

interface AutofillResponse {
  fields: Array<{
    name: string;
    value: string;
    confidence?: number;
  }>;
}
```

Because most `/plan` documents do not explicitly define every runtime interaction, the system flow is clearly presented as **AI-generated analysis**, not as confirmed implementation truth.

---

### 3. Inspect the parsed plan

The **Plan** tab displays the deterministic representation of the source Markdown plan.

It includes:

* Phases
* Implementation steps
* Step status
* Estimated effort
* Dependencies
* Milestones
* Risks
* Open questions
* Existing review comments

Each parsed item retains its source-line information so comments can be written back to the correct location in the original file.

---

### 4. Analyze plan structure

The **Structure** tab provides supporting architectural views.

It includes:

#### Dependency graph

A deterministic directed acyclic graph generated from plan-step dependencies.

The graph identifies:

* Ready steps
* Blocked steps
* Dependency chains
* Critical path
* Maximum parallelism
* Potential implementation scheduling

#### Shape diagrams

Diagrams written under the plan's `## Shape` section can be converted into clean technical SVGs using MiniMax.

These diagrams are supporting material. The primary focus of the application remains the feature-level system flow.

---

### 5. Add inline review comments

Review comments can be attached to individual plan steps.

Comments are inserted directly into the source Markdown file in the following format:

```html
<!-- @me (author, date): Review comment -->
```

These comments can then be consumed verbatim by `/plan-review`.

This creates a direct review loop:

```text
Generate plan
  → inspect it in Plan Visualizer
  → add inline review comments
  → run /plan-review
  → update the implementation plan
```

---

## Deterministic and AI-assisted responsibilities

Plan Visualizer deliberately separates deterministic application behaviour from AI-generated analysis.

### Deterministic

The following operations do not depend on an LLM:

* Markdown plan parsing
* Phase and step extraction
* Source-line tracking
* Dependency graph generation
* Critical-path analysis
* Ready and blocked step calculation
* File-system confinement
* Plan file reading
* Comment insertion and removal
* Markdown round-tripping

### AI-assisted

MiniMax is used for:

* Feature identification
* Runtime system-flow reconstruction
* Boundary and contract inference
* Error and edge-case identification
* Scrutiny-point generation
* Shape-diagram rendering
* Technical narrative generation

AI-generated output should be treated as a concrete review proposal rather than a guaranteed representation of the final implementation.

---

## Architecture

The application communicates only with the local Ollama daemon.

Ollama serves local models directly and proxies supported cloud model tags to Ollama Cloud.

```text
┌──────────────┐
│   Browser    │
│ Next.js page │
└──────┬───────┘
       │
       ▼
┌────────────────────────────┐
│      Next.js API routes    │
│                            │
│ /api/health                │
│ /api/chat                  │
│ /api/plans                 │
│ /api/plan                  │
│ /api/comment               │
│ /api/flow                  │
│ /api/visualize             │
└────────────┬───────────────┘
             │
             ▼
┌────────────────────────────┐
│    Local Ollama daemon     │
│  http://127.0.0.1:11434    │
└────────────┬───────────────┘
             │
             ▼
┌────────────────────────────┐
│       Ollama Cloud         │
│    minimax-m2.7:cloud      │
└────────────────────────────┘
```

Switching between a local model and a cloud-hosted model only requires changing the configured Ollama model tag.

---

## Prerequisites

Before running the application, install:

* Node.js 20 or later
* npm
* Ollama

The project was developed using Node.js 24.

Start the Ollama daemon:

```bash
ollama serve
```

To use Ollama Cloud models, sign in:

```bash
ollama signin
```

The default model is:

```text
minimax-m2.7:cloud
```

---

## Getting started

Install the dependencies:

```bash
npm install
```

Create the local environment file:

```bash
cp .env.example .env.local
```

The default configuration works with a locally running Ollama daemon.

Start the development server:

```bash
npm run dev
```

Open the application at:

```text
http://localhost:4823
```

Select a plan from the sidebar to begin reviewing it.

---

## Configuration

Configuration is defined in `.env.local`.

| Variable       | Default                   | Description                                    |
| -------------- | ------------------------- | ---------------------------------------------- |
| `OLLAMA_HOST`  | `http://127.0.0.1:11434`  | URL of the local Ollama daemon                 |
| `OLLAMA_MODEL` | `minimax-m2.7:cloud`      | Ollama model tag used for AI-assisted features |
| `PLANS_DIR`    | Plan training-data corpus | Root directory browsed by the plan picker      |

Example:

```env
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=minimax-m2.7:cloud
PLANS_DIR=/absolute/path/to/plans
```

All plan paths are confined to `PLANS_DIR` before files are read or modified.

### Application port

The application runs on port `4823`.

The port is configured in the `dev` and `start` scripts inside `package.json`.

It is not configured through `.env.local`, because the Next.js development server does not automatically read a `PORT` value from environment files.

---

## Project structure

```text
src/
├── lib/
│   ├── env.ts
│   ├── ollama.ts
│   ├── stream.ts
│   ├── json.ts
│   └── plan/
│       ├── types.ts
│       ├── parse.ts
│       ├── graph.ts
│       ├── fs.ts
│       ├── comments.ts
│       └── display.ts
└── app/
    ├── api/
    │   ├── health/
    │   ├── chat/
    │   ├── plans/
    │   ├── plan/
    │   ├── comment/
    │   ├── flow/
    │   └── visualize/
    ├── components/
    ├── layout.tsx
    └── page.tsx
```

### Library modules

| File                   | Responsibility                                                        |
| ---------------------- | --------------------------------------------------------------------- |
| `lib/env.ts`           | Runtime configuration for the Ollama host, model, and plans directory |
| `lib/ollama.ts`        | Ollama client, health checks, and streaming chat helpers              |
| `lib/stream.ts`        | Client-side NDJSON stream reader and SVG sanitization                 |
| `lib/json.ts`          | Balanced JSON extraction and truncated-response repair                |
| `lib/plan/types.ts`    | Plan, phase, step, feature, hop, and data-contract models             |
| `lib/plan/parse.ts`    | Deterministic parser for the supported plan grammar                   |
| `lib/plan/graph.ts`    | Dependency graph layout and scheduling analysis                       |
| `lib/plan/fs.ts`       | Root-confined plan file listing, reading, and writing                 |
| `lib/plan/comments.ts` | Insertion and removal of `@me` review comments                        |
| `lib/plan/display.ts`  | Presentation metadata for status and effort values                    |

### Application components

The `app/components` directory contains the main interface components, including:

* `FilePicker`
* `PlanView`
* `FlowView`
* `DependencyGraph`
* `DiagramBlock`

The main `page.tsx` component connects the plan picker with the selected plan's review interface.

---

## API reference

### Health check

```http
GET /api/health
```

Example response:

```json
{
  "ok": true,
  "host": "http://127.0.0.1:11434",
  "model": "minimax-m2.7:cloud",
  "cloud": true,
  "localModels": []
}
```

An unsuccessful response may also include an `error` field.

---

### Chat completion

```http
POST /api/chat
```

Request body:

```json
{
  "messages": [],
  "model": "minimax-m2.7:cloud",
  "think": false
}
```

The endpoint streams NDJSON events.

---

### Browse plan files

```http
GET /api/plans?dir=
```

Example response:

```json
{
  "root": "/absolute/path/to/plans",
  "dir": "",
  "parent": null,
  "entries": []
}
```

---

### Read and parse a plan

```http
GET /api/plan?path=
```

Example response:

```json
{
  "plan": {}
}
```

---

### Add a review comment

```http
POST /api/comment
```

Request body:

```json
{
  "path": "plans/plan-example.md",
  "text": "Clarify the response contract for this endpoint.",
  "stepNumber": 4,
  "author": "Prajwal"
}
```

Example response:

```json
{
  "plan": {}
}
```

---

### Remove a review comment

```http
DELETE /api/comment
```

Request body:

```json
{
  "path": "plans/plan-example.md",
  "raw": "<!-- @me (Prajwal, 2026-08-03): Clarify the contract. -->"
}
```

Example response:

```json
{
  "plan": {}
}
```

---

### Generate the system flow

```http
POST /api/flow
```

Request body:

```json
{
  "path": "plans/plan-example.md"
}
```

The response contains:

* Overall summary
* Identified features
* Ordered runtime hops
* Typed data contracts
* Processing steps
* Error and edge cases
* Scrutiny points
* Related plan steps
* Cross-cutting architectural decisions

Example response shape:

```json
{
  "flow": {
    "summary": "End-to-end system-flow analysis",
    "features": [],
    "crossCuttingDecisions": []
  }
}
```

---

### Generate a visualization

```http
POST /api/visualize
```

Request body:

```json
{
  "mode": "diagram",
  "prompt": "Render the system architecture",
  "ascii": "browser -> api -> service -> database",
  "planTitle": "Example implementation plan",
  "mood": "technical"
}
```

Supported modes:

```text
diagram
narrative
```

The endpoint streams NDJSON events in the following shape:

```json
{
  "type": "content",
  "text": "<svg>...</svg>"
}
```

---

## Scripts

| Command         | Description                                 |
| --------------- | ------------------------------------------- |
| `npm run dev`   | Start the development server on port `4823` |
| `npm run build` | Create a production build                   |
| `npm run start` | Serve the production build on port `4823`   |
| `npm run lint`  | Run ESLint                                  |

---

## Typical review workflow

```text
1. Generate an engineering plan using /plan
2. Open Plan Visualizer
3. Select the generated Markdown file
4. Review the AI-reconstructed system flow
5. Inspect dependencies and implementation phases
6. Add inline @me comments
7. Run /plan-review
8. Update the plan before implementation
```

---

## Limitations

* System-flow reconstruction is inferred from the plan and may contain incorrect assumptions.
* Generated contracts are proposals unless they already exist explicitly in the source plan.
* Diagram quality depends on the selected model.
* The plan parser expects the supported `/plan` Markdown structure.
* The application is intended for local development workflows.
* The configured plans directory must be accessible to the local Next.js process.

---

## Relationship to SpecLens

Plan Visualizer is the original implementation and experimentation ground for the engineering-plan review workflow.

The productized successor is being developed as **SpecLens**:

**[github.com/prajwal-hebbar-07/spec-lens](https://github.com/prajwal-hebbar-07/spec-lens)**

SpecLens continues the core idea of reviewing engineering plans through implementation flows, data contracts, architectural context, and structured developer feedback while evolving it into a more complete product.
