from fastapi import FastAPI

app = FastAPI(title="ctx-relay")


@app.get("/health")
def health():
    return {"status": "ok"}
