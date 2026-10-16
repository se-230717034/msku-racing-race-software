# Limitations

The current build contains Phase 0, the Phase 1 vertical slice, Phase 2/2.5 rigid-link kinematics, the reliable Phase 3 quasi-static subset, Phase 4 quarter-car dynamics, the Phase 5 linear full-car/bicycle/optimization models, and Phase 6 four-corner workflows and reporting.

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
- Phase 4 coordinates are small perturbations from static equilibrium. Gravity, preload, and static
  deflection are not reapplied in the transient equations.
- The quarter-car model is linear and vertical. It excludes pitch, roll, left/right and front/rear
  coupling, suspension kinematic variation, bump stops, compliance, aero, tire enveloping, and
  nonlinear or temperature-dependent spring/damper/tire behavior.
- Suspension stiffness and damping are effective wheel values. Phase 3 sampled motion ratio is not
  automatically coupled into the Phase 4 transient model.
- Tire contact is bilateral during integration. A supplied static tire load permits post-solve
  contact checking; predicted loss of contact fails and suppresses the samples. Flight, impact, and
  re-contact are not modeled.
- An ideal road step has undefined velocity. It is allowed only with zero tire damping, and its
  energy balance is not reported. Half-sine and sampled profiles have declared velocity changes at
  boundaries/knots where integration is restarted.
- Energy balance uses trapezoidal quadrature on requested output samples. It can expose inadequate
  output resolution but is not a proof of physical fidelity.
- The 7DOF full-car model is linear and uses small heave/pitch/roll perturbations, fixed corner
  locations, linear bilateral tires, and effective wheel springs/dampers. It does not couple the
  stored suspension kinematics, compliance, stops, tire enveloping, lift-off, impact, or re-contact.
- The bicycle model assumes constant longitudinal speed, small angles, and linear axle cornering
  stiffness. It excludes roll/load transfer, saturation, load sensitivity, combined slip, relaxation
  length, steering dynamics, bank, and aero. Synthetic stiffness values are not tire measurements.
- Optimization uses bounded differential evolution. A fixed seed makes a configured run reproducible,
  but it does not prove a global optimum. Weighted sums can miss a non-convex Pareto front.
- Optimization accepts only implemented model metrics and fails closed on solver/constraint errors.
  It cannot compensate for missing physical models or turn synthetic inputs into vehicle evidence.
- Reported sensitivities are local finite differences and may be unavailable at a feasibility boundary.
- Candidate geometry preview is non-mutating; explicit apply changes inputs only and does not grant
  physical validation or engineering approval.
- All four corners are saved separately. Bundled right-side corners are explicit mirror assumptions,
  not measured independent geometry; a solved corner is never reused as another corner's solution.
- The full-vehicle chassis is a non-structural reference envelope. It does not imply tube layout,
  suspension attachment points, actuation geometry, stiffness, mass distribution, or crash structure.
- The 7DOF playback moves the body and four wheels from solver histories but hides suspension links
  because that model does not solve link closure. Bicycle display is limited to supplied steering and
  yaw rate integrated for heading.
- Direct PDF export is a traceable textual summary. Use the print/PDF report path when vector geometry
  diagrams and the plot preview are required in the PDF deliverable.
- Validation evidence records do not constitute signatures or approval. The project schema remains
  `UNVALIDATED_PHYSICALLY` and `NOT_APPROVED`.
- Browser local storage is device-local and has no revision history, access control, or collaboration.
- No official MSKU Racing logo is bundled. The UI uses a text-only wordmark.
- Hosted deployment is not configured because provider accounts and credentials were not provided.

No structural stress or detailed nonlinear tyre force is calculated. Phases 2–6 are software-verified within their stated scopes but the vehicle is physically unvalidated. Do not use this release for design sign-off or safety decisions.

