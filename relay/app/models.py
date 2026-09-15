from typing import Literal

from pydantic import BaseModel


class CreateChannelResponse(BaseModel):
    channel_id: str
    secret: str


class JoinRequest(BaseModel):
    secret: str
    role: Literal["backend", "frontend"]
