# Limitations

The current build contains Phase 0, the Phase 1 vertical slice, Phase 2/2.5 rigid-link kinematics, and the reliable Phase 3 quasi-static subset.

- All included hardpoints are synthetic demonstration values. They are not MSKU Racing vehicle data.
- The solver is numerically verified and reference benchmarked as documented in `PHASE_2_VERIFICATION_REPORT.md`; the demonstration vehicle model remains physically unvalidated because no MSKU Racing CAD or physical comparison has been supplied.
- Geometry diagnostics catch important degenerate and ordering failures but do not yet prove mechanism mobility or detect every collision/packaging problem.
- Direct 3D point dragging is not implemented; precise editing is performed in the coordinate inspector.
- Only a double-wishbone corner with steering tie rod is represented. Optional actuation coordinates can be stored, but integrated rocker/pushrod kinematic closure is not implemented.
- Motion ratio is supported only from an explicit spring-length versus wheel-travel series with CAD/measurement provenance. The bundled values are labeled synthetic test data.
- Steering-rack sweep is not implemented. Toe changes caused by wheel travel are calculated; commanded steering is not.
- Roll-centre height is a geometric front-view result. It assumes the unsupplied opposite corner is a symmetric mirror and uses an ideal rigid circular wheel's lowest point. It is suppressed for unsupported pivot axes and unstable projected intersections; it is not a force-based roll centre.
- The alternate numerical reference uses a different formulation and algorithm but the same SciPy numerical stack; an external commercial/CAD reference remains required.
- The deterministic ±0.2 mm sensitivity study describes only the bundled synthetic fixture and is not a manufacturing tolerance allocation.
- Links and joints are perfectly rigid. Compliance, bushing deflection, joint friction, travel stops, collision, and packaging are absent.
- Phase 3 member forces are ideal pin-jointed two-force axial loads. They are not tube stresses, wishbone resultant stress fields, bearing/fastener loads, buckling margins, fatigue life, or safety factors.
- The five standard links cannot balance an arbitrary six-component contact wrench. An explicit sixth force path may make a case determinate; more than six unknown axial paths require a stiffness model and are suppressed.
- The vehicle load-transfer model is steady-state rigid-body theory on flat ground. It excludes aero, unsprung mass, compliance, geometric jacking, tyre behaviour, and transient effects. Lateral axle distribution requires both roll stiffnesses.
- Damper force requires explicit velocity and declared coefficients. Static displacement never implies damper force.
- Negative normal loads fail rather than being clipped; contact-loss dynamics are outside Phase 3.
- Mirroring is a view operation, not a saved second-corner model.
- Browser local storage is device-local and has no revision history, access control, or collaboration.
- No official MSKU Racing logo is bundled. The UI uses a text-only wordmark.
- Hosted deployment is not configured because provider accounts and credentials were not provided.

No structural stress, detailed tyre force, road response, or transient dynamics are calculated. Phase 3 is numerically benchmarked but physically unvalidated. Do not use this release for design sign-off or safety decisions.

