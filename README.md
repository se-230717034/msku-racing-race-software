# MSKU Racing Dynamics Studio

An original, browser-based suspension engineering application for MSKU Racing. The current release implements the project foundation, a double-wishbone 3D geometry editor, a constrained rigid-link suspension-kinematics sweep, and guarded quasi-static suspension-force/load-transfer models. It does **not** calculate component stress, compliance, tyre constitutive forces, or transient vehicle dynamics.

Every bundled hardpoint is demonstration data, not an MSKU Racing vehicle specification. The visible model status is `demonstration / unvalidated`.

Kinematics solver `2.5.0` and quasi-static solver `3.0.0` are checked against analytical and independent reference cases, conservation, scaling, symmetry, perturbation, singularity, and failure-path tests. The demonstration vehicle model has not been compared with MSKU Racing CAD or physical measurements.

## Implemented

- Interactive Three.js/R3F corner view with orbit, pan, zoom, presets, selection, mirror view, and visibility controls.
- Precise hardpoint and wheel-dimension editing using millimetres while storing SI metres.
- Immediate structural and geometry diagnostics. Invalid models cannot be saved or exported.
- Versioned JSON project import/export and browser-local save/load.
- FastAPI health and project-validation endpoints backed by a separate Python engineering package.
- Nonlinear 3D bump/rebound solver using five fixed link lengths, a rigid upright transform, static-centred continuation, independently re-evaluated residuals, a dimensionless Jacobian rank/condition check, discontinuity rejection, and explicit failure states.
- Synchronized solved 3D poses, interactive wheel-travel control, camber, toe/bump steer, caster, KPI, track change, and symmetric-axle roll-centre results.
- Interactive travel graphs, per-point numerical diagnostics, and provenance-bearing CSV export that is blocked for failed sweeps.
- Separate `VERIFIED_NUMERICALLY`, `REFERENCE_BENCHMARKED`, `UNVALIDATED_PHYSICALLY`, and `FAILED` quality states; engineering approval remains `NOT_APPROVED`.
- Automated contract, analytical and alternative-formulation benchmark, step-convergence, perturbation, symmetry, geometry, storage, API, and numerical-core tests.
- Rank-aware 3D rigid-upright force/moment equilibrium using current Phase 2 geometry, ideal two-force UCA/LCA/tie-rod members, optional explicit actuation force path, chassis reactions, physical-unit residuals, and rejected incompatible/indeterminate systems.
- Explicit sampled-geometry motion ratio, linear spring/preload/energy/wheel-rate calculations, and velocity-gated linear damper force.
- Simplified static, longitudinal, and roll-stiffness-distributed lateral load transfer with wheel-unloading and negative-load rejection.
- Loads workspace with editable inputs, labeled synthetic presets, calculated Three.js force arrows, axial-force tables, diagnostics, load bars, actuation plots, provenance, and disabled approved export.

See [PROGRESS.md](./PROGRESS.md), the [Phase 2 verification report](./docs/PHASE_2_VERIFICATION_REPORT.md), the [Phase 3 models](./docs/PHASE_3_ENGINEERING_MODELS.md), the [Phase 3 verification report](./docs/PHASE_3_VERIFICATION_REPORT.md), and [docs/LIMITATIONS.md](./docs/LIMITATIONS.md) before engineering use.

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

The kinematics endpoint is `POST /api/v1/kinematics/sweep`. Phase 3 endpoints are under `POST /api/v1/quasi-static/*` for upright equilibrium, load transfer, actuation series, and damper force. Inputs and outputs use SI units; the interface applies explicitly labeled display conversions.

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
packages/engineering  Pure Python geometry and numerical kinematics core
docs                  Architecture, model, validation, and deployment records
```

## Data responsibility

Do not treat the demo coordinates as vehicle data. Before any engineering decision, replace them with measured/CAD-derived hardpoints, compare the sweep against an independent reference, and complete the checklist in [docs/TEAM_DATA_CHECKLIST.md](./docs/TEAM_DATA_CHECKLIST.md).

