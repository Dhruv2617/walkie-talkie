import json
import secrets
import time

from fastapi import APIRouter, HTTPException

from relay.app.models import CreateChannelResponse, JoinRequest, PushMessageRequest
from relay.app.redis_client import get_client

router = APIRouter()

PRESENCE_TTL_SECONDS = 60
MAX_MESSAGES = 50


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
    refreshed = r.expire(f"channel:{channel_id}:online:{body.role}", PRESENCE_TTL_SECONDS)
    if not refreshed:
        raise HTTPException(status_code=404, detail={"error": "not_claimed"})
    return {"ok": True}


@router.get("/channels/{channel_id}/presence/{role}")
def get_presence(channel_id: str, role: str, secret: str):
    r = get_client()
    _check_secret(r, channel_id, secret)
    online = r.exists(f"channel:{channel_id}:online:{role}") == 1
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
