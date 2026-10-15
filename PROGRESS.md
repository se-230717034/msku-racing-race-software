# Implementation progress

Updated: 2026-10-15

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

## Later phases

- [ ] Phase 3 quasi-static loads and forces
- [ ] Phase 4 road and vehicle dynamics
- [ ] Phase 5 optimization
- [ ] Phase 6 professional workflows

