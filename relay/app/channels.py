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
