# Phase 2 engineering verification report

Date: 2026-10-15  
Solver: `rigid_upright_double_wishbone` version `2.5.0`  
Scope: Phase 2 rigid-link kinematics only

## Executive result

The Phase 2 implementation has been mathematically audited, strengthened, and
benchmarked against analytical and independently parameterized numerical references.
The calculation is **reference benchmarked** and each accepted runtime state is
**verified numerically** against its constraints. The synthetic demonstration vehicle
is **not physically validated**. No result in this release is approved for design
sign-off.

This report does not provide evidence of component strength, vehicle safety, tire
behavior, compliance, or correlation with the MSKU Racing car. Those require separate
CAD and physical measurement evidence.

## 1. Model and independently checked equations

Coordinates are right-handed: `+X` forward, `+Y` left, `+Z` up. Let `s = +1` for the
left corner and `s = -1` for the right corner. Lengths are metres and angles radians.

### 1.1 Rigid upright

The upper and lower ball joints, outer tie-rod joint, and wheel centre are one rigid
body. With static wheel centre `w0`, translation `t`, rotation vector `r`, and its
proper orthogonal rotation matrix `R(r)`, each moving point is

`p(r,t) = w0 + t + R(r)(p0 - w0)`.

This preserves all distances between upright-fixed points by construction because
`RᵀR = I` and `det(R) = +1`. The rotation vector is an exponential-map/axis-angle
representation: its direction is the rotation axis and its magnitude is the angle.

### 1.2 Link and travel constraints

For each of the four wishbone legs and the tie rod, with fixed inboard point `ai` and
moving outer point `bi`, the independently re-evaluated residual is

`fi(q) = ||bi(q) - ai|| - ||bi(0) - ai||`, for `i = 1..5`.

Prescribed vertical wheel travel `zreq` adds

`f6(q) = wheel_center_z(q) - (wheel_center_z(0) + zreq)`.

The six pose variables and six scalar constraints form a locally determinate system
only when the scaled constraint Jacobian has rank six. A zero residual alone is not
sufficient: redundant constraints and singular mechanisms are rejected.

### 1.3 Wheel axis, camber, and toe

The static outward wheel-axis unit vector is independently reduced to the closed form

`n0 = [sin(toe0) cos(camber0), s cos(toe0) cos(camber0), -sin(camber0)]`.

At a solved pose, `n = R n0`. The signed angles are

`camber = atan2(-nz, sqrt(nx² + ny²))`

`toe = atan2(nx, s ny)`.

Positive camber means the wheel top moves outward. Positive toe means toe-in on both
sides. An axis that becomes vertical has undefined toe; an axis that reverses across
the vehicle centre plane is rejected rather than reported as a valid result. Bump
steer is the wrapped angular difference `wrap(toe - toe0)`.

### 1.4 Caster, KPI/SAI, and track change

For kingpin vector `k = upper_ball_joint - lower_ball_joint`:

`caster = atan2(-kx, kz)`

`KPI = atan2(s (lower_y - upper_y), kz)`.

These signs produce positive caster when the upper joint is rearward and positive KPI
when it is inboard, for either corner. A horizontal or inverted kingpin is rejected.

Signed outward track change is

`track_change = s (wheel_center_y - static_wheel_center_y)`.

### 1.5 Camber gain and bump-steer gradient

Gradients are computed over wheel travel with second-order, nonuniform finite
differences where three or more adjacent accepted samples exist. Two-point blocks use
first order. Toe is unwrapped before differentiation. A failed point splits the data
into separate contiguous blocks, so a derivative is never taken across a failed
solution. One-sided and failure-adjacent gradients carry explicit warnings.

### 1.6 Geometric roll centre

The implemented roll centre is a front-view geometric construction, not the SAE
force-based roll centre. For a wishbone chassis pivot axis `a(λ) = af + λ(ar-af)`, its
virtual front-view inner point is evaluated at the ball-joint X plane:

`λ = (ball_x - af_x) / (ar_x - af_x)`.

This is valid for projected instantaneous motion because choosing the axis point at
the ball joint's X coordinate makes the projected ball-joint velocity perpendicular
to the projected line from that point to the ball joint. Intersecting the projected
upper and lower lines gives the corner instant centre.

For a rigid circular wheel with outward unit axis `n` and vertical unit vector `ez`,
the lowest point used as the contact reference is

`contact = wheel_center - radius (ez - (ez·n)n) / ||ez - (ez·n)n||`.

The line from this contact point to the instant centre is intersected with `y = 0`.
The reported height is relative to the current contact plane.

The value is deliberately suppressed when:

- a chassis pivot axis cannot stably intersect the corresponding ball-joint X plane;
- a projected arm has negligible length;
- projected upper and lower arm lines are parallel or numerically ill-conditioned;
- the rigid-wheel contact point or swing-arm centreline intersection is undefined.

The calculation assumes an exact mirrored opposite corner. It is unsupported for an
independently specified asymmetric axle, heave/roll combinations, compliant tires, or
force-based roll-centre claims.

## 2. Numerical acceptance and failure policy

SciPy trust-region least squares produces a candidate. Acceptance then uses checks
that are evaluated separately from the optimizer success flag:

1. the optimizer reports success;
2. all candidate values and independently recomputed residuals are finite;
3. maximum absolute physical residual is at or below the configured tolerance
   (default `1e-8 m`);
4. a central-difference, dimensionless Jacobian has relative rank six;
5. its condition number is at or below `1e10`;
6. continuation translation and relative-rotation jumps stay below configured limits.

Translation variables are scaled by the larger of wheel radius and constrained-link
length; residuals use the same scale. This removes the previous dimensional ambiguity
from comparing metre and radian columns directly. The maximum accepted sweep spacing
is `0.025 m`. Each positive and negative branch starts from a separately accepted
static pose. Continuation stops after the first failed or discontinuous state.

A failed state has no pose and no engineering metrics. The UI will not animate it,
and CSV export is disabled for any incomplete or failed sweep.

## 3. Independent benchmarks and quantitative results

All fixtures are synthetic and are not MSKU Racing vehicle data.

### 3.1 Closed-form parallel-arm benchmark

For parallel `0.5 m` arms and `0.05 m` vertical travel, the independent solution is

`lateral_translation = sqrt(0.5² - 0.05²) - 0.5`

Expected: `-0.0025062814466900174 m`.  
Actual: `-0.0025062814466899138 m`.  
Absolute discrepancy: `1.04e-16 m`.

The rotation-vector magnitude discrepancy from the expected zero rotation was
`7.48e-18 rad`; camber-change discrepancy was `1.57e-18 rad`; bump-steer discrepancy
was below displayed floating-point resolution. These are numerical round-off results,
not proof of physical accuracy.

### 3.2 Unequal-length, asymmetric 3D benchmark

The production solver was cross-checked at `+0.04 m` using an alternative reference:

- five variables (`tx`, `ty`, and XYZ Euler angles), with `tz` prescribed directly;
- squared-distance constraints normalized by squared static link length;
- MINPACK hybrid root finding instead of trust-region least squares;
- continuation in `0.005 m` increments.

Reference translation was
`[-0.003953361355818703, 0.001515254873234765, 0.04] m`.
Reference camber was `0.018977158960773274 rad`; reference toe was
`-0.04660984503743871 rad`.

Maximum moving-point component discrepancy was `1.11e-16 m`; camber discrepancy was
`3.37e-16 rad`; toe discrepancy was `3.19e-16 rad`. Both implementations still use
floating-point arithmetic and SciPy, so this is an independently parameterized and
formulated reference, not an independent commercial-tool validation.

### 3.3 Travel step-size convergence

Central gradients at static were compared with a 161-point sweep over `-0.05..+0.05 m`:

| Points | Camber gain rad/m | Error vs 161 | Bump-steer gradient rad/m | Error vs 161 |
|---:|---:|---:|---:|---:|
| 21 | 0.5378227893 | 1.10e-4 | -1.1994634823 | 2.43e-4 |
| 41 | 0.5377389346 | 2.62e-5 | -1.1992782692 | 5.79e-5 |
| 81 | 0.5377179772 | 5.24e-6 | -1.1992319830 | 1.16e-5 |
| 161 reference | 0.5377127382 | — | -1.1992204125 | — |

Errors decreased by more than `3.5×` at each listed refinement, consistent with the
expected second-order central-difference trend at the tested point. The 161-point
value is a refinement reference, not an exact derivative.

### 3.4 Hardpoint perturbation sensitivity

Twelve deterministic trials independently perturbed every hardpoint coordinate with
a uniform value in `[-0.2, +0.2] mm`, using seed `230717034`. All 13-point sweeps over
`-0.03..+0.03 m` remained numerically accepted with no continuity rejection.
At `+0.03 m`, maximum absolute changes from the unperturbed synthetic model were:

- camber: `1.177e-4 rad` (`0.00675 deg`);
- toe: `2.869e-4 rad` (`0.01644 deg`);
- geometric roll-centre height: `0.970 mm`.

These values describe local sensitivity of one synthetic fixture. They are not a
tolerance allocation and must not be generalized to the real vehicle.

### 3.5 Additional regression coverage

- two additional unequal-length, asymmetric plausible synthetic layouts over
  `-0.04..+0.04 m`;
- left/right mirroring and nonzero static camber/toe;
- closed-form caster and KPI signs;
- closed-form front-view roll-centre construction;
- rigid-link preservation and zero-travel identity;
- geometric similarity/unit consistency;
- singular redundant constraints despite zero residual;
- optimizer failure with separately reported residuals;
- excessive travel spacing, unreachable travel, and forced continuity rejection;
- suppression of unsupported roll-centre geometry;
- API serialization, provenance, quality states, and export blocking.

## 4. Quality states and export safety

The runtime exposes separate dimensions instead of one ambiguous `validated` flag:

- `VERIFIED_NUMERICALLY`: every requested state passed residual, rank, condition,
  finite-value, and continuity checks;
- `REFERENCE_BENCHMARKED`: solver version `2.5.0` has the documented automated
  analytical and alternative-formulation benchmark suite;
- `UNVALIDATED_PHYSICALLY`: no accepted CAD motion study or physical measurement
  evidence is attached;
- `FAILED`: at least one requested state is failed, unreliable, or unattempted.

Engineering approval remains `NOT_APPROVED`. Exports include solver name/version,
tolerances, quality states, units, warnings, declared input classification/status, and
a SHA-256 hash of the canonical project input. Failed sweeps cannot be exported.

A project file claiming `benchmarked` or `experimentally_validated` does not override
the calculated physical status. Changing physical status requires independently
reviewed evidence, reference configuration, uncertainty, and traceable input hashes.

## 5. Remaining risks and mandatory external gate

The following remain unproven:

- correlation with the MSKU Racing CAD assembly or measured suspension motion;
- hardpoint measurement uncertainty for the actual car;
- independently specified left/right axle geometry and roll/heave coupling;
- tire deformation and true contact-patch migration;
- steering-rack travel, compliance, joint clearance, travel stops, and collisions;
- force-based roll centre, loads, strength, fatigue, and vehicle dynamics;
- independence from the SciPy numerical stack in the alternative reference test.

Before a real model can be marked physically validated, archive at minimum:

1. signed-off hardpoint source and coordinate-datum definition;
2. CAD motion-study or independent solver version/configuration and raw outputs;
3. physical measurement method, calibration, uncertainty, and raw data;
4. comparison tolerances selected before evaluating agreement;
5. project-input hash and this solver version;
6. reviewer and approval record.

## 6. Technical references

- SciPy `least_squares` documentation: <https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.least_squares.html>
- SciPy 3D rotation documentation: <https://docs.scipy.org/doc/scipy/reference/generated/scipy.spatial.transform.Rotation.html>
- Cherian, Jalili, and Ayglon, *Modelling, simulation, and experimental verification of
  the kinematics and dynamics of a double wishbone suspension configuration*:
  <https://journals.sagepub.com/doi/10.1243/09544070JAUTO1153>
- Chalmers University, *Development of Kinematic Analysis* (planar four-bar and roll
  centre reference): <https://odr.chalmers.se/bitstream/20.500.12380/256289/1/256289.pdf>

External references support the model class and numerical representation; the
quantitative verification evidence in this report is generated by the repository's
reproducible automated tests.

## 7. Verification execution record

Executed on 2026-10-15:

- Ruff: passed;
- mypy: passed for six source files;
- pytest: 39 passed;
- ESLint: passed with zero warnings;
- TypeScript project check: passed;
- Vitest: 13 passed across three files;
- Vite production build: passed;
- Playwright Chromium acceptance flow: 1 passed.

The production build continues to report a non-fatal bundle-size warning for the main
web chunk. This is a delivery-performance concern, not evidence about engineering
calculation validity.
