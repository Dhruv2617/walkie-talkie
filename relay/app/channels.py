import json
import secrets
import time

from fastapi import APIRouter, HTTPException

from .models import CreateChannelResponse, JoinRequest, JoinResponse, PushMessageRequest, SlotRequest
from .redis_client import get_client

router = APIRouter()

PRESENCE_TTL_SECONDS = 60
MAX_MESSAGES = 50
SLOTS = ("buddy1", "buddy2")


def _check_secret(r, channel_id: str, secret: str):
    stored = r.get(f"channel:{channel_id}:secret")
    if stored is None or not secrets.compare_digest(stored, secret):
        raise HTTPException(status_code=403, detail="invalid channel or secret")


@router.post("/channels", status_code=201, response_model=CreateChannelResponse)
def create_channel():
    r = get_client()
    channel_id = secrets.token_hex(8)
    secret = secrets.token_urlsafe(24)
    r.set(f"channel:{channel_id}:secret", secret)
    return CreateChannelResponse(channel_id=channel_id, secret=secret)


@router.post("/channels/{channel_id}/join", status_code=201, response_model=JoinResponse)
def join_channel(channel_id: str, body: JoinRequest):
    r = get_client()
    _check_secret(r, channel_id, body.secret)

    for slot in SLOTS:
        # Slot ownership is permanent (no TTL) — whoever claims "buddy1" or
        # "buddy2" first keeps that identity for the channel's lifetime.
        # Presence (online:{slot}) is a separate, short-lived liveness flag —
        # letting it expire must never free up the slot for someone else to
        # claim, or two people can end up assigned the same slot.
        owned = r.set(f"channel:{channel_id}:slot:{slot}", "1", nx=True)
        if owned:
            r.set(f"channel:{channel_id}:online:{slot}", "1", ex=PRESENCE_TTL_SECONDS)
            return JoinResponse(slot=slot)
    raise HTTPException(status_code=409, detail={"error": "channel_full"})


@router.post("/channels/{channel_id}/heartbeat")
def heartbeat(channel_id: str, body: SlotRequest):
    r = get_client()
    _check_secret(r, channel_id, body.secret)
    # Check permanent slot ownership, not the expiring presence key — a
    # heartbeat that arrives after presence already lapsed should still
    # succeed and revive it, since the caller genuinely owns this slot.
    owned = r.exists(f"channel:{channel_id}:slot:{body.slot}") == 1
    if not owned:
        raise HTTPException(status_code=404, detail={"error": "not_claimed"})
    r.set(f"channel:{channel_id}:online:{body.slot}", "1", ex=PRESENCE_TTL_SECONDS)
    return {"ok": True}


@router.get("/channels/{channel_id}/presence/{slot}")
def get_presence(channel_id: str, slot: str, secret: str):
    r = get_client()
    _check_secret(r, channel_id, secret)
    online = r.exists(f"channel:{channel_id}:online:{slot}") == 1
    return {"online": online}


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


@router.get("/channels/{channel_id}/messages")
def pull_messages(channel_id: str, secret: str, since: int = 0):
    r = get_client()
    _check_secret(r, channel_id, secret)
    raw = r.lrange(f"channel:{channel_id}:messages", 0, -1)
    messages = [json.loads(m) for m in raw]
    return {"messages": [m for m in messages if m["id"] > since]}
