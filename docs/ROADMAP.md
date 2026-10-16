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
Phase 5 adds the outstanding linear full-car and bicycle models; physical correlation remains open.

## Phase 5 — Optimization

Implemented: reproducible bounded differential evolution, explicit normalized weighted objectives,
seeded Pareto exploration, feasibility gates, baseline comparison, local sensitivity, four verified
model adapters, and non-mutating candidate preview with explicit apply. Global-optimum proof,
manufacturing/packaging constraints, and physical candidate validation remain open.

## Phase 6 — Professional workflows

Implemented: four-corner vehicle schema and visualization, safe legacy migration, independent corner
editing, solver-driven kinematics/full-car/bicycle playback, traceable PDF/CSV/JSON reports, and an
evidence-led validation register. See `PHASE_6_ENGINEERING_ARCHITECTURE.md` and
`PHASE_6_VERIFICATION_REPORT.md`.

Remaining product work: controlled MSKU Racing data import, CAD/measurement comparison automation,
authenticated persistence, revision history, roles, electronic signatures, report templates, and a
human-governed approval workflow. None is represented as complete in the current application.

