# Phase 4 engineering models

Updated: 2026-10-15

Solver: `linear_quarter_car_2dof`, version `4.0.0`

## Scope and status

Phase 4 implements one deliberately bounded transient model: a linear two-degree-of-freedom
quarter car with an imposed road displacement. It does not implement a full-car heave/pitch/roll
model or a planar bicycle handling model. Those models are reported as `NOT_COMPUTABLE`; the
application does not synthesize missing responses.

The implemented solver is `REFERENCE_BENCHMARKED` and can return `VERIFIED_NUMERICALLY` for an
individual run. It remains `UNVALIDATED_PHYSICALLY` and `NOT_APPROVED` until MSKU Racing supplies
traceable vehicle parameters and independent CAD, rig, or track measurements.

## Coordinates, units, and static equilibrium

All calculation inputs and outputs use SI units. Vertical displacement is positive upward. The
state vector is

```text
x = [z_s, v_s, z_u, v_u]^T
```

where `s` denotes the sprung mass and `u` the unsprung mass. `z_s` and `z_u` are perturbations from
the loaded static equilibrium, not absolute ride heights. Gravity, spring preload, and the static
tire deflection are therefore already removed by the coordinate transformation and must not be
added again to the dynamic equations.

The road coordinates are `z_r(t)` and `v_r(t)`. A positive road bump has positive `z_r`.

## Governing equations

The suspension force acting on the sprung mass is

```text
F_s = -k_s (z_s - z_u) - c_s (v_s - v_u)
```

The incremental tire force acting upward on the unsprung mass is

```text
F_t = k_t (z_r - z_u) + c_t (v_r - v_u)
```

and the equations integrated by the solver are

```text
m_s a_s = F_s
m_u a_u = -F_s + F_t
```

The returned suspension travel is `z_s - z_u`; tire compression is `z_r - z_u`. The force signs in
the API are forces on the named mass, not unsigned loads.

This is a linear, lumped, vertical model. The springs and dampers are massless, both masses are
rigid, and the tire is a linear element. Suspension geometry, motion-ratio variation, compliance,
friction, bump stops, aero, load-sensitive tire behavior, and thermal effects are excluded.

## Undamped natural frequencies

For free, undamped motion, the mass and stiffness matrices are

```text
M = [[m_s, 0], [0, m_u]]
K = [[k_s, -k_s], [-k_s, k_s + k_t]]
```

The eigenvalues `lambda = omega^2` satisfy

```text
m_s m_u lambda^2
  - [k_s m_u + m_s(k_s + k_t)] lambda
  + k_s k_t = 0
```

The API reports the two positive roots as `sqrt(lambda)/(2 pi)` in hertz. Tests calculate the
quadratic roots independently and exercise an exact single-mode cosine response.

## Road definitions

Road profiles are evaluated as displacement and velocity pairs:

- `step`: zero before `t0`, then constant amplitude. Its mathematical velocity is not represented;
  tire damping must be zero, and energy balance is deliberately not reported.
- `smooth_bump`: `A/2 [1 - cos(2 pi tau/T)]` for `0 <= tau <= T`. Displacement and velocity are
  zero at both ends.
- `half_sine`: `A sin(pi tau/T)` for `0 <= tau <= T`. Displacement is continuous, but the velocity
  changes discontinuously at the endpoints.
- `sine`: `A sin(2 pi f tau)` after `t0` with zero displacement before `t0`.
- `sampled`: piecewise-linear interpolation between strictly increasing absolute sample times,
  with endpoint displacement held constant outside the supplied interval and zero endpoint
  velocity.

The integrator is explicitly restarted at declared profile boundaries and sampled-data knots. This
keeps adaptive integration from stepping across known right-hand-side discontinuities as though
the input were smooth. State coordinates remain continuous at every restart.

## Integration and diagnostics

The implementation uses SciPy `solve_ivp` with selectable `DOP853`, `Radau`, or `BDF`. Users set
duration, output sample count, relative tolerance, absolute tolerance, and maximum internal step.
Implicit methods receive the constant analytical state Jacobian. Dense output is evaluated only
after the integration succeeds.

Every result records:

- solver success, finite-state acceptance, method, tolerances, and configured maximum step;
- function, Jacobian, and LU-decomposition counts;
- actual accepted internal step count and minimum/maximum accepted step;
- both natural frequencies;
- initial/final mechanical energy, road work, dissipated energy, energy residual, and relative
  energy error where the input is continuous enough for that diagnostic;
- minimum total normal contact force when a static tire load is supplied;
- solver version, input SHA-256, input classification, source label, warnings, assumptions, and
  independent numerical/reference/physical/approval states.

## Energy diagnostic

The reported mechanical energy is

```text
E = 1/2 m_s v_s^2 + 1/2 m_u v_u^2
  + 1/2 k_s (z_s-z_u)^2 + 1/2 k_t (z_u-z_r)^2
```

Damper dissipation and road-input power are

```text
P_d = c_s(v_s-v_u)^2 + c_t(v_u-v_r)^2
P_r = F_t v_r
```

For a continuous road input, the sampled-output quadrature checks

```text
R_E = E_final - E_initial - integral(P_r dt) + integral(P_d dt)
```

This diagnostic includes output-grid trapezoidal quadrature error and is not used as a claim of
physical validation. A relative residual above `1e-3` produces an explicit warning. It is omitted
for the ideal displacement step because the input contains an impulse-like event not represented
by the declared road velocity.

## Tire contact policy

The state equations use a bilateral linear tire. When the user supplies the loaded static tire
force `F_static`, the solver evaluates

```text
F_contact,total = F_static + F_t
```

at every requested output sample. If its minimum is below the numerical contact tolerance, the run
returns `FAILED` and all engineering samples are suppressed. No negative load is clipped. Separation,
flight, impact, and re-contact require a unilateral event/contact model and are not implemented.

If the static load is absent, incremental dynamics can still be numerically verified, but total
contact acceptance is unknown and the response carries
`TOTAL_CONTACT_FORCE_NOT_AVAILABLE_STATIC_TIRE_LOAD_MISSING`.

## Interface and export behavior

The Dynamics workspace exposes model parameters, all five road definitions, integrator controls,
source provenance, actual numerical diagnostics, time histories, and a Three.js schematic driven
only by returned samples. The visual displacement is deliberately scaled by a labeled factor; it
does not feed the calculation.

CSV export is enabled only for an accepted numerical run. The export is labeled unvalidated and
contains model/version, tolerances, quality states, source, input hash, warnings, assumptions, and
all samples. The exported `engineering_approval` remains `NOT_APPROVED`.

## References

- SciPy, [`solve_ivp` API reference](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html),
  for integration method behavior and tolerance/step controls.
- MIT OpenCourseWare, [two-degree-of-freedom modal dynamics](https://ocw.mit.edu/courses/2-003sc-engineering-dynamics-fall-2011/824e7e0b58a38fa3930e44603ba531e6_tm51lwadMOc.pdf),
  used as a general independent reference for the matrix eigenproblem and modal response form.

The project source and test equations remain the authoritative declaration of the implemented
model. External references do not validate the MSKU Racing vehicle.
