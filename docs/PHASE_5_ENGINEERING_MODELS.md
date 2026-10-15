# Phase 5 engineering models

Updated: 2026-10-15

This document defines the Phase 5 dynamics-completion models. All coordinates use the right-handed vehicle frame `+X` forward, `+Y` left, `+Z` upward. Inputs and solver states are SI. These models are numerically verified and reference benchmarked; neither has been correlated with MSKU Racing CAD, rig, or track measurements. Their physical state is therefore `UNVALIDATED_PHYSICALLY` and engineering approval is `NOT_APPROVED`.

## Linear full-car ride model

The generalized coordinate vector is

`q = [z_s, theta, phi, z_uFL, z_uFR, z_uRL, z_uRR]^T`,

where `z_s` is sprung-body heave, `theta` is pitch about `+Y` (positive moves the front downward), and `phi` is roll about `+X` (positive moves the left side upward). For corner `i` at body position `(x_i, y_i)`, the small-angle body displacement is

`z_bi = z_s - x_i theta + y_i phi`.

The suspension and tire deflections are `d_si = z_bi - z_ui` and `d_ti = z_ui - z_ri`. Defining a corner deformation vector

`g_i = [1, -x_i, y_i, 0 ... -1_i ... 0]^T`,

the matrices are assembled, rather than hard-coded, as

`M = diag(m_s, I_pitch, I_roll, m_uFL, ..., m_uRR)`,

`C = sum(c_si g_i g_i^T) + diag(0,0,0,c_tFL,...,c_tRR)`,

`K = sum(k_si g_i g_i^T) + diag(0,0,0,k_tFL,...,k_tRR)`.

The solved equation is

`M q_ddot + C q_dot + K q = f_r(t)`,

with `f_r[3+i] = k_ti z_ri + c_ti z_ri_dot`. Four road profiles are independent. The production solver supports DOP853, Radau, and BDF; implicit methods receive the analytical first-order state matrix. Natural frequencies come from the generalized symmetric eigenproblem `K v = omega^2 M v`.

The reported mechanical energy is `0.5 q_dot^T M q_dot + 0.5 q^T K q`. Damper dissipation and road-input power are integrated to report an energy-balance residual. When all four static tire loads are supplied, total contact load is `F0_i + k_ti(z_ri-z_ui) + c_ti(z_ri_dot-z_ui_dot)`. Any non-positive load rejects the calculation and suppresses engineering samples because lift-off, impact, and re-contact are outside this bilateral linear model.

Limitations include small body angles, linear springs/dampers/tires, fixed corner locations, no suspension kinematic coupling, no chassis or suspension compliance, no bump stops, no tire enveloping, and no impact/re-contact dynamics.

## Linear planar bicycle model

The two states are lateral velocity at the centre of gravity `v_y` and yaw rate `r`, at a constant positive longitudinal speed `U`. Positive steering, lateral force, and yaw turn left. With CG-to-axle distances `a` and `b`, the small-angle slip definitions are

`alpha_f = delta - (v_y + a r)/U`,

`alpha_r = -(v_y - b r)/U`,

and the axle forces are `F_yf = C_f alpha_f`, `F_yr = C_r alpha_r`. Newton-Euler balance is

`m(v_y_dot + U r) = F_yf + F_yr`,

`I_z r_dot = a F_yf - b F_yr`.

Therefore `x_dot = A x + B delta`, `x=[v_y,r]^T`, with

`A11 = -(C_f+C_r)/(mU)`,

`A12 = (bC_r-aC_f)/(mU) - U`,

`A21 = (bC_r-aC_f)/(I_z U)`,

`A22 = -(a^2 C_f+b^2 C_r)/(I_z U)`,

`B = [C_f/m, aC_f/I_z]^T`.

The implementation reports eigenvalue stability and the steady-state gains

`r/delta = U / [L + (mU^2/L)(b/C_f-a/C_r)]`,

`beta/delta = b(r/delta)/U - maU(r/delta)/(L C_r)`,

where `L=a+b` and `beta=v_y/U`. Understeer coefficient is `K = (m/L)(b/C_f-a/C_r)`. Positive `K` gives characteristic speed `sqrt(L/K)`; negative `K` gives critical speed `sqrt(-L/K)`.

The request carries explicit steering, sideslip, and tire-slip limits. Exceeding any limit returns `FAILED` and no engineering samples. This is a model-domain guard, not evidence that all states inside the bounds reproduce a real tire.

Limitations include constant speed, small angles, linear axle cornering stiffness, no load transfer, roll, combined slip, relaxation length, saturation, aerodynamic forces, steering-system dynamics, or road bank.

## Traceability and use

Both endpoints return model and solver version, an SHA-256 of the submitted input, source classification/label, units, assumptions, warnings, integration settings, and numerical diagnostics. A numerical success does not change physical-validation or approval state. Demonstration presets must never be represented as MSKU Racing vehicle data.

Endpoints:

- `POST /api/v1/dynamics/full-car/simulate`
- `POST /api/v1/dynamics/bicycle/simulate`

## Deterministic engineering optimization

The optimization engine is separated from model evaluation. A model adapter returns a metric map plus a feasibility state; a failed, singular, non-finite, nonconverged, out-of-domain, unstable, contact-losing, or constraint-violating evaluation has no numeric objective value. The search uses an internal large rejection penalty only to guide SciPy; rejected points are never returned as engineering candidates.

For objective `j`, the normalized loss is

`l_j = m_j / n_j` for minimization, or `l_j = |m_j-t_j| / n_j` for target control,

where normalization `n_j` must be explicit, finite, and positive. The scalar objective is `sum(w_j l_j)` with positive explicit weights. This prevents unlike SI quantities from being combined implicitly.

Bounded search uses serial SciPy differential evolution with a recorded integer seed, declared generation/population/tolerance settings, and polishing disabled. The declared convergence tolerance is passed as both SciPy's relative and absolute population-energy tolerance so near-zero target losses have a finite, explicit stopping scale. The baseline must itself be feasible. A reported optimum requires SciPy convergence and a final independent feasible evaluation. The result includes evaluation/rejection counts, convergence history, baseline comparison, and an input SHA-256.

Pareto exploration repeats the bounded search with reproducible weighted sums. Two-objective weights are evenly spaced from `(0,1)` to `(1,0)`; higher-dimensional weights include each single-objective extreme and seeded Dirichlet weights. Duplicate and dominated feasible candidates are removed. Weighted sums can miss unsupported regions of a non-convex front, so the returned set is an exploration, not proof of the complete Pareto frontier.

Local sensitivities use a bounded central finite difference at the selected optimum, falling back to one-sided differences at a bound. A failed neighboring model evaluation produces an unavailable derivative, never zero.

Implemented adapters and metrics:

- Kinematics variables: selected `hardpoints.<id>.<x|y|z>` coordinates. Metrics: bump-steer RMS, camber-change RMS, roll-centre migration RMS only when every state supports roll centre, and maximum absolute track change.
- Quarter car variables: effective suspension/tire stiffness and damping. Metrics: sprung acceleration RMS and maximum absolute suspension travel.
- Full car variables: per-corner unsprung mass and suspension/tire stiffness or damping. Metrics: body-heave acceleration RMS, maximum absolute suspension travel, pitch, and roll.
- Bicycle variables: front/rear axle cornering stiffness and speed. Metrics: final yaw rate, maximum sideslip, lateral-acceleration RMS, and final lateral acceleration.

Constraints are applied in SI. Kinematics requires valid geometry, minimum link length, requested travel limit, and a fully converged sweep. Ride optimization can require verified wheel contact and a travel limit. Bicycle optimization can require stable eigenvalues and always requires the production model's steering/sideslip/tire-slip domain gate. Unsupported objective or variable identifiers are rejected at the API boundary.

The Optimization workspace previews candidate hardpoints with a temporary overlay. Preview does not mutate the active project. Applying a candidate requires the explicit apply button and does not change its physical-validation or engineering-approval state.

Endpoint: `POST /api/v1/optimization/run`.

