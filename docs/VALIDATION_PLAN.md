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
- The browser acceptance flow runs a live sweep, verifies convergence panels and graphs, and changes the selected solved travel state.

## Phase 2 evidence and remaining gate

Implemented automated evidence:

1. A closed-form parallel equal-length-arm fixture independently predicts lateral translation `sqrt(L² - dz²) - L`, zero upright rotation, zero camber change, and zero bump steer.
2. Every fixed link is checked against its static length at every converged sweep point with a `1e-8 m` default maximum residual.
3. Zero-motion identity, left/right mirror symmetry, finite alignment gradients, unreachable travel, schema/API behavior, and explicit failure responses are tested.
4. Every output records residual norm, maximum residual, Jacobian rank, condition number, function evaluations, warnings, solver units, and model status.

Still required before the MSKU Racing vehicle model may be called benchmarked or experimentally validated:

1. Compare the real team geometry sweep against an independent CAD motion study or legally available reference solver.
2. Compare static and swept alignment against physical measurement with stated uncertainty.
3. Record the input-file hash and reference-tool configuration in a validation report.

## Later gates

- Quasi-static forces: force/moment residuals, energy consistency, dimensions, missing-parameter failures.
- Dynamics: analytical quarter-car cases, step-size convergence, energy/passivity, contact-loss handling.
- Optimization: deterministic seeds, infeasibility cases, known objective functions, and full candidate revalidation.

