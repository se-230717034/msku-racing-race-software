# Roadmap

## Phase 0 — Foundation

Monorepo, schemas, local project workflow, API boundary, CI, documentation, demo project, and explicit unavailable states. Implemented in the current slice.

## Phase 1 — Geometry editor

Current: double-wishbone points/links, wheel envelope, precise editing, mirror, camera/visibility controls, and diagnostics. Next: direct manipulation, configurable link topology, spring/damper and pushrod/rocker definitions, richer packaging constraints.

## Phase 2 — Validated kinematics

Add nonlinear bump and steering solvers only after constraint equations and independent fixtures are documented. Deliver CSV, plots, per-point residuals, and continuity diagnostics. Do not promote beyond `unvalidated` without benchmark evidence.

## Phase 3 — Quasi-static loads

Add corner weights, spring and damper characterization, motion leverage, equilibrium, and documented load-transfer approximations. Keep equilibrium separate from transient dynamics and compliance.

## Phase 4 — Road and vehicle dynamics

Begin with a benchmarked linear quarter-car and configurable road profiles. Advance to half/full-car only with adequate mass/inertia/tire inputs and numerical convergence evidence.

## Phase 5 — Optimization

Add reproducible sweeps, sensitivity, and bounded multi-objective search. Invalid geometry must never be accepted as an optimum.

## Phase 6 — Professional workflows

Comparison, traceable reports, revision history, validation reports, templates, and optional authenticated persistence.

