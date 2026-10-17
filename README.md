<div align="center">
  <img src="images/msku-racing-logo.png" alt="MSKU Racing Logo" width="320" />

  # MSKU Racing Dynamics Studio

  **Browser-Based Suspension & Vehicle Dynamics Engineering Platform**

  ![Release](https://img.shields.io/badge/Release-0.6.1-0B2345)
  ![Project Schema](https://img.shields.io/badge/Project_Schema-2.0.0-0B2345)
  ![UI](https://img.shields.io/badge/Interface-Türkçe-C8102E)
  ![Validation](https://img.shields.io/badge/Vehicle_Model-Unvalidated-orange)

  **[Open Live Application](https://msku-racing-race-software.vercel.app)** · **[Engineering Progress](./PROGRESS.md)** · **[Limitations](./docs/LIMITATIONS.md)**
</div>

---

## Overview

Current application release: `0.6.1` · project schema: `2.0.0`.

An original, browser-based suspension and vehicle-dynamics engineering application for MSKU Racing. Release `0.6.1` provides a Turkish user interface and production-ready Vercel routing while retaining the real four-corner FL/FR/RL/RR vehicle workspace, double-wishbone geometry editor, constrained rigid-link kinematics, guarded quasi-static loads, benchmarked linear dynamics, deterministic optimization, and professional reporting/validation workflow. It does **not** calculate component stress, compliance, nonlinear tyre behavior, or claim physical vehicle correlation.

Every bundled hardpoint is demonstration data, not an MSKU Racing vehicle specification. The visible model status is `demonstration / unvalidated`.

Kinematics solver `2.5.0`, quasi-static solver `3.0.0`, coilover spring–damper solver `3.1.0`, quarter-car solver `4.0.0`, and Phase 5 full-car/bicycle solvers `5.0.0` are checked against analytical and independent reference cases, conservation/passivity, convergence, cross-algorithm agreement, scaling, symmetry, perturbation, singularity, and failure-path tests as applicable. The demonstration vehicle model has not been compared with MSKU Racing CAD or physical measurements.

The Kinematics workspace evaluates the solved pushrod–rocker coilover with explicit spring rate, preload, compression/rebound damping, stroke limits, local motion ratio, and user-declared wheel velocity. The GLB coilover follows the same solved eye-to-eye length without changing hub or brake placement. See [docs/COILOVER_SPRING_DAMPER_MODEL.md](docs/COILOVER_SPRING_DAMPER_MODEL.md) for equations, signs, and limitations.

## Implemented

- Project schema `2.0.0` with four independently addressable corners, vehicle dimensions, CG, mass properties, provenance, evidence records, and safe `1.0.0` migration.
- Full-vehicle Three.js/R3F assembly with distinct FL/FR/RL/RR wheels and suspensions, independent front/rear definitions, configurable wheelbase/tracks/CG, reference chassis/axles/planes, and explicit mirror/synthetic labels.
- Procedural CAD-style tires, tread, rims, hubs, drilled brake discs, calipers, open-web uprights, clevises, rod-end joints, wishbone tubes, and steering rods driven directly by the current hardpoints and accepted pose data.
- Selectable GLB visual assembly using audited tire/rim, rotor/caliper, hub, upright, and coilover assets on all four corners; duplicate embedded brake meshes are suppressed, right-hand parts are mirrored, and the complete procedural assembly remains available as a fallback. The packaged demonstration project carries separately generated `DEMO/SYNTHETIC` pushrod geometry; fixed pushrod length and rocker-axis constraints solve rocker rotation and coilover length for each accepted upright pose, while infeasible closures are suppressed.
- Turkish `Teknik`, `Detaylı`, and `Karma` inspection modes shared by the Vehicle and Geometry screens, with physically based materials, multi-source lighting, shadows, and performance-conscious reusable corner assemblies.
- Full vehicle, axle, individual-corner, chassis/CG, suspension, kinematics, and dynamics views with six camera presets and persistent visibility state.
- Exact stored-input comparison for corner provenance, link lengths, alignment, and hardpoint deltas; calculated cross-corner comparison stays blocked until both corners have independent results.
- Solver-gated visualization: a kinematic result affects only its solved corner; accepted 7DOF samples drive body heave/pitch/roll and four independent unsprung positions; bicycle steer/yaw visualization uses only returned histories and documented integration.
- The procedural parts are visualization geometry, not manufacturing CAD or structural evidence. Unsolved dynamic link closure remains hidden rather than being animated heuristically. An optional, default-off pushrod/rocker/spring-damper overlay is explicitly marked as a static unsupported reference and never presented as calculated motion.
- Traceable engineering reports with metadata, inputs, units/frame, vector geometry diagrams, available result plots, solver diagnostics/provenance, warnings, limitations, validation state, and PDF/CSV/JSON output.
- Validation/evidence register for numerical benchmarks, CAD comparisons, physical measurements, and input provenance; physical validation and engineering approval cannot be granted automatically.
- Interactive Three.js/R3F corner view with orbit, pan, zoom, upright-focused presets, selection, mirror view, and independent tire, rim, brake-disc, caliper, hub, upright, wishbone, and tie-rod visibility. The `Mekanik Montaj` preset hides tire/rim while retaining the complete exposed suspension/brake assembly; reference planes and the pickup panel are hidden by default.
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
- The 7DOF contact guard is evaluated at accepted integration states and every reported dense-output sample; an unsupported negative normal force suppresses the complete reported result instead of leaking an invalid interpolation.
- Constant-speed linear planar bicycle model derived from Newton-Euler balance with explicit axle cornering stiffnesses, stability/understeer diagnostics, analytical steady-state gains, domain-limit rejection, and calculated UI plots.
- Deterministic bounded differential-evolution framework with explicit objective normalization, weighted multi-objective search, seeded Pareto exploration, feasibility rejection, baseline comparison, and local finite-difference sensitivity.
- Verified adapters for hardpoint coordinates, supported quarter/full-car spring-damper parameters, and bicycle cornering stiffness/speed; unsupported metrics are rejected rather than fabricated.
- Optimization workspace with variable/bound controls, convergence/Pareto plots, candidate diagnostics, non-mutating geometry preview, and explicit apply.
- Versioned Vehicle Parameter Manifest records configuration, SI units, source type, measurement state, uncertainty, applicable modules, evidence references, and deterministic content hash. Bundled defaults remain explicitly `SYNTHETIC`.
- Independent `declared`, `numerically verified`, `reference benchmarked`, and `physically correlated` axes require accepted evidence of their own type; numerical tests and solver success cannot promote physical correlation.

See [PROGRESS.md](./PROGRESS.md), the [GLB integration report](./docs/GLB_MODEL_INTEGRATION.md), the [Vehicle Parameter Manifest specification](./docs/VEHICLE_PARAMETER_MANIFEST.md), the [Phase 6 architecture](./docs/PHASE_6_ENGINEERING_ARCHITECTURE.md), the [Phase 6 verification report](./docs/PHASE_6_VERIFICATION_REPORT.md), prior phase model/verification reports, and [docs/LIMITATIONS.md](./docs/LIMITATIONS.md) before engineering use.

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

The kinematics endpoint is `POST /api/v1/kinematics/sweep`. Phase 3 endpoints are under `POST /api/v1/quasi-static/*`. Dynamics endpoints are `POST /api/v1/dynamics/quarter-car/simulate`, `POST /api/v1/dynamics/full-car/simulate`, and `POST /api/v1/dynamics/bicycle/simulate`. Optimization uses `POST /api/v1/optimization/run`. Inputs and outputs use SI units; the interface applies explicitly labeled display conversions. Playwright starts both web and API test servers automatically.

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

## Vercel deployment

The repository includes a Vite SPA configuration, a same-origin FastAPI entry point at `api/index.py`, production-only Python requirements, and SPA/API rewrites in `vercel.json`.

Production: [https://msku-racing-race-software.vercel.app](https://msku-racing-race-software.vercel.app)

```bash
vercel deploy --prod
```

The numerical API depends on NumPy and SciPy. Its uncompressed Python function is larger than Vercel's standard 500 MB Python limit, so the production project uses Vercel Large Functions support. This keeps the verified numerical implementation intact rather than replacing it with fabricated or reduced calculations.

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
