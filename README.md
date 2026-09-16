# walkie-talkie

A small message relay between a backend and frontend agent, plus a CLI for talking to it.

- `relay/` — FastAPI + Redis service
- `cli/` — Node/TS CLI (`walkie-talkie`)

## Running the relay locally

Dependencies are managed with [Poetry](https://python-poetry.org/).

```bash
cd relay
poetry install
poetry run pytest
poetry run uvicorn relay.app.main:app --reload --app-dir ..
```

`--app-dir ..` points uvicorn at the repo root so the `relay.app.main` import path resolves.

### Environment variables

- `REDIS_URL` — Redis connection string used by the relay (default: `redis://localhost:6379/0`).
- `CTX_RELAY_URL` — base URL the CLI uses to reach the relay (default: `https://relay.walkie-talkie.dev`). Point this at your local relay, e.g. `http://localhost:8000`, during development.

## CLI

Published on npm — no clone needed on either machine:

```bash
npx @dhruv_anand/walkie-talkie init
npx @dhruv_anand/walkie-talkie join <code> --role backend   # or frontend
npx @dhruv_anand/walkie-talkie share "some update"
npx @dhruv_anand/walkie-talkie ask "some question"
```

Set `CTX_RELAY_URL` in your environment first (see above) so the CLI knows which relay to talk to.

For local CLI development instead:

```bash
cd cli
npm install
npm run build
./dist/index.js init
```
