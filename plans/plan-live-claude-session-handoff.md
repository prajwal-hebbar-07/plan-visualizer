# Manual Claude account and chat selection

Status: reviewed (round 2) — 2026-07-16

## Summary

Plan Visualizer currently chooses a Claude profile by search order and the in-progress Ask feature silently creates a new Claude session when no session ID exists. That is the wrong interaction for a machine with two Claude accounts: the user, not the application, must decide both which account runs the work and whether to resume a specific existing chat or start a new chat.

Add a manual two-step selector to the work panel. First choose **Claude account 1** or **Claude account 2**. Then choose one repository-scoped existing chat or an explicit **New chat** option. No hooks, tmux handoff, live-session discovery, automatic account selection, automatic chat selection, or implicit new chat are required. The chosen account/chat is passed to Ask, plan review, and implementation so those actions use the same manually selected context.

## Context and current state

- `src/lib/claude-cli.ts:findClaudeConfigDir` honors one `CLAUDE_CONFIG_DIR` or returns the first of `.claude`, `.claude-one`, and `.claude-two` containing `plan-review`. It cannot represent a deliberate choice between the two configured accounts.
- `src/app/api/ask/route.ts:POST` is an untracked working-tree feature. It generates a UUID when `sessionId` is absent, runs Claude under the auto-detected profile, returns the UUID, and uses `--resume` for later questions. The React client keeps that ID only in `askSessionId.current`.
- `src/app/api/review/route.ts:POST` and `src/app/api/implement/route.ts:POST` also use the auto-detected profile. Both currently pass `--no-session-persistence`, so their work cannot be attached to a selected chat.
- Claude profile history exists under `~/.claude-one/projects/` and `~/.claude-two/projects/`. Each main session is a UUID-named JSONL file. Observed records include `sessionId`, `cwd`, `timestamp`, top-level user messages, and `ai-title.aiTitle`; these are sufficient to build a small manual picker without exposing raw transcripts to the browser.
- `claude --resume <uuid>` resumes a selected chat and `--session-id <uuid>` starts a specified new chat. The CLI already supports the desired execution model; the missing piece is explicit UI/API selection and validation.
- The left Contents rail and its active-section state have already been removed from `src/app/page.tsx` and `src/app/globals.css` in the working tree. That completed layout edit is not part of this feature plan.
- The application is local-only, but its Next.js Route Handlers are still HTTP endpoints. Account IDs and session IDs must be treated as untrusted input and resolved against a fixed server-side allowlist.

## Goals

- Require an explicit account choice between the two configured Claude profiles before any Claude action can run.
- After choosing an account, require an explicit choice between a listed existing chat and **New chat**; never preselect either.
- Show enough chat metadata—title, last activity, and a short last-user-message preview—to make the manual choice understandable without rendering conversation contents.
- Use the selected account and chat consistently for Ask, plan review, and implementation.
- Keep a newly chosen chat as one continuing session after its first action returns a Claude session ID.
- Allow the user to change account/chat deliberately when no Claude action is running.

## Non-goals

- Automatically determining which account or chat created the plan.
- Connecting to a live Claude terminal, tmux pane, hook, transcript tail, Remote Control session, or browser capability handoff.
- Automatically selecting the most recent chat or silently creating a new chat.
- Rendering full prior chat history, thinking blocks, tools, attachments, or subagent messages in Plan Visualizer.
- Synchronizing Codex conversations with Claude.
- Modifying either Claude profile's settings, hooks, skills, or dotfiles.

## Proposed design

### 1. Fixed account registry

Replace single-profile discovery for user-triggered Claude actions with a server-only registry in `src/lib/claude-cli.ts`. Expose only stable IDs and display labels to the client:

| Account ID | Default config directory | Display label |
| --- | --- | --- |
| `claude-one` | `~/.claude-one` | Claude account 1 |
| `claude-two` | `~/.claude-two` | Claude account 2 |

Allow optional `CLAUDE_ONE_CONFIG_DIR`, `CLAUDE_TWO_CONFIG_DIR`, `CLAUDE_ONE_LABEL`, and `CLAUDE_TWO_LABEL` overrides for machine portability. Never accept a config-directory path from the browser. A requested account ID must resolve through this registry and the directory must exist before it is returned to a route.

The selector has no default selection. The current `CLAUDE_CONFIG_DIR` behavior can remain as a documented compatibility fallback for non-interactive/internal callers during rollout, but browser actions must send an account ID once the UI ships.

### 2. Repository-scoped chat listing

Add `[new] GET /api/claude/sessions?path=<plan>&accountId=<id>`. Resolve the plan with `resolvePlanPath`, determine its repository root with `findProjectRoot`, resolve the selected account through the fixed registry, then enumerate that profile's main UUID JSONL files.

For each candidate, stream only the small set of fields needed to establish identity and presentation. Include a session only when a non-sidechain main record has a `cwd` within the same repository root. Return a bounded, newest-first list of DTOs:

```ts
type ClaudeSessionOption = {
  id: string;
  title: string;
  updatedAt: string;
  preview?: string;
};
```

Prefer the latest `ai-title.aiTitle`; fall back to the first meaningful user message and finally an abbreviated session ID. Derive activity from the latest valid timestamp or file mtime. Return no transcript path, raw JSON, assistant output, tool data, or profile path. Skip malformed/unreadable files individually and return a clear account-level error only when the profile/history directory itself cannot be read.

The list endpoint is read-only and may use a short process-memory cache keyed by account and repository root, invalidated by a Refresh action or brief TTL. Caching must not choose a chat.

### 3. Explicit two-step selection UI

Add a compact **Claude context** section at the top of the work panel, above the Review/Ask tabs or their action content:

1. Show two account cards/buttons. Neither is selected initially.
2. After an account click, fetch that account's chats for the open plan repository.
3. Show **New chat** as a deliberate first option followed by the existing chat list. Neither is selected initially.
4. Enable Ask, Run plan review, and Implement plan only after a chat option is selected.

The selected summary remains visible in compact form, for example `Claude account 2 · Update project documentation`, with a Change action. Switching accounts clears the chat selection, Ask thread, and any allocated new-session ID. Switching chats clears the app-visible Ask thread so responses from different Claude contexts are never presented as one conversation.

Do not choose the first account, newest chat, last-used chat, or New chat automatically. Do not persist a choice in `localStorage`. A same-page document reload may retain the current selection; opening a different plan resets both steps. Disable Change while an action is running. For an existing session, show a brief warning that the same chat should not be actively used in another Claude process at the same time.

### 4. One request contract for every Claude action

Introduce a shared request selection:

```ts
type ClaudeSelection = {
  accountId: "claude-one" | "claude-two";
  sessionId?: string; // existing chat, or allocated after New chat starts
  newChat: boolean;
};
```

Every Claude route validates this selection server-side. Existing session IDs must be UUIDs found under the selected account and scoped to the plan repository. `newChat: true` is valid only without an existing session on the first action. The server generates the UUID for that first action, launches with `--session-id`, and returns it; the client then converts its selection to that existing session ID for all later actions. No route may create a new session merely because selection data is missing.

Add a shared session lock keyed by account ID plus session ID so Ask, review, and implementation cannot concurrently resume the same chat. Plan-level guards may remain for their existing UI semantics, but separate per-route sets are insufficient once all actions share chats.

### 5. Apply selection to Ask, review, and implementation

- `src/app/api/ask/route.ts:POST` accepts the manual selection, applies the chosen profile through `CLAUDE_CONFIG_DIR`, and uses `--resume` or `--session-id` accordingly. It retains its read-only `Read`, `Grep`, and `Glob` tool restriction and NDJSON stream.
- `src/app/api/review/route.ts:POST` accepts the same selection, removes `--no-session-persistence`, and runs `/plan-review <path>` in the chosen/new chat with `acceptEdits`. Its response includes the effective session ID.
- `src/app/api/implement/route.ts:POST` accepts the same selection, removes `--no-session-persistence`, and runs the implementation prompt in the chosen/new chat on the existing dedicated plan branch. Its final event includes the effective session ID as well as the branch.

The client updates its selected session ID from any successful action, not only Ask, so choosing **New chat** once creates a single continuing chat regardless of which action runs first. Failures before Claude starts leave the selection as New chat; once the CLI creates a persisted session, a returned session ID becomes authoritative.

The selected chat supplies conversational context, but each action retains its current permission boundary: Ask stays read-only, review can edit the plan, and implementation retains full implementation permissions. The UI must state those action-specific permissions rather than implying that the account/chat choice changes them.

### 6. Failure and compatibility behavior

- A missing account/chat selection returns `400 SELECTION_REQUIRED`; the UI normally prevents this request.
- An unknown account, invalid UUID, cross-account session, session outside the plan repository, or disappeared transcript fails explicitly and never falls back to another account/chat or New chat.
- If an existing chat is concurrently active elsewhere and Claude refuses or produces a lock/conflict error, surface that error with guidance to choose another chat or New chat. Do not auto-fork or auto-switch.
- If a selected account has no repository chats, show an empty state with only the explicit New chat action.
- Manually opened plans and `?path=` links continue to work; they simply show the unselected account step before Claude actions are available.
- The existing path-only plan-opening skill remains unchanged because session association now happens entirely through manual application UI.

## Change inventory

| Area | Current artifact | Planned change |
| --- | --- | --- |
| Account/session helpers | `src/lib/claude-cli.ts:findClaudeConfigDir`, `claudeEnv`, `findProjectRoot` | Add the fixed two-account registry, account validation, repository-scoped session resolution/listing, session argument selection, and shared account/session lock. |
| Session list API | `[new] src/app/api/claude/sessions/route.ts` | Return sanitized, bounded chat choices for the manually selected account and plan repository. |
| Ask API | `src/app/api/ask/route.ts:POST` | Require manual selection, run under the selected profile/session, and return the effective session ID without implicit fallback. |
| Review API | `src/app/api/review/route.ts:POST` | Use the selected profile/chat, persist the review turn in that chat, and return its session ID. |
| Implement API | `src/app/api/implement/route.ts:POST` | Use the selected profile/chat, persist implementation in it, and emit its session ID with completion. |
| Client state/actions | `src/app/page.tsx:Home`, `openDocument`, `runAsk`, `runPlanReview`, `runImplement` | Add explicit account/chat state, fetch/reset/change behavior, route selection payloads, and effective-session updates. |
| Client UI | `src/app/page.tsx` work panel, `src/app/globals.css` | Add the two-step selector, loading/error/empty states, selected-context summary, Change/Refresh actions, and disabled-action explanations. |
| Configuration/docs | `.env.example`, `README.md` | Document both account mappings, manual selection flow, repository filtering, permissions, and concurrency warning. |
| Tests | `[new] src/lib/claude-cli.test.ts`, `[new] fixtures`, `package.json` | Add coverage for profile/session validation, JSONL metadata projection, selection rules, session locking, and route argument construction. |

## Implementation plan

- [ ] 1. Preserve and baseline the current dirty working tree, including the Ask feature and completed Contents removal; run lint/build before changing session behavior.
- [ ] 2. `src/lib/claude-cli.ts` — implement the two-account registry, safe session-file discovery/resolution, sanitized metadata extraction, selection validation, `--session-id` versus `--resume` construction, and a shared account/session lock.
- [ ] 3. `[new] src/app/api/claude/sessions/route.ts` — validate plan/account, return repository-scoped choices newest-first, and handle empty/partial-corruption cases without exposing filesystem details.
- [ ] 4. `src/app/page.tsx` and `src/app/globals.css` — add the no-default two-step picker, selected summary, loading/error/empty/refresh/change states, plan-switch resets, and action gating.
- [ ] 5. `src/app/api/ask/route.ts` and `src/app/page.tsx:runAsk` — replace automatic profile/session creation with the validated manual selection contract and promote a successful New chat to its returned session ID.
- [ ] 6. `src/app/api/review/route.ts` and `runPlanReview` — persist review in the selected/new chat, share locking, and return/promote the effective session ID.
- [ ] 7. `src/app/api/implement/route.ts` and `runImplement` — persist implementation in the selected/new chat while preserving branch isolation, streaming, abort, and session promotion.
- [ ] 8. `README.md` and `.env.example` — replace single-profile/automatic-session documentation with the two-account manual workflow and action-specific permission/concurrency guidance.
- [ ] 9. Add automated coverage and run the full verification matrix.

## Verification

- Run the added unit tests, `npm run lint`, and `npm run build`.
- With no selection, verify all Claude actions are visibly disabled and no request can silently choose an account or create a chat.
- Select each account and confirm only chats whose recorded cwd belongs to the open plan repository appear, ordered by recent activity with safe title/preview fallbacks.
- Verify changing account clears chat/thread state; changing chat clears only chat-bound UI state; reloading the same document retains the in-page choice while opening another plan resets it.
- Choose **New chat** under each account and run Ask, review, and implementation as the first action in separate tests. Confirm each returns a session ID and every later action resumes that same account/chat.
- Choose representative existing chats under both accounts and confirm the spawned CLI receives the correct `CLAUDE_CONFIG_DIR` and `--resume` UUID. Verify an ID copied from the other account or another repository is rejected.
- Attempt overlapping Ask/review/implement requests against one selected chat and confirm the shared lock rejects the second action without switching or forking sessions.
- Verify Ask remains read-only, review can update the plan, and implementation still uses its dedicated branch and abort behavior.
- Verify accounts with no matching sessions show an explicit empty state plus an unselected New chat option.

## Rollout and rollback

This is a local, backward-compatible UI/API change with no transcript migration. Ship the account/session helper and list API before enabling the selector and required route payloads in the same application commit. The existing plan-opening skills and Claude profile dotfiles need no coordinated deployment.

Rollback by restoring automatic single-profile behavior in the three action routes and removing the selector/list endpoint. Claude chats created or resumed while the feature was enabled remain ordinary Claude Code sessions and require no cleanup.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Claude JSONL metadata format changes | Chat titles/listing become incomplete | Parse a narrow allowlist, use title/first-user/UUID fallbacks, skip malformed files, and never block New chat availability. |
| Session chosen under the wrong profile or repository | Claude resumes unrelated context | Use fixed server-side account paths, resolve UUIDs beneath that profile, validate recorded cwd against the plan repository, and never trust browser paths. |
| Existing chat is active in another process | Concurrent resume may diverge or fail | Make selection manual, show a warning, serialize all app actions with a shared lock, surface conflicts, and never auto-fork. |
| New chat is created more than once | Ask/review/implement split across contexts | Generate once on the first selected action, return the effective UUID from every route, and immediately promote client state to that existing session. |
| Large history directories slow the picker | Account selection feels unresponsive | Filter by main UUID JSONL files, stream only metadata, bound/sort results, cache briefly, and provide explicit Refresh. |
| Manual selection is forgotten during plan changes | Work runs in stale context | Reset both choices whenever the canonical plan path changes and keep actions disabled until the user chooses again. |
| Different actions have different powers in one chat | User assumes Ask and implementation are equally safe | Display action-specific permissions; retain route-level allowed tools and branch isolation regardless of selected context. |

## Open questions

- None blocking. The intended behavior is deliberately manual: account first, then existing chat or New chat, with no defaults or automatic inference.

## Review changelog

### Round 1 — 2026-07-16

- Workspace layout: removed the left Contents rail from the target design, reassigned its width to a wider reading surface, relocated word/read metrics, and added desktop, tablet drawer, and mobile sheet requirements so Review and Ask remain usable at every viewport size.

### Round 2 — 2026-07-16

- Claude context: replaced automatic live-session handoff, hooks, tmux control, and implicit session creation with an explicit two-step account and existing/New chat selector shared by Ask, review, and implementation.
