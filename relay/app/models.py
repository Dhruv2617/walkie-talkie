from pydantic import BaseModel


class CreateChannelResponse(BaseModel):
    channel_id: str
    secret: str
