from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class CreateChannelResponse(BaseModel):
    channel_id: str
    secret: str


class JoinRequest(BaseModel):
    secret: str


class JoinResponse(BaseModel):
    slot: Literal["buddy1", "buddy2"]


class SlotRequest(BaseModel):
    secret: str
    slot: Literal["buddy1", "buddy2"]


class PushMessageRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    secret: str
    from_: Literal["buddy1", "buddy2"] = Field(alias="from")
    type: Literal["fyi", "question", "answer"]
    text: str
    reply_to: Optional[int] = None
