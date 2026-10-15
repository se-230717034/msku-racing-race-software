# Roadmap

## Phase 0 — Foundation

Monorepo, schemas, local project workflow, API boundary, CI, documentation, demo project, and explicit unavailable states. Implemented in the current slice.

## Phase 1 — Geometry editor

Current: double-wishbone points/links, wheel envelope, precise editing, mirror, camera/visibility controls, and diagnostics. Next: direct manipulation, configurable link topology, spring/damper and pushrod/rocker definitions, richer packaging constraints.

## Phase 2 — Validated kinematics

Implemented and Phase 2.5 audited: nonlinear bump/rebound solver, solved 3D poses, alignment metrics, supported-case geometric roll-centre construction, interactive plots, guarded traceable CSV, independent residual/Jacobian checks, branch rejection, analytical and alternate-formulation references, step convergence, perturbation sensitivity, and explicit multidimensional quality status. Remaining validation work is comparison against MSKU Racing CAD/measurement. Steering-rack sweep, motion ratio, and actuation geometry remain follow-up work and are not silently approximated.

## Phase 3 — Quasi-static loads

Implemented reliable subset: rank-aware upright equilibrium, sampled motion ratio, linear spring and
velocity-gated damper models, and documented load-transfer approximations. Integrated rocker closure
and physical validation remain open.

## Phase 4 — Road and vehicle dynamics

Implemented reliable subset: benchmarked linear 2DOF quarter car, five configurable road profiles,
three integration algorithms, energy/contact diagnostics, calculated playback, and guarded export.
Advance to half/full-car and handling only with adequate mass/inertia/tire inputs and independent
numerical and physical evidence.

## Phase 5 — Optimization

Add reproducible sweeps, sensitivity, and bounded multi-objective search. Invalid geometry must never be accepted as an optimum.

## Phase 6 — Professional workflows

Comparison, traceable reports, revision history, validation reports, templates, and optional authenticated persistence.

