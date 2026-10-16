# Implementation progress

Updated: 2026-10-16

## Phase 0 — Foundation

- [x] Monorepo structure for web, API, engineering core, and contracts
- [x] Reproducible Node and Python dependency manifests
- [x] CI definitions for lint, types, tests, and build
- [x] Architecture, physics, coordinate, validation, limitation, roadmap, deployment, and team-data docs
- [x] Versioned project schema with structural validation
- [x] Labeled demonstration project
- [x] Local project save/load and JSON import/export
- [x] FastAPI health and project-validation endpoints
- [x] React error boundary and explicit unsupported-section states
- [x] Distinct text-only MSKU Racing engineering interface
- [ ] Official logo integration — waiting for a rights-cleared asset
- [ ] Hosted deployment — credentials/provider selection not supplied

## Phase 1 — First vertical slice

- [x] Double-wishbone corner hardpoints and link topology
- [x] Interactive orbit/pan/zoom 3D viewport
- [x] Hardpoint selection and precise XYZ editing in millimetres
- [x] Camera presets, mirror view, and visibility toggles
- [x] Editable wheel radius and width
- [x] Deterministic geometry updates and JSON round-trip
- [x] Constraint diagnostics for degeneracy, point ordering, and invalid wheel dimensions
- [x] Save/export guard when geometry contains errors
- [x] TypeScript and Python geometry validation tests
- [ ] Direct manipulation of points in the 3D viewport
- [ ] Pushrod/rocker editor — no sample geometry is fabricated; requires actual topology or a separately labeled demo model
- [ ] Spring/damper mounts — requires geometrically specified points

## Phase 2 — Validated suspension kinematics

- [x] Six-unknown 3D rigid-upright nonlinear constraint solver
- [x] Five fixed suspension-link constraints plus prescribed wheel-centre travel
- [x] Static-centred continuation through bump and rebound
- [x] Interactive travel slider synchronized to solved Three.js positions and wheel orientation
- [x] Camber, camber change, and finite-difference camber gain
- [x] Toe, bump steer, and finite-difference bump-steer gradient
- [x] Caster and KPI/SAI from the current kingpin axis
- [x] Front-view instant centre and symmetric-axle roll-centre height where geometry is non-singular
- [x] Interactive alignment and migration graphs
- [x] Per-point residual, Jacobian rank/condition, evaluation count, warnings, and failure messages
- [x] CSV export with units, solver diagnostics, and warnings
- [x] Zero-motion, length preservation, left/right symmetry, failure, API, and closed-form analytical benchmark tests
- [x] Phase 2.5 mathematical audit and independent equation derivations
- [x] Dimensionless Jacobian, independent residual evaluation, and branch/discontinuity rejection
- [x] Unequal-length asymmetric reference solve using alternate variables, residual form, and root method
- [x] Travel-step convergence and deterministic hardpoint-uncertainty sensitivity studies
- [x] Unsupported roll-centre suppression and rigid-wheel contact-point correction
- [x] Multidimensional numerical/reference/physical quality states visible in the UI
- [x] Input SHA-256, solver version/tolerances, warnings, units, and approval state in exports
- [x] Failed-sweep export blocking
- [x] Phase 2 verification report with quantitative discrepancies and remaining risks
- [ ] MSKU Racing CAD motion-study or physical-measurement comparison — required before changing model status from `unvalidated`

## Phase 3 — Verified quasi-static loads and forces

- [x] Separate versioned Python quasi-static engineering module
- [x] Rank-aware 3D upright force/moment equilibrium from accepted Phase 2 poses
- [x] UCA/LCA/tie-rod axial loads, optional explicit sixth force path, and chassis reactions
- [x] Independent force/moment residual, matrix-rank, condition, and failure diagnostics
- [x] Explicit rejection of incompatible, singular, ill-conditioned, and statically indeterminate systems
- [x] Optional project schema for pushrod/pullrod, rocker, spring, and damper coordinates/properties
- [x] Sampled geometric motion ratio, spring preload/force/energy, and wheel-rate model
- [x] Damper-force model gated by explicitly supplied velocity
- [x] Static and longitudinal load transfer and stiffness-distributed lateral load transfer
- [x] Missing-stiffness, wheel-unloading, and negative-normal-load safety paths
- [x] Quasi-static UI with editable inputs, labeled synthetic preset, calculated force arrows, tables, diagnostics, plots, and provenance
- [x] Approved engineering export disabled for physically unvalidated results
- [x] Analytical 3D equilibrium, conservation, scaling, symmetry, sensitivity, spring-energy, failure, API, contract, and browser tests
- [x] Phase 3 model and verification documentation
- [x] Final gates: 59 Python tests, 16 Vitest tests, 2 Chromium tests, Ruff, mypy, ESLint, TypeScript, and production build
- [ ] Integrated rocker/pushrod kinematic closure from stored coordinates
- [ ] Independent CAD/static-load and physical rig validation for MSKU Racing vehicle data

## Phase 4 — Verified road and vehicle dynamics

- [x] Separate versioned Python dynamics module and typed API/browser contracts
- [x] Linear 2DOF quarter car in static-equilibrium perturbation coordinates
- [x] Sprung/unsprung states, suspension/tire forces, tire damping option, and contact diagnostics
- [x] Step, smooth raised-cosine, half-sine, continuous sine, and sampled road inputs
- [x] DOP853, Radau, and BDF integration with configurable tolerances and maximum step
- [x] Known-discontinuity/sample-knot interval splitting and accepted internal-step diagnostics
- [x] Natural-mode, energy/passivity, road-work, dissipation, and output-quadrature diagnostics
- [x] Explicit tire-contact-loss failure with all engineering samples suppressed
- [x] Dynamics workspace with input editor, solver controls, real plots, calculated playback, and limitations
- [x] Provenance-bearing unvalidated CSV export gated on numerical acceptance
- [x] Analytical eigenvalue and modal-response benchmarks
- [x] Step/tolerance refinement and DOP853/Radau/BDF cross-integrator comparison
- [x] Road interpolation, force-sign, equilibrium, passivity, invalid-input, contact, API, contract, and browser tests
- [x] Phase 4 engineering-model and verification documentation
- [x] Final gates: 77 Python tests, 19 Vitest tests, 3 Chromium tests, Ruff, mypy, ESLint, TypeScript, and production build
- [x] Full-car heave/pitch/roll model completed in Phase 5 with explicit demonstration parameters
- [x] Planar bicycle handling model completed in Phase 5 with explicit demonstration parameters
- [ ] MSKU Racing parameter provenance and independent rig/track validation

## Phase 5 — Dynamics completion and optimization

- [x] Linear 7DOF full-car model with body heave, pitch, roll, and four unsprung coordinates
- [x] Four independent road inputs and per-corner suspension, tire, mass, and static-load parameters
- [x] Matrix assembly, generalized natural modes, energy accounting, and contact-loss suppression
- [x] Symmetry, sign, modal, quarter-car equivalence, cross-integrator, contact, and invalid-geometry tests
- [x] Constant-speed two-state linear planar bicycle model derived from Newton-Euler balance
- [x] Slip/force states, stability eigenvalues, understeer, characteristic/critical speed, and analytical steady response
- [x] Explicit linear-domain limits with failed-result suppression
- [x] Independent state-matrix, matrix-exponential transient, steady-state, sign, integrator, instability, and domain tests
- [x] Typed API and browser contracts plus calculated full-car and handling result workspaces
- [x] Phase 5 engineering model documentation for completed dynamics models
- [x] Deterministic bounded optimization core with infeasible/non-finite model rejection
- [x] Hardpoint, quarter-car, full-car, and bicycle verified-model adapters
- [x] Explicit normalized weighted objectives and target objectives
- [x] Reproducible seeded Pareto exploration with duplicate/dominance filtering
- [x] Baseline comparison and bounded central/one-sided local sensitivity
- [x] Geometry, link length, solver convergence, travel, contact, stability, and model-domain constraints
- [x] Optimization workspace with model/objective/variable selection, SI bounds, run controls, and diagnostics
- [x] Convergence and Pareto graphs plus baseline/candidate and sensitivity panels
- [x] Non-mutating 3D candidate geometry preview and explicit apply action
- [x] Analytical minima, bounds, normalization, Pareto, reproducibility, failure, sensitivity, API, contract, and browser tests
- [x] Phase 5 model and quantitative verification documentation
- [x] Final gates: 108 Python tests, 25 Vitest tests, 5 Chromium tests, Ruff, mypy, ESLint, TypeScript, and production build
- [ ] MSKU Racing parameter provenance and independent rig/track validation

## Phase 6 — Professional engineering workflows

- [x] Real four-corner FL/FR/RL/RR project representation and reusable scene assemblies
- [x] Independently configurable front/rear geometry with explicit mirror/synthetic provenance
- [x] Configurable wheelbase, front/rear track, CG, mass properties, and coordinate references
- [x] Lossless project `1.0.0` to `2.0.0` migration with legacy storage fallback and no load-time overwrite
- [x] Full vehicle, axle, corner, chassis/CG, suspension, kinematics, and dynamics view modes
- [x] Perspective, isometric, front, rear, side, and top cameras plus persistent visibility state
- [x] Exact per-corner hardpoint/link/alignment comparison without inferred solver results
- [x] Matching-corner-only kinematics playback with unsupported-state blocking
- [x] 7DOF body heave/pitch/roll and four distinct unsprung histories driven by accepted solver samples
- [x] Bicycle steer and trapezoid-integrated yaw-heading visualization within model scope
- [x] Traceable PDF, CSV, JSON, and printable vector-diagram report packages
- [x] Evidence register for benchmarks, CAD comparisons, measurements, and provenance
- [x] Hard `UNVALIDATED_PHYSICALLY` / `NOT_APPROVED` safety boundary without automatic promotion
- [x] Stable scene-level FL/FR/RL/RR identifiers and Chromium full-vehicle acceptance tests
- [x] Phase 6 architecture and quantitative verification documentation
- [x] Final gates: 110 Python tests, 37 Vitest tests, 8 Chromium tests, Ruff, mypy, ESLint, TypeScript, and production build
- [ ] Controlled MSKU Racing four-corner CAD/hardpoint/mass-property dataset
- [ ] Independent CAD motion-study, rig, and track validation evidence
- [ ] Authenticated multi-user revision/approval workflow and electronic signatures

## Release 0.6.1 — Turkish UI and production deployment

- [x] Turkish navigation, workspaces, engineering panels, charts, validation states, reports, errors, and demo-data labels
- [x] Centralized local-development and same-origin production API routing
- [x] Vercel Vite SPA, FastAPI entry point, Python runtime requirements, and route rewrites
- [x] Vercel bundle exclusions for local runtimes, development tests, reports, and unrelated frontend files
- [x] Release version synchronized across npm, Python packages, API health, UI footer, and reports
- [x] Quality gates: ESLint, TypeScript, production build, Ruff, mypy, 37 Vitest tests, 110 Python tests, and 8 Chromium flows
- [x] Vercel project created and connected to the GitHub repository
- [ ] Production URL activation — requires explicit Vercel Large Functions opt-in because the NumPy/SciPy API bundle is 595.15 MB and the standard Python limit is 500 MB

