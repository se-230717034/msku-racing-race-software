# Phase 4 verification report

Report date: 2026-10-15

Solver version: `4.0.0`

Scope: linear 2DOF quarter-car transient dynamics only

## Conclusion

The implemented quarter-car equations, force signs, road functions, natural frequencies, and
time-domain integration pass the repository's analytical, cross-integrator, convergence,
passivity, contact, contract, API, and browser-flow checks. This supports the labels
`VERIFIED_NUMERICALLY` for accepted runs and `REFERENCE_BENCHMARKED` for this solver version.

It does **not** establish physical accuracy for an MSKU Racing car. No team CAD parameters, damper
dyno data, tire vertical-stiffness test, corner weights, shaker-rig trace, or instrumented road test
was supplied. Physical status therefore remains `UNVALIDATED_PHYSICALLY`; engineering approval is
`NOT_APPROVED`.

## Independent analytical references

### Undamped eigenvalues

Fixture:

```text
m_s = 250 kg       m_u = 40 kg
k_s = 20,000 N/m   k_t = 200,000 N/m
c_s = c_t = 0
```

The test forms `det(K - lambda M) = 0` directly and solves the quadratic independently of the
production natural-frequency function. Expected and computed modal frequencies are:

| Mode | Independent/actual frequency |
|---|---:|
| Sprung/body mode | 1.356369445435191 Hz |
| Unsprung/wheel-hop mode | 11.81115206525388 Hz |

The test comparison tolerance is `1e-14` relative.

### Exact single-mode cosine response

The same undamped fixture is initialized in the independently calculated low-mode eigenvector with
a 1 mm unsprung modal amplitude. For `q(t) = A cos(omega t)`, a two-period run produced:

| Quantity | Maximum absolute discrepancy |
|---|---:|
| Sprung displacement | `1.1894e-16 m` |
| Unsprung displacement | `3.9465e-17 m` |
| Relative energy-balance discrepancy | `3.1094e-15` |

These near-roundoff values are evidence for the equation implementation on this linear reference,
not a promise of zero error on general inputs.

### Proportional-damping modal decay

An independently written closed-form underdamped modal decay is compared with the numerical result
when `C = beta K`. The maximum sprung-displacement error is required to remain below `2e-11 m`.
This case exercises damping signs and velocity-state ordering without generating expected values
from the production solver.

### Static step limit

For an ideal 10 mm road step with zero tire damping, both masses must converge to the new 10 mm
base height in perturbation coordinates. After 8 s, both final displacements agree within `2e-6 m`.
Energy balance is intentionally suppressed for this discontinuous input.

## Numerical convergence and algorithm comparison

### Maximum-step refinement

A 20 mm, 0.15 s smooth raised-cosine bump was solved with identical tight tolerances using maximum
steps of 0.010 s and 0.002 s. The maximum sprung-displacement difference was
`4.00275e-12 m`. The 0.002 s run required 9,224 right-hand-side evaluations because integration is
also restarted at the road boundaries.

For the fine run, sampled-grid energy quadrature gave an absolute residual of `-0.0102588 J` and a
relative error of `2.82596e-4`. This is nonzero and is reported as such.

### Tolerance refinement

An 8 Hz, 10 mm sine input was solved at loose, refined, and tight tolerances while leaving the
maximum step deliberately large. Against the tight run:

| Run | Maximum sprung-displacement discrepancy |
|---|---:|
| Loose (`rtol=1e-4`, `atol=1e-6`) | approximately `2.33e-7 m` |
| Refined (`rtol=1e-7`, `atol=1e-9`) | approximately `4.32e-10 m` |

The refined solution is required to be closer than the loose solution and below `1e-8 m`.

### Cross-integrator reference

The nontrivial damped smooth-bump case is solved with explicit eighth-order `DOP853` and the
independent implicit `Radau` and `BDF` algorithms. Both sprung and unsprung displacement histories
from each implicit method must remain within `2e-9 m` of DOP853 on the common output grid. This
guards against an implementation that happens to agree only with one integration method.

### Step diagnostics

Each result exposes the configured maximum step and the actual count, minimum, and maximum of
accepted internal steps. Tests assert that the recorded accepted maximum does not exceed the user
limit (allowing floating-point roundoff).

## Road-function tests

- Raised-cosine and half-sine profiles reach the exact declared peak at mid-duration.
- Continuous sine displacement and velocity signs are checked at the origin.
- Sampled roads are checked at both endpoints and interior segments against hand-computed linear
  interpolation and slopes.
- Sample times must be finite, equal in count to displacements, and strictly increasing.
- Known discontinuities and sampled knots are integration boundaries.
- Ideal steps with nonzero tire damping fail because their road velocity is undefined.

## Conservation, passivity, and force signs

- An unforced damped response must have monotonically non-increasing mechanical energy on the
  requested output grid.
- A positive initial upward unsprung displacement with zero road input produces negative tire
  compression and negative incremental tire force, matching the declared upward-positive sign.
- Zero input and zero initial state remain exactly zero with the implicit Radau solver.
- All accelerations and force histories are recomputed from returned states and declared equations;
  there is no visual-only response path.

## Contact and invalid-result suppression

- When a deliberately low static tire load produces negative total normal force, status is
  `FAILED`, `contactAccepted` is false, minimum contact force is retained as a diagnostic, and the
  sample array is empty.
- Without static tire load, contact status is `null`, total-contact samples are `null`, and a
  warning is mandatory.
- Negative/zero masses or stiffnesses, negative damping, non-finite values, invalid tolerances,
  malformed road arrays, and unsupported step/tire-damping combinations produce explicit failed
  results rather than plausible-looking data.

## Interface, contract, and provenance verification

Python API tests verify an accepted smooth-bump response, its sample count, time span, road peak,
solver version, 64-character input hash, natural frequencies, contact status, and quality states.
Failure API tests verify complete output suppression after contact loss and malformed sampled data.

TypeScript contract tests require SI units, traceable provenance, orthogonal quality states,
nullable unavailable contact force, solver diagnostics, and finite sample values. The Chromium
workflow runs the live API simulation, confirms quality/approval labels and plots, moves the time
slider to a known calculated sample, and checks that unvalidated export is enabled only after a
verified run.

## Automated gate result

Completed-source gate results:

- Python: 77 tests passed.
- Vitest: 19 tests passed across 5 files.
- Chromium/Playwright: 3 workflows passed, including the live Phase 4 simulation.
- Ruff: passed.
- mypy: passed for the engineering and API source trees.
- ESLint: passed with zero warnings.
- TypeScript project build/type check: passed.
- Vite production build: passed. Rollup reported a non-blocking large-chunk advisory; no build error
  or missing module was present.

## Remaining risks and required physical evidence

1. The tire is bilateral and linear. Separation/re-contact, tire enveloping, hysteresis, and impact
   are absent; predicted contact loss terminates engineering output.
2. Suspension stiffness and damping act at the wheel in this model. Converting spring/damper data
   through a nonlinear motion ratio is not part of Phase 4.
3. Constant linear damping is not a substitute for a temperature- and velocity-dependent damper
   curve. No damper dyno evidence is attached.
4. Tire vertical stiffness and damping are not measured in the repository.
5. Quarter-car dynamics omit pitch, roll, left/right coupling, wheelbase time delay, anti-geometry,
   aero, steering, lateral/longitudinal tire forces, and nonlinear chassis behavior.
6. Energy integration uses the requested output grid, so its residual includes quadrature error and
   is a diagnostic rather than an acceptance proof.
7. A full-car model needs mass/inertia, four corner properties, axle distances, coupling and road
   timing definitions, and independent references. A bicycle model needs speed, axle geometry,
   yaw inertia, steering input, and defensible tire cornering behavior. These remain
   `NOT_COMPUTABLE` rather than being populated with guesses.

Before any real vehicle result can become physically validated, attach parameter provenance and
uncertainty, corner weights, tire and damper test data, and comparison traces from an independent
CAD/rig/track method. Document sensor calibration, sample rate, filtering, road input, test setup,
and acceptance thresholds.
