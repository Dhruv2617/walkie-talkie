# ctx-relay Core (Relay API + CLI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the relay API and CLI that let two Claude Code sessions on separate machines explicitly `join` a shared channel, push/pull async messages, and run a presence-gated blocking `ask_and_wait` for questions that need a live reply.

**Architecture:** A hosted FastAPI service (`relay/`) backed by Redis owns channels, messages, and presence — it never touches Claude directly. A Node/TypeScript CLI (`cli/`) is what runs on each developer's machine: `init` creates a channel once, `join` attaches a session to a role every session (rejecting a second live session on the same role), `share` pushes an async message, and `ask` performs the presence-gated blocking question/answer exchange. The CLI is the only client of the relay's HTTP API.

**Tech Stack:** Python 3.11 + FastAPI + Redis (via `redis-py`, `fakeredis` for tests) for the relay. Node 20 + TypeScript + `vitest` for the CLI. Plain `fetch` for HTTP calls (no client SDK).

**Spec:** `docs/superpowers/specs/2026-09-16-ctx-relay-design.md`

## Global Constraints

- No auto-connect, anywhere — every session attaches via an explicit `join <code>` call. (spec: "Pairing model")
- At most one live session per role per channel at any time, enforced by the relay, not convention. (spec: "Pairing model")
- Presence keys use a 60s TTL, refreshed every ~30s by the holding session. (spec: "Presence & heartbeat")
- Message lists are capped at the last 50 entries per channel; oldest are trimmed on push. (spec: "Async flow")
- `ask_and_wait` polls every ~3s with a 5-minute total timeout; it never blocks if the other role's presence key is absent. (spec: "Synchronous flow")
- Message schema fields are exactly `id, from, ts, type, text, reply_to` (`reply_to` only present on `type:"answer"`). (spec: "Message schema")

## Out of scope for this plan

The notification poller, `rotate`, and `--force` takeover are separate follow-up work (distinct subsystem per the spec's own scope split) — this plan delivers the core relay + CLI loop (`init`, `join`, `share`, `ask`) end to end, testable on its own.

---

## File Structure

```
relay/
  app/
    main.py            # FastAPI app, mounts routes
    redis_client.py     # thin wrapper: get_client() reads REDIS_URL, else fakeredis
    models.py           # pydantic request/response schemas
    channels.py          # channel create/join/heartbeat/push/pull/presence routes
  tests/
    conftest.py          # fakeredis fixture, FastAPI TestClient fixture
    test_channels.py

cli/
  src/
    config.ts            # read/write ~/.ctx-relay/config.json and last_seen_id marker
    relayClient.ts        # fetch wrappers for every relay endpoint
    inviteCode.ts         # encode/decode invite code (base64 JSON)
    commands/
      init.ts
      join.ts
      share.ts
      ask.ts
    index.ts              # CLI entry, dispatches to commands/
  test/
    inviteCode.test.ts
    config.test.ts
    commands.test.ts       # mocks relayClient, tests command logic
  package.json
  tsconfig.json
```

---

### Task 1: Relay app skeleton + Redis wrapper

**Files:**
- Create: `relay/app/redis_client.py`
- Create: `relay/app/main.py`
- Create: `relay/tests/conftest.py`
- Test: `relay/tests/test_health.py`

**Interfaces:**
- Produces: `redis_client.get_client() -> redis.Redis` — later tasks call this to read/write channel state. In tests, `conftest.py` monkeypatches it to return a `fakeredis.FakeStrictRedis` instance.
- Produces: `main.app` — the FastAPI instance later routers attach to.

- [ ] **Step 1: Write the failing test**

```python
# relay/tests/test_health.py
def test_health_ok(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
```

- [ ] **Step 2: Add the fixtures the test needs**

```python
# relay/tests/conftest.py
import fakeredis
import pytest
from fastapi.testclient import TestClient

from relay.app import redis_client
from relay.app.main import app


@pytest.fixture(autouse=True)
def fake_redis(monkeypatch):
    fake = fakeredis.FakeStrictRedis(decode_responses=True)
    monkeypatch.setattr(redis_client, "_client", fake)
    monkeypatch.setattr(redis_client, "get_client", lambda: fake)
    return fake


@pytest.fixture
def client():
    return TestClient(app)
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest relay/tests/test_health.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'relay.app.main'`

- [ ] **Step 4: Write the Redis wrapper**

```python
# relay/app/redis_client.py
import os

import redis

_client: redis.Redis | None = None


def get_client() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.from_url(
            os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
            decode_responses=True,
        )
    return _client
```

- [ ] **Step 5: Write the FastAPI app**

```python
# relay/app/main.py
from fastapi import FastAPI

app = FastAPI(title="ctx-relay")


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pytest relay/tests/test_health.py -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add relay/app/main.py relay/app/redis_client.py relay/tests/conftest.py relay/tests/test_health.py
git commit -m "feat(relay): app skeleton and Redis client wrapper"
```

---

### Task 2: Channel creation (`POST /channels`)

**Files:**
- Create: `relay/app/models.py`
- Create: `relay/app/channels.py`
- Modify: `relay/app/main.py` (mount router)
- Test: `relay/tests/test_channels.py`

**Interfaces:**
- Consumes: `redis_client.get_client()` from Task 1.
- Produces: `POST /channels` → `{channel_id: str, secret: str}`. Redis keys this task establishes: `channel:{channel_id}:secret` (string). Later tasks (join, push, pull, presence) all key off `channel_id`.

- [ ] **Step 1: Write the failing test**

```python
# relay/tests/test_channels.py
def test_create_channel_returns_id_and_secret(client, fake_redis):
    resp = client.post("/channels")
    assert resp.status_code == 201
    body = resp.json()
    assert "channel_id" in body
    assert "secret" in body
    assert fake_redis.get(f"channel:{body['channel_id']}:secret") == body["secret"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest relay/tests/test_channels.py::test_create_channel_returns_id_and_secret -v`
Expected: FAIL — 404, no `/channels` route yet

- [ ] **Step 3: Write the schema**

```python
# relay/app/models.py
from pydantic import BaseModel


class CreateChannelResponse(BaseModel):
    channel_id: str
    secret: str
```

- [ ] **Step 4: Write the route**

```python
# relay/app/channels.py
import secrets

from fastapi import APIRouter

from relay.app.models import CreateChannelResponse
from relay.app.redis_client import get_client

router = APIRouter()


@router.post("/channels", status_code=201, response_model=CreateChannelResponse)
def create_channel():
    r = get_client()
    channel_id = secrets.token_hex(8)
    secret = secrets.token_urlsafe(24)
    r.set(f"channel:{channel_id}:secret", secret)
    return CreateChannelResponse(channel_id=channel_id, secret=secret)
```

- [ ] **Step 5: Mount the router**

```python
# relay/app/main.py
from fastapi import FastAPI

from relay.app.channels import router as channels_router

app = FastAPI(title="ctx-relay")
app.include_router(channels_router)


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pytest relay/tests/test_channels.py -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add relay/app/models.py relay/app/channels.py relay/app/main.py relay/tests/test_channels.py
git commit -m "feat(relay): channel creation endpoint"
```

---

### Task 3: Role join with 1:1 enforcement + presence

**Files:**
- Modify: `relay/app/models.py`
- Modify: `relay/app/channels.py`
- Test: `relay/tests/test_channels.py`

**Interfaces:**
- Consumes: `channel_id`, `secret` from Task 2.
- Produces: `POST /channels/{channel_id}/join` with body `{secret, role}` → `201 {ok: true}` or `409 {error: "role_taken"}`. Establishes Redis key `channel:{channel_id}:online:{role}` (TTL 60s) — later tasks (heartbeat, presence check, ask_and_wait) read/refresh this exact key name.
- Produces: `POST /channels/{channel_id}/heartbeat` with body `{secret, role}` → refreshes the same TTL key. Used by the CLI's background heartbeat loop (Task 8).

- [ ] **Step 1: Write the failing tests**

```python
# relay/tests/test_channels.py (add)
def test_join_claims_role(client, fake_redis):
    created = client.post("/channels").json()
    resp = client.post(
        f"/channels/{created['channel_id']}/join",
        json={"secret": created["secret"], "role": "backend"},
    )
    assert resp.status_code == 201
    assert fake_redis.ttl(f"channel:{created['channel_id']}:online:backend") > 0


def test_join_rejects_when_role_already_held(client, fake_redis):
    created = client.post("/channels").json()
    channel_id, secret = created["channel_id"], created["secret"]
    client.post(f"/channels/{channel_id}/join", json={"secret": secret, "role": "backend"})

    resp = client.post(f"/channels/{channel_id}/join", json={"secret": secret, "role": "backend"})
    assert resp.status_code == 409
    assert resp.json()["error"] == "role_taken"


def test_join_rejects_wrong_secret(client, fake_redis):
    created = client.post("/channels").json()
    resp = client.post(
        f"/channels/{created['channel_id']}/join",
        json={"secret": "wrong", "role": "backend"},
    )
    assert resp.status_code == 403
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest relay/tests/test_channels.py -v -k join`
Expected: FAIL — no `/join` route

- [ ] **Step 3: Add request schema**

```python
# relay/app/models.py (add)
from typing import Literal


class JoinRequest(BaseModel):
    secret: str
    role: Literal["backend", "frontend"]
```

- [ ] **Step 4: Implement the join and heartbeat routes**

```python
# relay/app/channels.py (add)
from fastapi import HTTPException

from relay.app.models import JoinRequest

PRESENCE_TTL_SECONDS = 60


def _check_secret(r, channel_id: str, secret: str):
    stored = r.get(f"channel:{channel_id}:secret")
    if stored is None or stored != secret:
        raise HTTPException(status_code=403, detail="invalid channel or secret")


@router.post("/channels/{channel_id}/join", status_code=201)
def join_channel(channel_id: str, body: JoinRequest):
    r = get_client()
    _check_secret(r, channel_id, body.secret)

    key = f"channel:{channel_id}:online:{body.role}"
    claimed = r.set(key, "1", nx=True, ex=PRESENCE_TTL_SECONDS)
    if not claimed:
        raise HTTPException(status_code=409, detail={"error": "role_taken"})
    return {"ok": True}


@router.post("/channels/{channel_id}/heartbeat")
def heartbeat(channel_id: str, body: JoinRequest):
    r = get_client()
    _check_secret(r, channel_id, body.secret)
    r.expire(f"channel:{channel_id}:online:{body.role}", PRESENCE_TTL_SECONDS)
    return {"ok": True}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest relay/tests/test_channels.py -v -k join`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add relay/app/models.py relay/app/channels.py relay/tests/test_channels.py
git commit -m "feat(relay): role join with 1:1 enforcement and heartbeat"
```

---

### Task 4: Presence check endpoint

**Files:**
- Modify: `relay/app/channels.py`
- Test: `relay/tests/test_channels.py`

**Interfaces:**
- Consumes: `channel:{channel_id}:online:{role}` key from Task 3.
- Produces: `GET /channels/{channel_id}/presence/{role}` → `{online: bool}`. Task 7 (`ask` command) calls this before deciding whether to poll.

- [ ] **Step 1: Write the failing tests**

```python
# relay/tests/test_channels.py (add)
def test_presence_true_when_joined(client, fake_redis):
    created = client.post("/channels").json()
    channel_id, secret = created["channel_id"], created["secret"]
    client.post(f"/channels/{channel_id}/join", json={"secret": secret, "role": "backend"})

    resp = client.get(f"/channels/{channel_id}/presence/backend")
    assert resp.json() == {"online": True}


def test_presence_false_when_not_joined(client, fake_redis):
    created = client.post("/channels").json()
    resp = client.get(f"/channels/{created['channel_id']}/presence/backend")
    assert resp.json() == {"online": False}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest relay/tests/test_channels.py -v -k presence`
Expected: FAIL — no `/presence` route

- [ ] **Step 3: Implement the route**

```python
# relay/app/channels.py (add)
@router.get("/channels/{channel_id}/presence/{role}")
def get_presence(channel_id: str, role: str):
    r = get_client()
    online = r.exists(f"channel:{channel_id}:online:{role}") == 1
    return {"online": online}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest relay/tests/test_channels.py -v -k presence`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add relay/app/channels.py relay/tests/test_channels.py
git commit -m "feat(relay): presence check endpoint"
```

---

### Task 5: Push message endpoint (capped list)

**Files:**
- Modify: `relay/app/models.py`
- Modify: `relay/app/channels.py`
- Test: `relay/tests/test_channels.py`

**Interfaces:**
- Consumes: `channel_id`, `secret` (Task 2).
- Produces: `POST /channels/{channel_id}/messages` with body `{secret, from, type, text, reply_to}` → `201 {id: int}`. Stores JSON-encoded entries in the Redis list `channel:{channel_id}:messages`, trimmed to the last 50. Task 6 (pull) and Task 9/10 (`share`/`ask`) build on this exact endpoint and list key.

- [ ] **Step 1: Write the failing tests**

```python
# relay/tests/test_channels.py (add)
def test_push_message_returns_incrementing_id(client, fake_redis):
    created = client.post("/channels").json()
    channel_id, secret = created["channel_id"], created["secret"]

    first = client.post(
        f"/channels/{channel_id}/messages",
        json={"secret": secret, "from": "backend", "type": "fyi", "text": "hello"},
    )
    second = client.post(
        f"/channels/{channel_id}/messages",
        json={"secret": secret, "from": "backend", "type": "fyi", "text": "again"},
    )
    assert first.json()["id"] == 1
    assert second.json()["id"] == 2


def test_push_trims_to_last_50(client, fake_redis):
    created = client.post("/channels").json()
    channel_id, secret = created["channel_id"], created["secret"]

    for i in range(55):
        client.post(
            f"/channels/{channel_id}/messages",
            json={"secret": secret, "from": "backend", "type": "fyi", "text": f"msg {i}"},
        )

    assert fake_redis.llen(f"channel:{channel_id}:messages") == 50
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest relay/tests/test_channels.py -v -k push`
Expected: FAIL — no `/messages` route

- [ ] **Step 3: Add request schema**

```python
# relay/app/models.py (add)
from typing import Optional


class PushMessageRequest(BaseModel):
    secret: str
    from_: Literal["backend", "frontend"] = None
    type: Literal["fyi", "question", "answer"]
    text: str
    reply_to: Optional[int] = None

    class Config:
        fields = {"from_": "from"}
```

- [ ] **Step 4: Implement the route**

```python
# relay/app/channels.py (add)
import json
import time

from relay.app.models import PushMessageRequest

MAX_MESSAGES = 50


@router.post("/channels/{channel_id}/messages", status_code=201)
def push_message(channel_id: str, body: PushMessageRequest):
    r = get_client()
    _check_secret(r, channel_id, body.secret)

    msg_id = r.incr(f"channel:{channel_id}:next_id")
    entry = {
        "id": msg_id,
        "from": body.from_,
        "ts": int(time.time()),
        "type": body.type,
        "text": body.text,
        "reply_to": body.reply_to,
    }
    key = f"channel:{channel_id}:messages"
    r.rpush(key, json.dumps(entry))
    r.ltrim(key, -MAX_MESSAGES, -1)
    return {"id": msg_id}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest relay/tests/test_channels.py -v -k push`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add relay/app/models.py relay/app/channels.py relay/tests/test_channels.py
git commit -m "feat(relay): push message endpoint with 50-message cap"
```

---

### Task 6: Pull messages since a given id

**Files:**
- Modify: `relay/app/channels.py`
- Test: `relay/tests/test_channels.py`

**Interfaces:**
- Consumes: `channel:{channel_id}:messages` list from Task 5.
- Produces: `GET /channels/{channel_id}/messages?since={id}` → `{messages: [...]}`, only entries with `id > since`, in ascending order. Task 8 (`join`) and Task 10 (`ask`) both call this.

- [ ] **Step 1: Write the failing test**

```python
# relay/tests/test_channels.py (add)
def test_pull_returns_only_messages_after_since(client, fake_redis):
    created = client.post("/channels").json()
    channel_id, secret = created["channel_id"], created["secret"]

    for text in ["a", "b", "c"]:
        client.post(
            f"/channels/{channel_id}/messages",
            json={"secret": secret, "from": "backend", "type": "fyi", "text": text},
        )

    resp = client.get(f"/channels/{channel_id}/messages", params={"since": 1})
    texts = [m["text"] for m in resp.json()["messages"]]
    assert texts == ["b", "c"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest relay/tests/test_channels.py -v -k pull`
Expected: FAIL — no `GET /messages` route

- [ ] **Step 3: Implement the route**

```python
# relay/app/channels.py (add)
@router.get("/channels/{channel_id}/messages")
def pull_messages(channel_id: str, since: int = 0):
    r = get_client()
    raw = r.lrange(f"channel:{channel_id}:messages", 0, -1)
    messages = [json.loads(m) for m in raw]
    return {"messages": [m for m in messages if m["id"] > since]}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest relay/tests/test_channels.py -v -k pull`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add relay/app/channels.py relay/tests/test_channels.py
git commit -m "feat(relay): pull messages since a given id"
```

---

### Task 7: CLI skeleton, config, and invite code encoding

**Files:**
- Create: `cli/package.json`
- Create: `cli/tsconfig.json`
- Create: `cli/src/inviteCode.ts`
- Create: `cli/src/config.ts`
- Test: `cli/test/inviteCode.test.ts`
- Test: `cli/test/config.test.ts`

**Interfaces:**
- Produces: `encodeInviteCode({channelId, secret}) -> string` and `decodeInviteCode(code: string) -> {channelId, secret}`. Task 8's `init`/`join` use these.
- Produces: `readConfig(): Config | null`, `writeConfig(cfg: Config): void`, `readLastSeenId(channelId: string): number`, `writeLastSeenId(channelId: string, id: number): void`, all rooted at `~/.ctx-relay/`. Tasks 8–10 use these.

- [ ] **Step 1: Init the package**

```json
// cli/package.json
{
  "name": "ctx-relay",
  "version": "0.1.0",
  "type": "module",
  "bin": { "ctx-relay": "./dist/index.js" },
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.0.0"
  }
}
```

```json
// cli/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["src"]
}
```

- [ ] **Step 2: Write the failing invite code test**

```typescript
// cli/test/inviteCode.test.ts
import { describe, expect, it } from "vitest";
import { decodeInviteCode, encodeInviteCode } from "../src/inviteCode";

describe("inviteCode", () => {
  it("round-trips channelId and secret", () => {
    const code = encodeInviteCode({ channelId: "abc123", secret: "shh" });
    expect(code.startsWith("CTXR-")).toBe(true);
    expect(decodeInviteCode(code)).toEqual({ channelId: "abc123", secret: "shh" });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd cli && npx vitest run test/inviteCode.test.ts`
Expected: FAIL — `Cannot find module '../src/inviteCode'`

- [ ] **Step 4: Implement invite code encoding**

```typescript
// cli/src/inviteCode.ts
export interface InviteCodePayload {
  channelId: string;
  secret: string;
}

export function encodeInviteCode(payload: InviteCodePayload): string {
  const json = JSON.stringify(payload);
  return `CTXR-${Buffer.from(json, "utf8").toString("base64url")}`;
}

export function decodeInviteCode(code: string): InviteCodePayload {
  const b64 = code.replace(/^CTXR-/, "");
  const json = Buffer.from(b64, "base64url").toString("utf8");
  return JSON.parse(json) as InviteCodePayload;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd cli && npx vitest run test/inviteCode.test.ts`
Expected: PASS

- [ ] **Step 6: Write the failing config test**

```typescript
// cli/test/config.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as config from "../src/config";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ctx-relay-test-"));
  config.setConfigDirForTests(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("config", () => {
  it("returns null when no config written yet", () => {
    expect(config.readConfig()).toBeNull();
  });

  it("writes and reads back the config", () => {
    config.writeConfig({ channelId: "abc123", secret: "shh", role: "backend" });
    expect(config.readConfig()).toEqual({ channelId: "abc123", secret: "shh", role: "backend" });
  });

  it("tracks last_seen_id per channel, defaulting to 0", () => {
    expect(config.readLastSeenId("abc123")).toBe(0);
    config.writeLastSeenId("abc123", 7);
    expect(config.readLastSeenId("abc123")).toBe(7);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd cli && npx vitest run test/config.test.ts`
Expected: FAIL — `Cannot find module '../src/config'`

- [ ] **Step 8: Implement config storage**

```typescript
// cli/src/config.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  channelId: string;
  secret: string;
  role: "backend" | "frontend";
}

let configDir = join(homedir(), ".ctx-relay");

export function setConfigDirForTests(dir: string) {
  configDir = dir;
}

function ensureDir() {
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
}

function configPath() {
  return join(configDir, "config.json");
}

function markerPath(channelId: string) {
  return join(configDir, `last_seen_${channelId}.json`);
}

export function readConfig(): Config | null {
  if (!existsSync(configPath())) return null;
  return JSON.parse(readFileSync(configPath(), "utf8")) as Config;
}

export function writeConfig(cfg: Config): void {
  ensureDir();
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

export function readLastSeenId(channelId: string): number {
  const path = markerPath(channelId);
  if (!existsSync(path)) return 0;
  return (JSON.parse(readFileSync(path, "utf8")) as { id: number }).id;
}

export function writeLastSeenId(channelId: string, id: number): void {
  ensureDir();
  writeFileSync(markerPath(channelId), JSON.stringify({ id }));
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd cli && npx vitest run test/config.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add cli/package.json cli/tsconfig.json cli/src/inviteCode.ts cli/src/config.ts cli/test/inviteCode.test.ts cli/test/config.test.ts
git commit -m "feat(cli): invite code encoding and local config storage"
```

---

### Task 8: Relay HTTP client

**Files:**
- Create: `cli/src/relayClient.ts`
- Test: `cli/test/relayClient.test.ts`

**Interfaces:**
- Consumes: relay endpoints from Tasks 2–6 (`POST /channels`, `POST /channels/{id}/join`, `POST /channels/{id}/heartbeat`, `GET /channels/{id}/presence/{role}`, `POST /channels/{id}/messages`, `GET /channels/{id}/messages`).
- Produces: `createChannel()`, `joinChannel(channelId, secret, role)`, `heartbeat(channelId, secret, role)`, `getPresence(channelId, role)`, `pushMessage(channelId, secret, msg)`, `pullMessages(channelId, since)`. Commands in Tasks 9–11 call these exclusively — no command talks to `fetch` directly.

- [ ] **Step 1: Write the failing test (using a stubbed global fetch)**

```typescript
// cli/test/relayClient.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import * as relayClient from "../src/relayClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("relayClient", () => {
  it("createChannel posts to /channels and returns the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ channel_id: "abc", secret: "shh" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await relayClient.createChannel();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/channels"),
      expect.objectContaining({ method: "POST" })
    );
    expect(result).toEqual({ channelId: "abc", secret: "shh" });
  });

  it("joinChannel throws role_taken on 409", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ detail: { error: "role_taken" } }),
      })
    );

    await expect(relayClient.joinChannel("abc", "shh", "backend")).rejects.toThrow("role_taken");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx vitest run test/relayClient.test.ts`
Expected: FAIL — `Cannot find module '../src/relayClient'`

- [ ] **Step 3: Implement the client**

```typescript
// cli/src/relayClient.ts
const BASE_URL = process.env.CTX_RELAY_URL ?? "https://relay.ctx-relay.dev";

export interface Message {
  id: number;
  from: "backend" | "frontend";
  ts: number;
  type: "fyi" | "question" | "answer";
  text: string;
  reply_to: number | null;
}

async function request(path: string, init?: RequestInit): Promise<any> {
  const resp = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await resp.json();
  if (!resp.ok) {
    const error = body?.detail?.error ?? body?.detail ?? "request_failed";
    throw new Error(typeof error === "string" ? error : JSON.stringify(error));
  }
  return body;
}

export async function createChannel(): Promise<{ channelId: string; secret: string }> {
  const body = await request("/channels", { method: "POST" });
  return { channelId: body.channel_id, secret: body.secret };
}

export async function joinChannel(channelId: string, secret: string, role: string): Promise<void> {
  await request(`/channels/${channelId}/join`, {
    method: "POST",
    body: JSON.stringify({ secret, role }),
  });
}

export async function heartbeat(channelId: string, secret: string, role: string): Promise<void> {
  await request(`/channels/${channelId}/heartbeat`, {
    method: "POST",
    body: JSON.stringify({ secret, role }),
  });
}

export async function getPresence(channelId: string, role: string): Promise<boolean> {
  const body = await request(`/channels/${channelId}/presence/${role}`);
  return body.online as boolean;
}

export async function pushMessage(
  channelId: string,
  secret: string,
  msg: { from: string; type: string; text: string; reply_to?: number }
): Promise<number> {
  const body = await request(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({ secret, ...msg }),
  });
  return body.id as number;
}

export async function pullMessages(channelId: string, since: number): Promise<Message[]> {
  const body = await request(`/channels/${channelId}/messages?since=${since}`);
  return body.messages as Message[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx vitest run test/relayClient.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cli/src/relayClient.ts cli/test/relayClient.test.ts
git commit -m "feat(cli): relay HTTP client"
```

---

### Task 9: `init` and `join` commands

**Files:**
- Create: `cli/src/commands/init.ts`
- Create: `cli/src/commands/join.ts`
- Test: `cli/test/commands.test.ts`

**Interfaces:**
- Consumes: `createChannel`, `joinChannel`, `pullMessages`, `heartbeat` (Task 8); `encodeInviteCode`, `decodeInviteCode` (Task 7); `readConfig`, `writeConfig`, `readLastSeenId`, `writeLastSeenId` (Task 7).
- Produces: `runInit(): Promise<string>` (returns the invite code to print), `runJoin(code: string, role: "backend" | "frontend"): Promise<{messages: Message[]}>`. `index.ts` (Task 11) wires these to CLI args.

- [ ] **Step 1: Write the failing tests**

```typescript
// cli/test/commands.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as relayClient from "../src/relayClient";
import * as config from "../src/config";
import { runInit } from "../src/commands/init";
import { runJoin } from "../src/commands/join";

vi.mock("../src/relayClient");
vi.mock("../src/config");

beforeEach(() => {
  vi.resetAllMocks();
});

describe("runInit", () => {
  it("creates a channel and returns an invite code", async () => {
    vi.mocked(relayClient.createChannel).mockResolvedValue({ channelId: "abc", secret: "shh" });

    const code = await runInit();

    expect(code.startsWith("CTXR-")).toBe(true);
  });
});

describe("runJoin", () => {
  it("joins the role, saves config, and pulls unread messages", async () => {
    vi.mocked(config.readLastSeenId).mockReturnValue(3);
    vi.mocked(relayClient.pullMessages).mockResolvedValue([
      { id: 4, from: "backend", ts: 1, type: "fyi", text: "hi", reply_to: null },
    ]);

    const { messages } = await runJoin("CTXR-eyJjaGFubmVsSWQiOiJhYmMiLCJzZWNyZXQiOiJzaGgifQ", "frontend");

    expect(relayClient.joinChannel).toHaveBeenCalledWith("abc", "shh", "frontend");
    expect(config.writeConfig).toHaveBeenCalledWith({ channelId: "abc", secret: "shh", role: "frontend" });
    expect(relayClient.pullMessages).toHaveBeenCalledWith("abc", 3);
    expect(config.writeLastSeenId).toHaveBeenCalledWith("abc", 4);
    expect(messages).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cli && npx vitest run test/commands.test.ts`
Expected: FAIL — `Cannot find module '../src/commands/init'`

- [ ] **Step 3: Implement `init`**

```typescript
// cli/src/commands/init.ts
import { encodeInviteCode } from "../inviteCode";
import { createChannel } from "../relayClient";

export async function runInit(): Promise<string> {
  const { channelId, secret } = await createChannel();
  return encodeInviteCode({ channelId, secret });
}
```

- [ ] **Step 4: Implement `join`**

```typescript
// cli/src/commands/join.ts
import { decodeInviteCode } from "../inviteCode";
import { readLastSeenId, writeConfig, writeLastSeenId } from "../config";
import { Message, joinChannel, pullMessages } from "../relayClient";

export async function runJoin(
  code: string,
  role: "backend" | "frontend"
): Promise<{ messages: Message[] }> {
  const { channelId, secret } = decodeInviteCode(code);

  await joinChannel(channelId, secret, role);
  writeConfig({ channelId, secret, role });

  const since = readLastSeenId(channelId);
  const messages = await pullMessages(channelId, since);
  if (messages.length > 0) {
    writeLastSeenId(channelId, messages[messages.length - 1].id);
  }

  return { messages };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd cli && npx vitest run test/commands.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/init.ts cli/src/commands/join.ts cli/test/commands.test.ts
git commit -m "feat(cli): init and join commands"
```

---

### Task 10: `share` and `ask` commands

**Files:**
- Create: `cli/src/commands/share.ts`
- Create: `cli/src/commands/ask.ts`
- Modify: `cli/test/commands.test.ts`

**Interfaces:**
- Consumes: `pushMessage`, `pullMessages`, `getPresence` (Task 8); `readConfig` (Task 7).
- Produces: `runShare(text: string): Promise<number>` (pushes a `type:"fyi"` message, returns its id). `runAsk(question: string, opts?: {pollIntervalMs?: number, timeoutMs?: number}): Promise<string>` (returns the reply text, or a fallback string if offline/timed out). `index.ts` (Task 11) wires both to CLI args.

- [ ] **Step 1: Write the failing tests**

```typescript
// cli/test/commands.test.ts (add)
import { runShare } from "../src/commands/share";
import { runAsk } from "../src/commands/ask";

describe("runShare", () => {
  it("pushes an fyi message using the saved config", async () => {
    vi.mocked(config.readConfig).mockReturnValue({ channelId: "abc", secret: "shh", role: "backend" });
    vi.mocked(relayClient.pushMessage).mockResolvedValue(9);

    const id = await runShare("qty is integer only");

    expect(relayClient.pushMessage).toHaveBeenCalledWith("abc", "shh", {
      from: "backend",
      type: "fyi",
      text: "qty is integer only",
    });
    expect(id).toBe(9);
  });
});

describe("runAsk", () => {
  it("returns an offline fallback without polling when the other role is not present", async () => {
    vi.mocked(config.readConfig).mockReturnValue({ channelId: "abc", secret: "shh", role: "frontend" });
    vi.mocked(relayClient.getPresence).mockResolvedValue(false);
    vi.mocked(relayClient.pushMessage).mockResolvedValue(101);

    const answer = await runAsk("does qty accept decimals?");

    expect(relayClient.pushMessage).toHaveBeenCalledWith("abc", "shh", {
      from: "frontend",
      type: "question",
      text: "does qty accept decimals?",
    });
    expect(answer).toBe("no one online — proceeding with an assumption, flagged for follow-up");
  });

  it("polls until a reply_to match arrives when the other role is online", async () => {
    vi.mocked(config.readConfig).mockReturnValue({ channelId: "abc", secret: "shh", role: "frontend" });
    vi.mocked(relayClient.getPresence).mockResolvedValue(true);
    vi.mocked(relayClient.pushMessage).mockResolvedValue(101);
    vi.mocked(relayClient.pullMessages)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 102, from: "backend", ts: 1, type: "answer", text: "integer only", reply_to: 101 },
      ]);

    const answer = await runAsk("does qty accept decimals?", { pollIntervalMs: 1, timeoutMs: 1000 });

    expect(answer).toBe("integer only");
  });

  it("falls back to a timeout message if no reply arrives in time", async () => {
    vi.mocked(config.readConfig).mockReturnValue({ channelId: "abc", secret: "shh", role: "frontend" });
    vi.mocked(relayClient.getPresence).mockResolvedValue(true);
    vi.mocked(relayClient.pushMessage).mockResolvedValue(101);
    vi.mocked(relayClient.pullMessages).mockResolvedValue([]);

    const answer = await runAsk("does qty accept decimals?", { pollIntervalMs: 1, timeoutMs: 5 });

    expect(answer).toBe("no answer yet — proceeding with an assumption, flagged for follow-up");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cli && npx vitest run test/commands.test.ts`
Expected: FAIL — `Cannot find module '../src/commands/share'`

- [ ] **Step 3: Implement `share`**

```typescript
// cli/src/commands/share.ts
import { readConfig } from "../config";
import { pushMessage } from "../relayClient";

export async function runShare(text: string): Promise<number> {
  const cfg = readConfig();
  if (!cfg) throw new Error("not joined to a channel — run `ctx-relay join <code>` first");
  return pushMessage(cfg.channelId, cfg.secret, { from: cfg.role, type: "fyi", text });
}
```

- [ ] **Step 4: Implement `ask`**

```typescript
// cli/src/commands/ask.ts
import { readConfig } from "../config";
import { getPresence, pullMessages, pushMessage } from "../relayClient";

const OTHER_ROLE = { backend: "frontend", frontend: "backend" } as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runAsk(
  question: string,
  opts: { pollIntervalMs?: number; timeoutMs?: number } = {}
): Promise<string> {
  const pollIntervalMs = opts.pollIntervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;

  const cfg = readConfig();
  if (!cfg) throw new Error("not joined to a channel — run `ctx-relay join <code>` first");

  const otherRole = OTHER_ROLE[cfg.role];
  const online = await getPresence(cfg.channelId, otherRole);

  const questionId = await pushMessage(cfg.channelId, cfg.secret, {
    from: cfg.role,
    type: "question",
    text: question,
  });

  if (!online) {
    return "no one online — proceeding with an assumption, flagged for follow-up";
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await pullMessages(cfg.channelId, questionId - 1);
    const reply = messages.find((m) => m.type === "answer" && m.reply_to === questionId);
    if (reply) return reply.text;
    await sleep(pollIntervalMs);
  }

  return "no answer yet — proceeding with an assumption, flagged for follow-up";
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd cli && npx vitest run test/commands.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/share.ts cli/src/commands/ask.ts cli/test/commands.test.ts
git commit -m "feat(cli): share and ask commands"
```

---

### Task 11: CLI entry point wiring

**Files:**
- Create: `cli/src/index.ts`
- Test: `cli/test/index.test.ts`

**Interfaces:**
- Consumes: `runInit`, `runJoin`, `runShare`, `runAsk` (Tasks 9–10).
- Produces: `dispatch(argv: string[]): Promise<string>` — takes CLI args (excluding the node/script prefix), returns the string that should be printed to stdout. This is the seam the test exercises directly instead of spawning a real process.

- [ ] **Step 1: Write the failing tests**

```typescript
// cli/test/index.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatch } from "../src/index";
import * as init from "../src/commands/init";
import * as join from "../src/commands/join";
import * as share from "../src/commands/share";
import * as ask from "../src/commands/ask";

vi.mock("../src/commands/init");
vi.mock("../src/commands/join");
vi.mock("../src/commands/share");
vi.mock("../src/commands/ask");

beforeEach(() => {
  vi.resetAllMocks();
});

describe("dispatch", () => {
  it("init prints the invite code", async () => {
    vi.mocked(init.runInit).mockResolvedValue("CTXR-abc");
    const out = await dispatch(["init"]);
    expect(out).toContain("CTXR-abc");
  });

  it("join requires a role and prints attached message", async () => {
    vi.mocked(join.runJoin).mockResolvedValue({ messages: [] });
    const out = await dispatch(["join", "CTXR-abc", "--role", "backend"]);
    expect(join.runJoin).toHaveBeenCalledWith("CTXR-abc", "backend");
    expect(out).toContain("attached as backend");
  });

  it("share pushes the given text", async () => {
    vi.mocked(share.runShare).mockResolvedValue(9);
    const out = await dispatch(["share", "qty is integer only"]);
    expect(share.runShare).toHaveBeenCalledWith("qty is integer only");
    expect(out).toContain("9");
  });

  it("ask prints the returned answer", async () => {
    vi.mocked(ask.runAsk).mockResolvedValue("integer only");
    const out = await dispatch(["ask", "does qty accept decimals?"]);
    expect(out).toBe("integer only");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cli && npx vitest run test/index.test.ts`
Expected: FAIL — `Cannot find module '../src/index'`

- [ ] **Step 3: Implement dispatch**

```typescript
// cli/src/index.ts
import { runInit } from "./commands/init";
import { runJoin } from "./commands/join";
import { runShare } from "./commands/share";
import { runAsk } from "./commands/ask";

export async function dispatch(argv: string[]): Promise<string> {
  const [cmd, ...rest] = argv;

  switch (cmd) {
    case "init": {
      const code = await runInit();
      return `invite code: ${code}`;
    }
    case "join": {
      const [code, roleFlag, role] = rest;
      if (roleFlag !== "--role" || (role !== "backend" && role !== "frontend")) {
        throw new Error("usage: ctx-relay join <code> --role <backend|frontend>");
      }
      const { messages } = await runJoin(code, role);
      return `attached as ${role}\n${messages.length} unread message(s) pulled in`;
    }
    case "share": {
      const [text] = rest;
      const id = await runShare(text);
      return `pushed message ${id}`;
    }
    case "ask": {
      const [question] = rest;
      return runAsk(question);
    }
    default:
      throw new Error(`unknown command: ${cmd}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  dispatch(process.argv.slice(2))
    .then((out) => console.log(out))
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cli && npx vitest run test/index.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full CLI test suite**

Run: `cd cli && npx vitest run`
Expected: All test files PASS

- [ ] **Step 6: Commit**

```bash
git add cli/src/index.ts cli/test/index.test.ts
git commit -m "feat(cli): entry point wiring init/join/share/ask"
```

---

## Self-Review

**Spec coverage:**
- Architecture (hosted relay, HTTPS-only, no direct machine-to-machine) → Task 1–6 (relay never assumes anything about the caller beyond HTTP).
- `init` once / `join` every session, 1:1 role enforcement → Task 3 (relay), Task 9 (CLI).
- Presence & heartbeat, TTL 60s / refresh 30s → Task 3 (`join`, `heartbeat` endpoints); the 30s refresh loop itself is CLI-side background behavior deliberately left to the follow-up plan alongside the notification poller, since it requires a long-running process design (see "Out of scope" below).
- Async push/pull, 50-message cap, `last_seen_id` → Task 5, 6 (relay), Task 9 (`join` pulls and advances marker).
- Message schema (`id, from, ts, type, text, reply_to`) → Task 5 model, used verbatim through Tasks 6, 9, 10.
- Synchronous `ask_and_wait`: presence gate, poll loop, online/offline/timeout branches → Task 10 `runAsk`, all three branches covered by tests.
- Security (invite code, no secrets in repo) → Task 2 (secret minted server-side), Task 7 (`~/.ctx-relay/` config, not committed).

**Deferred, correctly out of scope for this plan** (separate follow-up plan, per the spec's own scope split): the CLI's long-running heartbeat-refresh loop and the standalone notification poller (both are background-process concerns, not part of the request/response core proven here), plus `rotate` and `--force` takeover.

**Placeholder scan:** no TBD/"handle appropriately"/unshown code found — every step has real code.

**Type consistency:** `Message` type (`id, from, ts, type, text, reply_to`) is identical across `relayClient.ts` (Task 8), `commands/join.ts` and `commands/ask.ts` (Tasks 9–10). `Config` shape (`channelId, secret, role`) identical across `config.ts` (Task 7), `commands/join.ts`, `commands/share.ts`, `commands/ask.ts`. Relay's `PushMessageRequest` fields match what `relayClient.pushMessage` sends (`from`, `type`, `text`, optional `reply_to`).
