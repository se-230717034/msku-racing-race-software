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

SciPy's trust-region nonlinear least-squares solver evaluates these constraints. Each bump/rebound branch begins at the static pose and uses the previous converged solution as its next initial estimate. A state is accepted only if the optimizer succeeds, the maximum absolute residual is within the configured tolerance, the 6×6 constraint Jacobian has full rank, and its condition number stays below the configured limit. Failed and unattempted continuation points are returned explicitly without a pose or metrics.

## Derived alignment and geometry

- Static camber and toe are explicit wheel-reference inputs; the demo values are zero.
- Positive camber means wheel top outward. Positive toe means toe-in on either side.
- Current camber and toe come from the solved rigid rotation applied to the configured wheel axis.
- Camber gain and bump-steer gradient are finite-difference derivatives over solved wheel travel, reported internally in `rad/m`.
- Caster and KPI/SAI come from the current lower-to-upper ball-joint kingpin axis.
- Track change is signed outward wheel-centre displacement.
- The front-view instant centre intersects projected upper/lower control-arm lines. Each virtual inner point is where its 3D chassis pivot axis meets the outboard joint's X plane.
- Roll-centre height intersects the contact-patch-to-instant-centre line with the vehicle centre plane. It assumes a mirrored symmetric opposite corner and is referenced to the current tire contact plane.

## Phase 2 validity and failure cases

The solver is tested against a closed-form equal-length parallel-arm translation, zero-motion identity, rigid-length residuals, left/right mirror symmetry, derivative finiteness, and unreachable travel. Parallel projected arms, an inner pivot axis parallel to the evaluation plane, singular/ill-conditioned Jacobians, out-of-range geometry, and non-convergence are surfaced as warnings or failures.

The software implementation has analytical benchmark evidence, but the demonstration vehicle geometry remains `unvalidated` because no MSKU Racing CAD motion study or physical measurement was provided.

## Not yet implemented

There is no steering-rack sweep, motion ratio, pushrod/rocker actuation, compliance, force equilibrium, tire model, or transient dynamics. The interface does not display placeholder values for these quantities.

