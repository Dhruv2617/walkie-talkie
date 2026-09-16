# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A message relay that lets two Claude Code sessions on separate machines (e.g. a backend dev and a frontend dev) pass context to each other, without a live connection between them. Two parts in one repo:

- `relay/` — hosted FastAPI + Redis service. The only thing either side ever talks to.
- `cli/` — Node/TypeScript CLI (`walkie-talkie`) that each developer runs locally.
- `.claude-plugin/` + `commands/` — a Claude Code plugin wrapping the CLI as `/walkie-talkie:init`, `/walkie-talkie:join`, `/walkie-talkie:share`, `/walkie-talkie:ask`, `/walkie-talkie:status`. Each command file is a thin `npx @dhruv_anand/walkie-talkie ...` wrapper — the CLI is the source of truth, not the command files. `cli/src/commands/install.ts` maintains its own embedded copies of these same five commands (for the per-project `install` fallback path) — if CLI subcommand behavior changes (flags, output format), update `commands/*.md` AND the matching entry in `install.ts`'s `COMMANDS` map together, or they drift.

## Commands

### Relay (`relay/`)

```bash
cd relay
poetry install
poetry run pytest              # full suite
poetry run pytest tests/test_channels.py::test_join_is_atomic_under_concurrent_claims -v  # single test
poetry run uvicorn relay.app.main:app --reload --app-dir ..   # run from repo root so `relay.app.main` resolves
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

**Pairing model:** `init` runs exactly once, ever — it creates a channel, mints an invite code, and also auto-joins that same session as `buddy1` (`runInit` calls `joinChannel` internally and writes config, see `cli/src/commands/init.ts`). The other side runs `join <code>` every session and is assigned `buddy2`. There is no auto-connect beyond that one `init`-side join and no persisted cross-session attachment anywhere in this codebase — every other session still has to run `join` explicitly. Roles are not named or chosen by the user — the relay auto-assigns whichever of the two slots (`"buddy1"` or `"buddy2"`) is free at join time (`relay/app/channels.py:join_channel`, tries `"buddy1"` then `"buddy2"`), capping every channel at exactly two participants. In practice this makes the creator `buddy1` and the next joiner `buddy2`, deterministically. The claim per slot is an atomic Redis `SET NX EX` on `channel:{id}:slot:{slot}` — never re-implement this as a check-then-set, it must stay a single atomic operation to avoid a race between two sessions joining simultaneously. `init`, `join`, and `status` (`cli/src/commands/status.ts`, reconstructs the invite code from saved config via `encodeInviteCode` — never re-run `init` just to see the code again, it mints a brand new unrelated channel) all check the other slot's presence and report connection status ("waiting for buddy2/buddy1 to join" vs "you're both connected") via `connectionStatusLine` in `cli/src/index.ts`. `share` and `ask` also report the other slot's live presence on every call (not just at join time) — that's the closest thing to a "connection closed" notification this one-shot CLI can give, since there's no background process to push a notice the instant a session actually closes.

**Presence vs slot ownership — these are two separate Redis keys, do not conflate them.** `channel:{id}:slot:{slot}` is set once via `SET NX` with **no TTL** — it is permanent for the channel's lifetime and is what `join_channel`'s loop checks to decide whether a slot is available. `channel:{id}:online:{slot}` is a **separate** TTL'd liveness flag (60s, refreshed by `heartbeat`) that only affects what `get_presence` reports — it must never be used to decide slot availability. This split exists because of a real reported bug: with a single combined key, one person ran `init` (claiming `buddy1`), waited about a minute before sending the invite code, and by the time the second person ran `join`, `buddy1`'s presence TTL had already lapsed — so the second joiner's request saw `buddy1` as "free" again and collided with the first (both ended up labeled `buddy1`). Regression tests for this live in `relay/tests/test_channels.py`: `test_slot_ownership_survives_presence_expiry` and `test_heartbeat_revives_presence_after_it_already_expired` (heartbeat must check slot ownership, not the expiring presence key, to decide whether to 404). Nothing in this codebase currently refreshes the `online` TTL on a background loop — a session's presence still expires 60s after `join`/`heartbeat` unless something calls `heartbeat` again, which only affects the reported "online"/"offline" status now, never who owns which slot. Treat the missing refresh loop as a known gap, not a bug to silently "fix" by inventing one unless asked.

**Messages:** capped Redis list per channel (`channel:{id}:messages`, `MAX_MESSAGES = 50` in `channels.py`, trimmed on every push). Schema is exactly `id, from, ts, type, text, reply_to` — `from` is `"buddy1" | "buddy2"`, `type` is `fyi | question | answer`, `reply_to` links an `answer` back to the `question` it resolves. This exact shape is load-bearing across both relay and CLI; if you touch it, update both `relay/app/models.py` (`PushMessageRequest`, with `from_` aliased to JSON `from` via `Field(alias="from")` — this is Pydantic v2 syntax, not the v1 `class Config: fields = {...}` pattern, don't regress it) and `cli/src/relayClient.ts`'s `Message` interface together.

**Two request patterns:**
- Async (`/share-context` → `runShare`): push a `fyi` (or `answer`, via `--reply-to <id>`) and move on. Pulled in by the other side's next `join`, via `readLastSeenId`/`writeLastSeenId` in `cli/src/config.ts` (per-channel marker files under `~/.ctx-relay/`).
- Blocking (`ask` → `runAsk` in `cli/src/commands/ask.ts`): checks the other slot's presence first (`OTHER_SLOT` map: `buddy1`↔`buddy2`). If online, pushes a `question` and polls `pullMessages` for a matching `reply_to` until a timeout, re-checking presence on every poll iteration and exiting early with a disconnect message if the other side goes offline mid-wait, then falls back to an "assume and flag" message on timeout. If offline from the start, skips polling entirely and returns the fallback immediately — never enters a poll loop against a channel nobody can answer.

**Auth:** every relay route except `create_channel` requires the channel's `secret` (returned once at creation, encoded into the invite code by `cli/src/inviteCode.ts` as `WT-<base64url json>`). `_check_secret` in `channels.py` uses `secrets.compare_digest`, not `!=` — keep it that way if you touch it. `decodeInviteCode` strips all whitespace before decoding (invite codes get mangled by line-wrapping when copy-pasted through terminals/chat apps) — don't remove that stripping.

**Config:** `cli/src/config.ts` currently supports a single active channel per machine (`~/.ctx-relay/config.json` is overwritten by each `join`) — joining a second channel evicts the first. This is a known limitation, not an oversight to "fix" silently.

## Testing conventions already established in this repo

- Relay tests use `fakeredis` (via the `fake_redis` autouse fixture in `relay/tests/conftest.py`) and FastAPI's `TestClient` — no real Redis needed to run the suite.
- `relay/tests/test_e2e.py` is the one test that exercises the full HTTP flow (create → join both slots → push/pull → question/answer round trip) against the real FastAPI app in-process; add to it rather than creating a second e2e file if you need broader end-to-end coverage.
- CLI command tests (`cli/test/commands.test.ts`) mock `relayClient` and `config` wholesale via `vi.mock` — they test command logic, not HTTP. `cli/test/relayClient.test.ts` is the one place that actually exercises HTTP-shaped logic, by stubbing global `fetch`.
- The CLI's own layer (`cli/src/commands/*`) must never call `fetch` directly — everything goes through `cli/src/relayClient.ts`.
