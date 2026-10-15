# Physics models

## Phase 1 model: static geometric definition

The current application is a geometry editor, not a kinematics or force solver. It stores 3D points and renders straight rigid-link references for a front-left double-wishbone corner:

- two upper wishbone legs sharing an outboard joint
- two lower wishbone legs sharing an outboard joint
- one steering tie rod
- one upright reference between upper and lower outboard joints
- one wheel-centre reference to the upright

For a link between points `a` and `b`, the displayed static length is:

`L = sqrt((bx-ax)^2 + (by-ay)^2 + (bz-az)^2)`

The current diagnostics verify non-degenerate points/links, basic left-corner ordering, upright ordering, and physically positive wheel dimensions. These checks do not prove that a moving mechanism is correctly constrained.

## Assumptions

- Links are represented by their centre lines.
- Joints are ideal points; bearing offsets, bushing compliance, and manufacturing tolerances are absent.
- The sample corner is front-left in the documented vehicle frame.
- The torus is a wheel/tire envelope only and has no contact or tire model.

## Phase 2 model: rigid-link suspension kinematics

The upright, upper/lower ball joints, tie-rod outer joint, and wheel centre move as one rigid body. Its pose is parameterized by translation `t ∈ R³` and an exponential-map rotation vector `r ∈ R³`. For each static upright point `p₀`, with static wheel centre `w₀`:

`p(q) = w₀ + t + R(r)(p₀ - w₀)`

Six nonlinear residual equations solve the six pose unknowns:

1. upper-front link current length minus static length
2. upper-rear link current length minus static length
3. lower-front link current length minus static length
4. lower-rear link current length minus static length
5. tie-rod current length minus static length
6. wheel-centre Z minus requested Z

SciPy's trust-region nonlinear least-squares solver proposes a candidate. Each bump/rebound branch begins at an accepted static pose and uses the previous accepted solution as its next initial estimate. Acceptance independently recomputes physical residuals, then checks optimizer success, finite values, residual tolerance, full rank and condition of a central-difference dimensionless 6×6 Jacobian, and pose continuity. Failed and unattempted continuation points are returned explicitly without a pose or metrics. Travel spacing above `0.025 m` is rejected because it is outside the tested continuation envelope.

## Derived alignment and geometry

- Static camber and toe are explicit wheel-reference inputs; the demo values are zero.
- Positive camber means wheel top outward. Positive toe means toe-in on either side.
- Current camber and toe come from the solved rigid rotation applied to the configured wheel axis.
- Camber gain and bump-steer gradient are finite-difference derivatives over contiguous accepted wheel-travel states, reported internally in `rad/m`. Toe is unwrapped; derivatives never bridge a failed state.
- Caster and KPI/SAI come from the current lower-to-upper ball-joint kingpin axis.
- Track change is signed outward wheel-centre displacement.
- The front-view instant centre intersects projected upper/lower control-arm instantaneous-motion lines. Each virtual inner point is where its 3D chassis pivot axis meets the corresponding ball-joint X plane.
- Roll-centre height intersects the rigid-circular-wheel contact-point-to-instant-centre line with the vehicle centre plane. It assumes a mirrored symmetric opposite corner and is referenced to the current contact plane. Unsupported pivot axes and parallel, degenerate, or ill-conditioned projections return no roll-centre value.

## Phase 2 validity and failure cases

The solver is tested against a closed-form equal-length parallel-arm translation, an unequal-length asymmetric alternate-formulation reference, zero-motion identity, rigid-length residuals, left/right mirror symmetry, nonzero alignment, step-size convergence, deterministic hardpoint perturbations, unit similarity, singular constraints, optimizer failure, continuity rejection, and unreachable travel. See `PHASE_2_VERIFICATION_REPORT.md` for equations and discrepancies.

Quality has three independent dimensions: an accepted sweep is `VERIFIED_NUMERICALLY`; solver version `2.5.0` is `REFERENCE_BENCHMARKED`; the vehicle model remains `UNVALIDATED_PHYSICALLY`. Any rejected state makes the sweep `FAILED`. None of these states constitutes engineering approval.

The software implementation has analytical benchmark evidence, but the demonstration vehicle geometry remains `unvalidated` because no MSKU Racing CAD motion study or physical measurement was provided.

## Phase 3 model: quasi-static loads and actuation

The Phase 3 force solver assembles current-geometry two-force-member wrench columns and enforces all
three force and three moment equations. It qualifies the dimensionless matrix by SVD, rejects
nonunique or ill-conditioned paths, and independently checks N and N·m residuals. A five-link corner
only accepts compatible wrenches; no missing actuation reaction is invented.

Separate models provide steady rigid-body static/longitudinal load transfer, stiffness-distributed
lateral transfer, and sampled-geometry spring motion ratio/energy/wheel rate. Damper force requires
explicit velocity. See `PHASE_3_ENGINEERING_MODELS.md` for equations, signs, and boundaries.

## Not yet implemented

There is no steering-rack sweep, integrated rocker kinematic closure, compliance, structural stress,
tyre constitutive model, road response, or transient dynamics. Unsupported quantities return no
placeholder value.

