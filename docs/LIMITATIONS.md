# Limitations

The current build contains Phase 0, the first Phase 1 vertical slice, and the Phase 2 rigid-link kinematics workflow.

- All included hardpoints are synthetic demonstration values. They are not MSKU Racing vehicle data.
- The solver is numerically verified and reference benchmarked as documented in `PHASE_2_VERIFICATION_REPORT.md`; the demonstration vehicle model remains physically unvalidated because no MSKU Racing CAD or physical comparison has been supplied.
- Geometry diagnostics catch important degenerate and ordering failures but do not yet prove mechanism mobility or detect every collision/packaging problem.
- Direct 3D point dragging is not implemented; precise editing is performed in the coordinate inspector.
- Only a double-wishbone corner with steering tie rod is represented. Spring/damper and pushrod/rocker links are omitted until geometry is specified.
- Steering-rack sweep and motion ratio are not implemented. Toe changes caused by wheel travel are calculated; commanded steering is not.
- Roll-centre height is a geometric front-view result. It assumes the unsupplied opposite corner is a symmetric mirror and uses an ideal rigid circular wheel's lowest point. It is suppressed for unsupported pivot axes and unstable projected intersections; it is not a force-based roll centre.
- The alternate numerical reference uses a different formulation and algorithm but the same SciPy numerical stack; an external commercial/CAD reference remains required.
- The deterministic ±0.2 mm sensitivity study describes only the bundled synthetic fixture and is not a manufacturing tolerance allocation.
- Links and joints are perfectly rigid. Compliance, bushing deflection, joint friction, travel stops, collision, and packaging are absent.
- Mirroring is a view operation, not a saved second-corner model.
- Browser local storage is device-local and has no revision history, access control, or collaboration.
- No official MSKU Racing logo is bundled. The UI uses a text-only wordmark.
- Hosted deployment is not configured because provider accounts and credentials were not provided.

No loads, force equilibrium, road response, tire force, or transient dynamics are calculated. Do not use this release for design sign-off or safety decisions.

