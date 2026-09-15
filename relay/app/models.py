from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class CreateChannelResponse(BaseModel):
    channel_id: str
    secret: str


class JoinRequest(BaseModel):
    secret: str
    role: Literal["backend", "frontend"]


class PushMessageRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    secret: str
    from_: Literal["backend", "frontend"] = Field(alias="from")
    type: Literal["fyi", "question", "answer"]
    text: str
    reply_to: Optional[int] = None
