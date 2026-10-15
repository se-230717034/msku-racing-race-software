# MSKU Racing Dynamics Studio

An original, browser-based suspension engineering application for MSKU Racing. The current release implements the project foundation, a double-wishbone 3D geometry editor, constrained rigid-link suspension kinematics, guarded quasi-static loads, and benchmarked linear quarter-car, full-car ride, and bicycle-handling models. It does **not** calculate component stress, compliance, nonlinear tyre behavior, or claim physical vehicle correlation.

Every bundled hardpoint is demonstration data, not an MSKU Racing vehicle specification. The visible model status is `demonstration / unvalidated`.

Kinematics solver `2.5.0`, quasi-static solver `3.0.0`, quarter-car solver `4.0.0`, and Phase 5 full-car/bicycle solvers `5.0.0` are checked against analytical and independent reference cases, conservation/passivity, convergence, cross-algorithm agreement, scaling, symmetry, perturbation, singularity, and failure-path tests as applicable. The demonstration vehicle model has not been compared with MSKU Racing CAD or physical measurements.

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
- Separate Python 2DOF quarter-car module with static-equilibrium perturbation coordinates, explicit force signs, optional tire damping and static contact load, and all state/force histories.
- Step, smooth raised-cosine bump, half-sine bump, continuous sine, and piecewise-linear sampled road inputs with explicit discontinuity boundaries.
- Configurable DOP853, Radau, and BDF integration, analytical Jacobian for implicit methods, actual accepted-step diagnostics, natural modes, energy/passivity diagnostics, and guarded contact-loss failure.
- Dynamics workspace with editable parameters, road data, solver controls, calculated response plots, sample-synchronized Three.js playback, provenance, limitations, and unvalidated CSV export.
- Independent eigenvalue/modal-decay tests, step and tolerance convergence, DOP853/Radau/BDF comparison, road interpolation, energy, contact, API, contract, and browser regression tests.
- Linear 7DOF full-car ride model with body heave/pitch/roll, four unsprung masses, four independent roads, assembled physical matrices, seven natural modes, per-corner contact guarding, energy diagnostics, and calculated UI plots.
- Constant-speed linear planar bicycle model derived from Newton-Euler balance with explicit axle cornering stiffnesses, stability/understeer diagnostics, analytical steady-state gains, domain-limit rejection, and calculated UI plots.
- Deterministic bounded differential-evolution framework with explicit objective normalization, weighted multi-objective search, seeded Pareto exploration, feasibility rejection, baseline comparison, and local finite-difference sensitivity.
- Verified adapters for hardpoint coordinates, supported quarter/full-car spring-damper parameters, and bicycle cornering stiffness/speed; unsupported metrics are rejected rather than fabricated.
- Optimization workspace with variable/bound controls, convergence/Pareto plots, candidate diagnostics, non-mutating geometry preview, and explicit apply.

See [PROGRESS.md](./PROGRESS.md), the [Phase 2 verification report](./docs/PHASE_2_VERIFICATION_REPORT.md), the Phase 3 and Phase 4 model/verification reports, the [Phase 5 engineering models](./docs/PHASE_5_ENGINEERING_MODELS.md), the [Phase 5 verification report](./docs/PHASE_5_VERIFICATION_REPORT.md), and [docs/LIMITATIONS.md](./docs/LIMITATIONS.md) before engineering use.

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

The kinematics endpoint is `POST /api/v1/kinematics/sweep`. Phase 3 endpoints are under `POST /api/v1/quasi-static/*`. Dynamics endpoints are `POST /api/v1/dynamics/quarter-car/simulate`, `POST /api/v1/dynamics/full-car/simulate`, and `POST /api/v1/dynamics/bicycle/simulate`. Optimization uses `POST /api/v1/optimization/run`. Inputs and outputs use SI units; the interface applies explicitly labeled display conversions.

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

