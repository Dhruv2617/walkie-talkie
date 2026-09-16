from fastapi import FastAPI

from .channels import router as channels_router

app = FastAPI(title="walkie-talkie relay")
app.include_router(channels_router)


@app.get("/health")
def health():
    return {"status": "ok"}
