# walkie-talkie

A small message relay between a backend and frontend agent, plus a CLI for talking to it.

- `relay/` — FastAPI + Redis service
- `cli/` — Node/TS CLI (`walkie-talkie`)

## Running the relay locally

From the repository root (so the `relay.app.main` import path resolves):

```bash
cd relay
pip install -r requirements.txt  # or however deps are installed in this repo
uvicorn relay.app.main:app --reload
```

if the module is not importable from `relay/`, run instead from the repo root:

```bash
uvicorn relay.app.main:app --reload --app-dir .
```

### Environment variables

- `REDIS_URL` — Redis connection string used by the relay (default: `redis://localhost:6379/0`).
- `CTX_RELAY_URL` — base URL the CLI uses to reach the relay (default: `https://relay.walkie-talkie.dev`). Point this at your local relay, e.g. `http://localhost:8000`, during development.

## CLI

```bash
cd cli
npm install
npm run build
./dist/index.js init
```
