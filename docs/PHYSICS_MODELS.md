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

## Not yet implemented

There is no wheel travel solve, steering solve, camber, toe, caster, KPI, roll centre, motion ratio, compliance, force equilibrium, tire model, or transient dynamics. The interface does not display placeholder values for these quantities.

## Phase 2 solver requirements

The first kinematics solver must preserve measured rigid lengths through nonlinear constraints, use the previous converged state as the next initial guess, publish residual norms/tolerances, detect singular Jacobians and discontinuities, and be tested against independent baselines. Until those tests pass, all results must remain `unvalidated`.

