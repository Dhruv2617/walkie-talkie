# ctx-relay — design spec

## Problem

Two developers on separate machines (e.g. backend + frontend) each run their
own Claude Code session. Passing context between them today means manually
copying API contracts, decisions, and questions over Slack/Chat, then getting
on a call to sync. There's no way for one person's Claude session to hand
context to the other's without that manual round trip.

## Goal

A pairing channel that lets two Claude Code sessions — one per machine — pass
context to each other. Most traffic is async (push a note, other side pulls
it in later). One case is synchronous: a question that blocks progress waits
for a live reply, but only when the other side is actually present to answer.

## Non-goals (v1)

- True websocket push into an idle session
- Autonomous headless-Claude auto-answering without a human
- Auto-detected "shareable" events (all sharing is explicit/manual)
- File/diff attachments — plain-text summaries only
- Group channels (more than two people)
- Any form of auto-connect or persisted cross-session attachment

## Architecture

Two machines never talk to each other directly. Both only talk to one hosted
relay (multi-tenant, zero-config for the user — no Redis account or env vars
needed). Neither machine is reachable from the other; both only make
outbound HTTPS calls.

```
Machine C1                     Relay API                    Machine C2
┌────────────────┐             ┌──────────┐             ┌────────────────┐
│ Claude session  │──HTTPS────▶│          │◀───HTTPS────│ Claude session  │
│ ctx-relay CLI   │             │  Redis:  │             │ ctx-relay CLI   │
└────────────────┘             │  messages│             └────────────────┘
                                │  presence│
                                └──────────┘
```

## Pairing model — explicit, per-session, strict 1:1

`init` and `join` are the only two setup commands, with different lifetimes:

- **`init`** — runs exactly once, ever, by whoever creates the channel.
  Creates the channel, prints an invite code (`CTXR-...`). Not rerun.
- **`join <code>`** — the command actually run every session, on both
  machines, including the one that ran `init`. No auto-connect exists
  anywhere: a session only participates because it explicitly ran `join`.

`join` does three things:
1. Claims this session's role slot on the channel (`backend` or `frontend`).
2. Rejects if that role is already held by another live session
   (`--force` to take over deliberately).
3. Starts this session's presence heartbeat and pulls unread messages.

The relay enforces **at most one live session per role per channel** —
never two sessions racing on the same role at once. A user can hold multiple
different channels open in parallel (different projects/pairs); each is its
own strict 1:1 pairing.

```
# machine C1 — once, ever
$ npx ctx-relay init
→ invite code: CTXR-8f2a9c1e...

# machine C1 — every session, including this first one
$ npx ctx-relay join CTXR-8f2a9c1e...
→ attached as backend on "reflexity"

# machine C2 — every session
$ npx ctx-relay join CTXR-8f2a9c1e...
→ attached as frontend on "reflexity"

# role already held by another live session:
$ npx ctx-relay join CTXR-8f2a9c1e...
→ error: backend role already attached elsewhere. use --force to take over.
```

## Presence & heartbeat

Every session that has `join`ed writes an `online:<role>` key into Redis on
a short TTL (e.g. 60s), refreshed every ~30s for as long as the session
runs. No explicit disconnect is required — a closed or crashed session
simply stops refreshing, the key expires on its own, and the role slot frees
for the next `join`. `/disconnect` releases the slot immediately if the user
wants to switch sessions right away without waiting on the TTL.

Presence is the gate for the blocking flow below: nothing polls into
silence — `ask_and_wait` checks presence before it ever starts a poll loop.

## Async flow — push and pull

The default path for the majority of messages: FYIs, contract changes,
status notes. Nothing waits.

1. `/share-context "<summary>"` pushes a `{id, from, ts, type:"fyi", text}`
   message onto the channel's Redis list (capped at last 50, oldest
   trimmed).
2. The message sits there — no connection held open, no notification.
3. Whenever the other side's next session runs `join <code>`, it pulls
   everything since its local `last_seen_id` marker, injects it as context,
   and advances the marker so nothing is shown twice.

Push and pull are fully decoupled in time — could be minutes or days apart.

## Synchronous flow — ask and wait

Reserved for questions that actually gate progress (e.g. "does qty accept
decimals?"), not FYIs. Exposed to Claude as a tool, `ask_and_wait(question)`:

1. Checks presence for the other role (`online:backend`, say).
2. **If online:** pushes `{type:"question", text}`, then polls the channel
   every ~3s for a message tagged `reply_to` this question's id, up to a
   timeout (~5 min). The tool call — and the Claude turn — blocks until a
   reply arrives or the timeout lapses.
3. **If offline:** skips polling entirely. Pushes the question anyway (so
   it's there for later, answered async like any FYI) and returns
   immediately: "no one online — proceeding with an assumption, flagged for
   follow-up."
4. **On timeout even when online:** same fallback as the offline case — the
   other dev may have seen a notification and stepped away.

An optional standalone notification poller (not Claude, not an LLM call) —
opt-in at `init` — checks Redis every few seconds and fires a native OS
notification the moment a question lands, so the human on the other side
notices faster than by chance. `ask_and_wait`'s correctness never depends on
this poller running; it's a best-effort nudge.

## Message schema

```json
{
  "id": 101,
  "from": "backend" | "frontend",
  "ts": 1234567890,
  "type": "fyi" | "question" | "answer",
  "text": "does qty accept decimals?",
  "reply_to": 101
}
```

`reply_to` is present only on `answer` messages and threads them to the
question they resolve.

## Components

| Component | Responsibility |
|---|---|
| Relay API | Hosted, multi-tenant. Create channel, push, pull-since-id, presence set/check, rotate secret. |
| Redis | One capped list per channel (last 50 messages) + TTL'd presence keys. Storage only. |
| ctx-relay CLI | `init`, `join`, `share`, `ask`, `disconnect`, `rotate`. Installs itself into local Claude settings on first use. |
| `/join` command | Explicit per-session entry point — claims role slot, pulls unread, starts heartbeat. |
| `/share-context` command | Manual push path for FYIs and answers. |
| `ask_and_wait` tool | Presence-gated blocking question/reply, with timeout fallback. |
| Notification poller (optional) | Standalone script; fires OS notification on new questions. Opt-in. |
| Local config + marker | `~/.ctx-relay/config.json` (channel id, token) + `last_seen_id` marker. Machine-local, gitignored. |

## Security

- Invite code is a signed token embedding channel id + shared secret.
- `rotate` invalidates the current secret and mints a new invite code if a
  code leaks.
- No secrets stored in the repo — all local config is gitignored.

## Open questions

- Final CLI package registry (npm vs pipx) not decided.
- Cost/ops ownership of the hosted relay not decided — deferred, doesn't
  block the v1 design.
- Whether `type:"answer"` should auto-mark its question "resolved" for
  future filtering (`show unanswered questions`) — deferred to a later
  iteration once real usage volume is known.

## Reference

Architecture diagrams and worked example:
https://claude.ai/code/artifact/4a918cf0-4222-43c2-bf36-84155819c2fd
