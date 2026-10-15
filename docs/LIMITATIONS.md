# Limitations

The current build is Phase 0 plus the first Phase 1 vertical slice.

- All included hardpoints are synthetic demonstration values. They are not MSKU Racing vehicle data.
- The model is static and unvalidated. It performs no kinematics, loads, dynamics, road, tire, or optimization calculation.
- Geometry diagnostics catch important degenerate and ordering failures but do not yet prove mechanism mobility or detect every collision/packaging problem.
- Direct 3D point dragging is not implemented; precise editing is performed in the coordinate inspector.
- Only a double-wishbone corner with steering tie rod is represented. Spring/damper and pushrod/rocker links are omitted until geometry is specified.
- Mirroring is a view operation, not a saved second-corner model.
- Browser local storage is device-local and has no revision history, access control, or collaboration.
- No official MSKU Racing logo is bundled. The UI uses a text-only wordmark.
- Hosted deployment is not configured because provider accounts and credentials were not provided.

Do not use this release for design sign-off or safety decisions.

