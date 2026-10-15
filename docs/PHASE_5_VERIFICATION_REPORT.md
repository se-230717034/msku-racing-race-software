# Phase 5 verification report

Updated: 2026-10-15

## Scope and status

This report covers solver versions `5.0.0`: the linear 7DOF full-car ride model, linear planar bicycle model, and deterministic engineering optimization framework. The results below verify software equations and numerical behavior on synthetic fixtures. They do not validate an MSKU Racing vehicle. Runtime physical status remains `UNVALIDATED_PHYSICALLY`; approval remains `NOT_APPROVED`.

The full-car formulation follows the standard seven-coordinate heave/pitch/roll plus four-unsprung structure described in independent vehicle-dynamics literature. The bicycle state matrix was derived independently from Newton-Euler force and yaw-moment balance and cross-checked against the form documented in Stanford's vehicle state-estimation thesis. Numerical integration uses SciPy `solve_ivp`; bounded global search uses SciPy `differential_evolution` with recorded seeds.

Primary references:

- SciPy `solve_ivp`: <https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html>
- SciPy differential evolution: <https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.differential_evolution.html>
- J. Ryu, *State and Parameter Estimation for Vehicle Dynamics Control Using GPS*: <https://ddl.stanford.edu/sites/g/files/sbiybj25996/files/media/file/2004_thesis_ryu_state_and_parameter_estimation_for_vehicle_0.pdf>

## Full-car independent benchmarks

The production matrix assembly was compared element-by-element with an independent outer-product assembly in the test module. Mass, damping, and stiffness matrices agreed within `2e-11` absolute tolerance; symmetry agreed within `1e-12`. The seven returned natural frequencies agreed with an independent generalized `eigh(K,M)` calculation to `1e-13` relative tolerance.

An undamped eigenmode was initialized and compared at every requested sample with the exact `q(t)=v cos(omega t)` solution. In the final verification run:

- maximum absolute state error: `7.508100044462118e-17`;
- relative energy-balance error: `8.431345119434786e-16`.

A symmetric four-corner heave case was independently reduced to one quarter-car with one fourth of the sprung mass. Maximum heave discrepancy was `3.577867169202165e-18 m`; the regression gates also require wheel displacement discrepancy below `2e-11 m` and residual pitch/roll below `1e-13 rad`.

An asymmetric four-road case compares DOP853 and Radau and requires body-heave agreement below `2e-9 m`. Separate front-only and left-only excitations verify the documented pitch and roll signs. A prescribed initial state producing negative total load at one corner returns `FAILED`, records `front_left`, and suppresses all samples.

## Bicycle independent benchmarks

Every state-matrix and input-vector coefficient is assembled independently in the test and compared within `1e-14`. A neutral-steer step is compared with the independent steady gains; the final yaw rate must agree within `1e-8` relative error and sideslip within `1e-10 rad` absolute error.

For an asymmetric cornering-stiffness step, every transient sample is compared with

`x(t) = A^-1 [exp(A t)-I] B delta`.

The final verification run produced maximum absolute state discrepancy `4.926614671774132e-16`. DOP853, Radau, and BDF yaw histories are required to agree within `2e-8 rad/s` on a sine input. Positive steer sign tests require positive front force, yaw rate, and lateral acceleration. High-speed oversteer reports the unstable eigenvalue state; speed below `0.5 m/s` and any configured linear-angle-limit violation return `FAILED` with no samples.

## Optimization independent benchmarks

The following cases do not use a production vehicle model to generate expected values:

1. The bounded quadratic `(x-2)^2 + 3(y+1)^2` has analytical minimum `(2,-1)`. With seed `2307`, the final run returned coordinate errors `0.0` and `0.0` in binary floating output and normalized weighted objective `0.0`. Regression tolerance is `2e-5` per coordinate; exact reproduction is not guaranteed for other SciPy versions or settings.
2. Explicit normalization is verified with `2/2 (x-1)^2 + 1/0.5 (x+1)^2`, whose independently derived minimum is `x=-1/3`; the solver must agree within `2e-5`.
3. A two-objective `x^2` versus `(1-x)^2` fixture verifies reproducible seeded points and pairwise nondominance after filtering.
4. An intentionally better-looking but infeasible half-domain verifies that failed evaluations are counted and cannot become the reported optimum.
5. A target metric `x^2=4` on positive bounds verifies the target transformation and central finite-difference derivative `d(x^2)/dx=4` to `2e-4` relative tolerance.
6. Infeasible baselines and non-finite metrics fail closed with no optimized candidate.

Model-adapter tests execute real kinematics, quarter-car, full-car, and bicycle baseline evaluations. The hardpoint adapter separately verifies minimum-link rejection. API tests verify seeded optimization, bounds, candidate improvement, provenance hash, physical/approval status, and unsupported-objective rejection. TypeScript contracts reject reversed bounds and invalid one-objective Pareto requests. The Chromium flow runs a real bicycle optimization and checks quality and comparison panels.

## Safety behavior

- Only objective identifiers listed by the selected verified adapter are accepted.
- Baseline infeasibility stops the run.
- Model failure, missing metric, non-finite value, singular geometry, failed kinematics continuation, unsupported roll centre, contact loss, travel-limit violation, unstable handling when required, and linear-domain violation are infeasible evaluations.
- SciPy nonconvergence returns `FAILED`; a best-so-far point is not promoted to an engineering candidate.
- Candidate preview is non-mutating. Apply is explicit and retains unvalidated status.
- All responses include solver version, seed, settings, input SHA-256, source classification, warnings, quality state, evaluation counts, and rejected-evaluation counts.

## Remaining risks

- Differential evolution and weighted-sum Pareto sampling do not prove a global optimum or a complete non-convex front. Re-run with larger budgets and independent methods before relying on a design trend.
- Sensitivity is local, finite-difference, and step-dependent. Discontinuous active constraints can make it unavailable or misleading.
- Kinematics optimization is based on the rigid-link model and inherits its branch, packaging, collision, compliance, and physical-validation limitations.
- Ride objectives inherit linear bilateral-tire and effective-wheel-rate assumptions. Contact rejection does not model lift-off or re-contact.
- Bicycle objectives inherit constant-speed, small-angle, linear-cornering-stiffness assumptions. Synthetic stiffness values are not tire data.
- No candidate has been compared with MSKU Racing CAD, a kinematics rig, damper dyno, tire data, or track measurements.

The repository must not mark a vehicle model physically validated or engineering-approved without independent evidence and uncertainty review.

## Final gate record

The final local gate on 2026-10-15 completed with 108 Python tests, 25 Vitest tests, and 5 Chromium end-to-end tests passing. Ruff, mypy, ESLint, TypeScript checking, and the Vite production build also passed. Vite reported a non-fatal bundle-size advisory; it did not report a build failure.
