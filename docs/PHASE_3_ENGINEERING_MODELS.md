# Phase 3 engineering models

Status: implemented in solver version `3.0.0` on 2026-10-15. The equations are
numerically verified and repository-reference benchmarked. They are not physically validated for
an MSKU Racing vehicle and are never marked approved.

## Scope and boundary

Phase 3 is a quasi-static layer. It consumes an accepted Phase 2 rigid-upright pose and computes a
force equilibrium at that frozen geometry. It also provides separately identified vehicle load
transfer and sampled actuation models. It does not integrate time and is not a vehicle-dynamics,
component-stress, fatigue, buckling, tyre, or safety model.

The reference frame remains right-handed: `+X` forward, `+Y` left, and `+Z` up. All calculations
use SI. Positive axial member force is tension; negative is compression. Positive longitudinal
acceleration is forward and transfers load rearward. Positive lateral acceleration is to the left
and loads the right-side wheels. Positive wheel travel is bump. Positive spring velocity is
compression.

The rigid-body equations follow the standard six scalar static equilibrium equations documented
in [MIT OpenCourseWare's static-equilibrium chapter](https://ocw.mit.edu/courses/1-050-solid-mechanics-fall-2004/4a78b7668ad961549681ce0e42f95b66_emech2_04.pdf).

## Rigid-upright force equilibrium

### Ideal member model

Each UCA leg, LCA leg, tie rod, and optional actuation member is an ideal pin-jointed two-force
member. For member `i`, let `p_i` be its upright joint and `c_i` its chassis/rocker joint in the
current solved geometry. Its unit direction, positive for tension force on the upright, is:

`u_i = (c_i - p_i) / ||c_i - p_i||`

With moment reference `o`, one scalar unknown `q_i` contributes the wrench:

`a_i = [u_i ; (p_i - o) × u_i]`

The external contact wrench is declared as force `F`, free moment `M`, and application point `p_F`.
Its moment about `o` is:

`M_o = M + (p_F - o) × F`

The assembled equilibrium is:

`A q = -b`, where `A = [a_1 ... a_n]` and `b = [F ; M_o]`.

The API uses the solved wheel centre as `o`; changing the reference point does not change a valid
member-force solution when the external wrench is transformed consistently. Chassis pickup
reaction reported for a member is the negative of that member's force on the upright.

### Numerical qualification

Force rows have unit N and moment rows have unit N·m. Rank and condition are therefore evaluated on
a dimensionless matrix whose moment rows are divided by a characteristic suspension length. SVD
uses a relative singular-value threshold of `1e-10` by default. The default condition-number limit
is `1e10`. The least-squares candidate is accepted only after the original physical equations are
re-evaluated independently with default residual limits of `1e-6 N` and `1e-6 N·m`.

This implements the same effective-rank and singular-value condition concepts described by the
[SciPy least-squares documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.linalg.lstsq.html),
but acceptance is deliberately based on separately evaluated physical residuals.

Outcomes are:

- `VERIFIED_NUMERICALLY`: every unknown is unique and both physical residual limits pass;
- `NOT_COMPUTABLE`: the declared wrench is outside the available member-wrench span, there are more
  than six unknown axial members without a stiffness model, or required inputs are absent;
- `FAILED`: invalid/degenerate members, deficient rank, ill-conditioning, or nonphysical inputs.

Five suspension links can have full column rank and uniquely balance compatible wrenches, but they
cannot span arbitrary six-component contact wrenches. The solver never invents a sixth reaction.
An optional sixth member must have explicitly supplied current endpoints. More than six axial-force
unknowns are statically indeterminate and require a compliance/stiffness model that Phase 3 does not
provide.

These ideal axial loads are not wishbone tube stresses, joint loads, bearing loads, fastener loads,
buckling margins, or fatigue results.

## Actuation, spring, and damper

The project schema can store explicit pushrod/pullrod, rocker pivot and attachments, spring chassis
pickup, spring free length/rate/preload, and optional damper coefficients. Legacy projects remain
valid because actuation geometry is optional. No bundled mounting coordinate is presented as real
vehicle data.

The supported calculation consumes wheel-travel samples `z_j` and corresponding spring lengths
`l_j` from declared CAD, an external mechanism solve, or measurement. Reference spring length is
`l_0`; compression is:

`x_j = l_0 - l_j`

The motion-ratio convention is:

`MR = dx/dz` = spring compression per positive wheel bump.

The implementation uses second-order finite differences on the supplied, strictly increasing
travel coordinates, including nonuniform spacing. The method and its boundary treatment follow the
[NumPy gradient documentation](https://numpy.org/doc/stable/reference/generated/numpy.gradient.html).

For a linear spring of rate `k` and preload `F_0`:

`F_s = F_0 + k x`

`E_s = F_0 x + 1/2 k x²`

`Q_z = -dE_s/dz = -F_s MR`

The reported positive tangent wheel-rate magnitude is:

`K_w = d(dE_s/dz)/dz = k MR² + F_s d(MR)/dz`

For constant motion ratio this reduces to `k MR²`. A compression-only spring state that would
require tensile spring force is suppressed as `NOT_COMPUTABLE`.

Damper force is calculated only when compression velocity `v` is explicitly supplied:

`F_d = -c_c v` for `v >= 0`; `F_d = -c_r v` for `v < 0`.

The coefficients are declared in N·s/m. Static travel alone never creates a damper force.

The integrated rocker-closure solve is not yet supported. Consequently the application does not
derive the spring-length series from stored rocker coordinates. Incomplete actuation geometry must
remain `NOT_COMPUTABLE`; supplied spring-length samples must retain CAD/measurement provenance.

## Simplified vehicle load transfer

This model assumes a rigid vehicle on flat ground under steady acceleration, with one CG, ideal
point tyre contacts, no aerodynamic load, no unsprung mass, no suspension geometric jacking, and no
compliance. Let mass be `m`, gravity `g`, wheelbase `L`, CG distance from the front axle `a`, and CG
height `h`.

Static axle normal loads are:

`W_f0 = m g (L-a)/L`

`W_r0 = m g a/L`

For forward longitudinal acceleration `a_x`:

`ΔW_x = m a_x h/L`

`W_f = W_f0 - ΔW_x`; `W_r = W_r0 + ΔW_x`.

Negative `a_x` is braking and moves load forward. Axle loads must sum to `mg` within numerical
roundoff.

Detailed lateral front/rear distribution is computed only when positive front and rear roll
stiffnesses `K_f` and `K_r` are explicitly present. With lateral acceleration `a_y`, the elastic
roll-moment fractions and outside-wheel increments are:

`λ_f = K_f/(K_f+K_r)`

`δ_f = λ_f m a_y h/t_f`

`δ_r = (1-λ_f) m a_y h/t_r`

For positive `a_y`, `Fz_FL = W_f/2 - δ_f`, `Fz_FR = W_f/2 + δ_f`, with the same left/right pattern
at the rear. Thus the right-minus-left difference at an axle is `2δ`. If either stiffness is absent,
nonzero lateral acceleration returns axle loads but suppresses wheel loads as `NOT_COMPUTABLE`.

Negative axle or wheel normal load is a failed model state and is not emitted as an accepted wheel
load. Zero load is retained with a wheel-unloaded warning.

## Contracts, provenance, and exports

Endpoints:

- `POST /api/v1/quasi-static/upright-equilibrium`
- `POST /api/v1/quasi-static/load-transfer`
- `POST /api/v1/quasi-static/actuation-series`
- `POST /api/v1/quasi-static/damper-force`

Responses include SI units, solver version, warnings, diagnostics, and the numerical/reference/
physical status dimensions. Upright results additionally include the project SHA-256 and exact
accepted Phase 2 pose. Approved-engineering export is disabled because physical validation evidence
is not attached. No Phase 3 endpoint can promote project metadata into physical validation.

