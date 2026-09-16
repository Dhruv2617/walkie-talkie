# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A message relay that lets two Claude Code sessions on separate machines (e.g. a backend dev and a frontend dev) pass context to each other, without a live connection between them. Two parts in one repo:

- `relay/` — hosted FastAPI + Redis service. The only thing either side ever talks to.
- `cli/` — Node/TypeScript CLI (`walkie-talkie`) that each developer runs locally.

## Commands

### Relay (`relay/`)

```bash
cd relay
pip install -r requirements.txt
python -m pytest              # full suite
python -m pytest tests/test_channels.py::test_join_is_atomic_under_concurrent_claims -v  # single test
uvicorn relay.app.main:app --reload --app-dir ..   # run from repo root so `relay.app.main` resolves
```

Environment variables:
- `REDIS_URL` — Redis connection string (default `redis://localhost:6379/0`)

### CLI (`cli/`)

```bash
cd cli
npm install
npm run typecheck     # tsc --noEmit — also runs automatically before `npm test` (pretest)
npm test              # vitest run
npx vitest run test/commands.test.ts   # single test file
npm run build         # tsc -> dist/
./dist/index.js init
```

Environment variables:
- `CTX_RELAY_URL` — base URL the CLI uses to reach the relay (default `https://relay.walkie-talkie.dev`; point at `http://localhost:8000` for local dev)

A root `.env` exists for local development defaults for both of the above.

## Architecture

**Pairing model:** `init` runs exactly once, ever, to create a channel and mint an invite code. `join <code> --role <backend|frontend>` is what actually runs every session, on both machines, including the one that ran `init` — there is no auto-connect or persisted cross-session attachment anywhere in this codebase. The relay enforces at most one live session per role per channel via an atomic Redis `SET NX EX` claim (`relay/app/channels.py:join_channel`) — never re-implement this as a check-then-set, it must stay a single atomic operation to avoid a race between two sessions joining simultaneously.

**Presence:** a joined session's role key (`channel:{id}:online:{role}`) carries a 60s TTL; `heartbeat` refreshes it and 404s if the role was never actually claimed. Nothing in this codebase currently refreshes that TTL on a loop — a session's presence expires 60s after `join` unless something calls `heartbeat` again. Treat that as a known gap, not a bug to silently "fix" by inventing a background loop unless asked.

**Messages:** capped Redis list per channel (`channel:{id}:messages`, `MAX_MESSAGES = 50` in `channels.py`, trimmed on every push). Schema is exactly `id, from, ts, type, text, reply_to` — `type` is `fyi | question | answer`, `reply_to` links an `answer` back to the `question` it resolves. This exact shape is load-bearing across both relay and CLI; if you touch it, update both `relay/app/models.py` (`PushMessageRequest`, with `from_` aliased to JSON `from` via `Field(alias="from")` — this is Pydantic v2 syntax, not the v1 `class Config: fields = {...}` pattern, don't regress it) and `cli/src/relayClient.ts`'s `Message` interface together.

**Two request patterns:**
- Async (`/share-context` → `runShare`): push a `fyi` (or `answer`, via `--reply-to <id>`) and move on. Pulled in by the other side's next `join`, via `readLastSeenId`/`writeLastSeenId` in `cli/src/config.ts` (per-channel marker files under `~/.ctx-relay/`).
- Blocking (`ask` → `runAsk` in `cli/src/commands/ask.ts`): checks the other role's presence first. If online, pushes a `question` and polls `pullMessages` for a matching `reply_to` until a timeout, then falls back to an "assume and flag" message. If offline, skips polling entirely and returns the fallback immediately — never enters a poll loop against a channel nobody can answer.

**Auth:** every relay route except `create_channel` requires the channel's `secret` (returned once at creation, encoded into the invite code by `cli/src/inviteCode.ts` as `WT-<base64url json>`). `_check_secret` in `channels.py` uses `secrets.compare_digest`, not `!=` — keep it that way if you touch it.

**Config:** `cli/src/config.ts` currently supports a single active channel per machine (`~/.ctx-relay/config.json` is overwritten by each `join`) — joining a second channel evicts the first. This is a known limitation, not an oversight to "fix" silently.

## Testing conventions already established in this repo

- Relay tests use `fakeredis` (via the `fake_redis` autouse fixture in `relay/tests/conftest.py`) and FastAPI's `TestClient` — no real Redis needed to run the suite.
- `relay/tests/test_e2e.py` is the one test that exercises the full HTTP flow (create → join both roles → push/pull → question/answer round trip) against the real FastAPI app in-process; add to it rather than creating a second e2e file if you need broader end-to-end coverage.
- CLI command tests (`cli/test/commands.test.ts`) mock `relayClient` and `config` wholesale via `vi.mock` — they test command logic, not HTTP. `cli/test/relayClient.test.ts` is the one place that actually exercises HTTP-shaped logic, by stubbing global `fetch`.
- The CLI's own layer (`cli/src/commands/*`) must never call `fetch` directly — everything goes through `cli/src/relayClient.ts`.
