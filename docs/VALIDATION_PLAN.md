# Validation plan

## Status vocabulary

- `demonstration`: synthetic input intended to exercise the software.
- `unvalidated`: a calculation exists but lacks adequate independent agreement.
- `benchmarked`: agreement has been demonstrated against a documented independent reference over a stated range.
- `experimentally_validated`: agreement has been demonstrated against physical measurement with documented uncertainty.

The included project is `demonstration`; its model is `unvalidated`.

## Phase 0/1 evidence

- Contract tests parse the demo project and reject unknown schema versions and malformed coordinates.
- Geometry tests cover deterministic link lengths, mirroring, non-finite values, point coincidence, upright ordering, chassis/outboard ordering, and wheel dimensions.
- Storage tests cover serialized browser round-trip and rejection of corrupt payloads.
- API integration tests cover health, valid project validation, and invalid geometry diagnostics.
- A browser smoke test covers selecting and editing a hardpoint, saving locally, and exporting only valid data.

## Phase 2 gate

Before kinematics is called benchmarked:

1. Derive at least one analytical or independently calculated fixture.
2. Verify all rigid-link residuals at every sample against a published tolerance.
3. Test zero-motion identity, left/right symmetry, coordinate-transform reversibility, finite-difference trends, and sweep continuity.
4. Compare against CAD motion study or a legally available/open reference.
5. Record solver, tolerances, versions, input hash, and known validity range.

## Later gates

- Quasi-static forces: force/moment residuals, energy consistency, dimensions, missing-parameter failures.
- Dynamics: analytical quarter-car cases, step-size convergence, energy/passivity, contact-loss handling.
- Optimization: deterministic seeds, infeasibility cases, known objective functions, and full candidate revalidation.

