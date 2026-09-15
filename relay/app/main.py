from fastapi import FastAPI

from relay.app.channels import router as channels_router

app = FastAPI(title="ctx-relay")
app.include_router(channels_router)


@app.get("/health")
def health():
    return {"status": "ok"}
