# Validation plan

## Status vocabulary

- `demonstration`: synthetic input intended to exercise the software.
- `unvalidated`: a calculation exists but lacks adequate independent agreement.
- `benchmarked`: agreement has been demonstrated against a documented independent reference over a stated range.
- `experimentally_validated`: agreement has been demonstrated against physical measurement with documented uncertainty.

Runtime Phase 2 responses use more explicit orthogonal states:

- `VERIFIED_NUMERICALLY`: all requested states pass finite-value, independent residual, scaled-Jacobian, and continuity checks;
- `REFERENCE_BENCHMARKED`: the stated solver version passes repository analytical and alternative-formulation references;
- `UNVALIDATED_PHYSICALLY`: no approved CAD/measurement evidence is attached;
- `FAILED`: at least one state is rejected or unattempted.

Phase 3 adds `NOT_COMPUTABLE`: the declared model lacks an independent force path or required
physical input, or a unique result would require an unimplemented stiffness/compliance model. It is
not treated as a small-error success.

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
2. An unequal-length asymmetric 3D fixture is cross-checked with XYZ Euler variables, normalized squared-distance equations, and MINPACK hybrid root finding rather than the production rotation-vector/length-residual/least-squares formulation.
3. Step refinement demonstrates the expected central-difference convergence trend at static; deterministic ±0.2 mm hardpoint perturbations exercise local sensitivity and branch continuity.
4. Every fixed link is checked against its static length at every converged sweep point with a `1e-8 m` default maximum residual.
5. Zero-motion identity, left/right mirror symmetry, nonzero alignment, gradient isolation around failures, singularity, unreachable travel, schema/API behavior, and explicit failure responses are tested.
6. Every output records residual norm, maximum residual, scaled-Jacobian rank/condition, optimizer/residual/Jacobian/continuity acceptance, function evaluations, warnings, units, solver version/tolerances, input SHA-256, and separated quality states.

Still required before the MSKU Racing vehicle model may be called benchmarked or experimentally validated:

1. Compare the real team geometry sweep against an independent CAD motion study or legally available reference solver.
2. Compare static and swept alignment against physical measurement with stated uncertainty.
3. Record the input-file hash and reference-tool configuration in a validation report.

## Phase 3 evidence and remaining gate

- Hand-constructed three- and six-member wrench bases test force/moment conservation and sign.
- Scaling, rank deficiency, incompatible wrench, more-than-six-unknown, and geometric perturbation
  cases exercise matrix-quality and sensitivity paths.
- Static, longitudinal, lateral-mirror, missing-stiffness, unloading, and negative-load cases verify
  the simplified vehicle model.
- Linear and nonuniform sampled actuation cases verify motion ratio, spring force, energy, and wheel
  rate. Damper tests require explicit velocity.
- API and TypeScript contract tests verify units, versions, hashes/statuses, and suppression of
  unsupported results. Chromium acceptance exercises the actual Loads workspace.

Still required: independent CAD/static-force comparison, actuation motion-study comparison, corner
weight/load-cell evidence, and uncertainty review. These are prerequisites to any physical
validation or approval change. See `PHASE_3_VERIFICATION_REPORT.md`.

## Phase 4 evidence and remaining gate

- The undamped frequency polynomial is solved independently and compared with both returned modes.
- An independently constructed modal eigenvector and closed-form cosine response verify the coupled
  state equations; a proportional-damping case verifies the closed-form modal decay.
- Smooth-bump maximum-step and sine-input tolerance studies quantify convergence.
- DOP853, Radau, and BDF must agree on a nontrivial damped response within stated displacement
  tolerances; accepted internal step ranges are recorded.
- Zero equilibrium, static step limit, road displacement/velocity functions, sampled interpolation,
  monotonic passive energy decay, force signs, and finite states are regression tested.
- Missing static contact load is explicit. Predicted negative total contact force returns `FAILED`
  and suppresses all samples rather than clipping the result.
- API, TypeScript, and Chromium tests verify provenance, quality states, plots, calculated playback,
  and export gating. See `PHASE_4_VERIFICATION_REPORT.md` for quantitative results.

Still required: traceable MSKU Racing corner masses, wheel rates, tire vertical properties, damper
dyno curves, corner weights, and independent rig/track response with uncertainty.

## Phase 5 evidence and remaining gate

- Full-car matrices, generalized modes, exact undamped response, symmetric quarter-car reduction,
  sign behavior, cross-integrator agreement, contact loss, and invalid ordering are tested.
- Bicycle Newton-Euler matrices, analytical steady state, independent matrix exponential, steering
  signs, cross-integrator agreement, instability, low speed, and linear-domain failure are tested.
- Optimization tests cover analytical minima, bounds, explicit normalization, target objectives,
  reproducibility, Pareto nondominance, failed-model rejection, and finite-difference sensitivity.
- Real model adapters are exercised for hardpoints, spring/damping, full-car corner parameters, and
  bicycle stiffness. API, TypeScript, and Chromium tests cover integration and quality states.

Still required: independent CAD/rig/track correlation with traceable MSKU Racing inputs; an
independent optimization method/budget study for any selected candidate; manufacturing and
packaging constraints; and engineering review before a candidate is released.

## Phase 6 evidence and remaining gate

- Project contract and API tests require exactly four internally consistent corner definitions and
  preserve the complete legacy source corner during `1.0.0` migration.
- Coordinate tests reconstruct the declared 1.6 m wheelbase, 1.44 m front track, and 1.4 m rear track
  from the four scene assemblies to `1e-10 m` test tolerance for the synthetic fixture.
- Independent-corner store and Chromium tests verify edit persistence without cross-corner mutation.
- Playback tests require exact use of four distinct unsprung histories, matching-corner kinematics,
  trapezoidal yaw integration, and a static/blocked state when supported results are absent.
- Report tests require provenance, solver/input hashes when results exist, limitations,
  `UNVALIDATED_PHYSICALLY`, and `NOT_APPROVED` in exported artifacts.
- Browser acceptance verifies four named scene assemblies, report/diagram controls, evidence entry,
  and disabled engineering approval.

Still required: controlled MSKU Racing CAD and measurement inputs, independent four-corner motion
and dynamics comparisons with uncertainty, human review, authenticated revision control, and an
authorized approval/signature process. Adding an evidence record cannot satisfy those gates by
itself. See `PHASE_6_VERIFICATION_REPORT.md`.

