# MSKU Racing Dynamics Studio

An original, browser-based suspension engineering application for MSKU Racing. The current release implements the project foundation and the first working vertical slice of a double-wishbone 3D geometry editor. It does **not** yet calculate suspension kinematics or dynamics.

Every bundled hardpoint is demonstration data, not an MSKU Racing vehicle specification. The visible model status is `demonstration / unvalidated`.

## Implemented

- Interactive Three.js/R3F corner view with orbit, pan, zoom, presets, selection, mirror view, and visibility controls.
- Precise hardpoint and wheel-dimension editing using millimetres while storing SI metres.
- Immediate structural and geometry diagnostics. Invalid models cannot be saved or exported.
- Versioned JSON project import/export and browser-local save/load.
- FastAPI health and project-validation endpoints backed by a separate Python engineering package.
- Automated contract, geometry, storage, API, and numerical-core tests.

See [PROGRESS.md](./PROGRESS.md) for the live checklist and [docs/LIMITATIONS.md](./docs/LIMITATIONS.md) before engineering use.

## Prerequisites

- Node.js 22+ and npm 10+
- Python 3.12+ via `uv` 0.10+

## Install and run

```bash
npm ci
uv sync --all-packages --all-extras --dev
```

Terminal 1:

```bash
npm run api:dev
```

Terminal 2:

```bash
npm run dev
```

Open `http://localhost:5173`. The API is served at `http://localhost:8000` and its OpenAPI UI at `http://localhost:8000/docs`.

## Quality checks

```bash
npm run quality
uv run ruff check packages/engineering services/api
uv run mypy packages/engineering/src services/api/src
npm run test:python
```

Optional browser flow:

```bash
npx playwright install chromium
npm run test:e2e
```

## Docker

```bash
docker compose up --build
```

The web container is exposed on `http://localhost:4173`; the API remains on port `8000`.

## Repository layout

```text
apps/web              React/TypeScript engineering workspace
services/api          FastAPI boundary and versioned endpoints
packages/contracts    Shared TypeScript schemas and demo project
packages/engineering  Pure Python geometry validation core
docs                  Architecture, model, validation, and deployment records
```

## Data responsibility

Do not treat the demo coordinates as vehicle data. Before Phase 2 validation or any engineering decision, replace them with measured/CAD-derived hardpoints and complete the checklist in [docs/TEAM_DATA_CHECKLIST.md](./docs/TEAM_DATA_CHECKLIST.md).

