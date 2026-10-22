# ANSYS local integration Phase 5 — Studio transfer and modal evidence (2026-10-22)

## Scope and evidence level

This phase preserves the opt-in Static Structural workflow and adds a real local
Mechanical Modal workflow. The browser and localhost bridge can transfer one
Dynamics Studio corner's nine hardpoints and an accepted quasi-static **input**
force. They do **not** turn the visualization GLBs into solid finite-element
CAD or automatically attach hardpoints, materials, supports or loads to an
imported CAD body. All transfer registration is declared by the engineer and
must be checked against independently measured CAD anchors. Neither the
sample numerical results below nor a successful solver status physically
validates a vehicle component.

## Data flow and coordinate contract

1. The engineer selects a local `.agdb`, `.pmdb`, `.step` or `.stp` solid CAD
   file with an existing named selection for the fixed support. Static
   Structural also requires a **different** load-face named selection.
2. Studio vehicle coordinates are metres, +X forward, +Y left, +Z up.
   A declared signed-permutation proper rotation maps vehicle axes to CAD
   axes, and a declared vehicle-frame CAD origin gives
   `p_cad_mm = 1000 R (p_vehicle_m - origin_vehicle_m)`. Reflection and
   repeated axes are rejected; the determinant must be +1. Three distinct,
   non-collinear user-entered CAD anchor positions must match the transformed
   Studio hardpoints within the declared 0.5 mm tolerance. This checks the
   arithmetic and the *declaration*, not CAD geometry topology.
3. A transferred quasi-static force is the accepted external wrench **input**,
   not a solved suspension link reaction or ANSYS load. Its moment must be
   zero for this workflow. The force components are rotated by `R` into CAD
   axes without translation or metre-to-millimetre scaling: `F_cad_N = R F_vehicle_N`.
   The user's named face receives those components. The CAD application point
   and load distribution remain unverified; a nonzero moment is rejected.
   The original input hash is retained. Without a declared CAD frame and
   anchors, the UI blocks this imported-force path.
4. The nine converted hardpoints are passed into the Mechanical script
   namespace as traceable coordinates and echoed in result evidence. They do
   **not** scope a CAD face or create a structural joint. The current material
   is ANSYS library `Structural Steel`, explicitly an assumption; project
   manifest material properties are not yet mapped to ANSYS. A real team CAD,
   material and boundary-condition reconciliation remains required.

The bridge remains bound to localhost, uses an authenticated explicit job
request and a bridge-owned writable Mechanical process, caps configured solves
at two cores, and prechecks nodes/elements against 128,000. ANSYS itself still
enforces its license and generated-element limits. There is no mock fallback.

## Modal implementation and acceptance gates

The requested 1–6 modes use a real `Model.AddModalAnalysis()` and a named fixed
support. Mechanical generates mesh and computes `ElementQuality` minimum,
average and maximum if available; `UNAVAILABLE` is shown otherwise. The
bridge requests APDL shape checking and verifies its presence in solver input.
It accepts modes only after Mechanical reports `Done`, a nonempty `file.rst`
exists, every `ReportedFrequency` parses as finite positive hertz, and the
frequencies are ordered. Mode-shape deformation is *normalized modal shape*,
not a forced-displacement prediction. Modal mesh convergence is `NOT_ASSESSED`.
Missing CAD, empty support selection, license failure, over-limit mesh,
non-`Done` status, absent result file and invalid frequency fail without
returning engineering numbers. Real Mechanical error logs stay local.

Static Structural still requires finite SI stress/deformation, `Done`, result
file and the existing Phase 4 mesh-study checks. `NOT_CONVERGED` and the
physical-unvalidation warning remain visible. Phase 5 adds a measured
Mechanical element-quality summary; no threshold automatically marks a design
as approved.

## Actual Student 2026 R1 smoke evidence

These results come from the previously pinned official small example AGDB,
SHA-256 `49756ab321a4736c5ba94a318e5bf38363a032c8a9c210a817ce1910c1a201f8`,
not an MSKU vehicle component. The installed binary was under ANSYS Student
v261; the writable PyMechanical session reported product text
`Ansys Mechanical Enterprise`. That product string does **not** by itself
prove the exact checked-out academic entitlement. No license check was
bypassed. Both solves configured two cores and a 500 mm mesh with 4,464
Mechanical nodes and 840 Mechanical elements.

| Real run | Mechanical status | Measured output | ElementQuality min / avg / max |
| --- | --- | --- | --- |
| Static Structural | `Done` | 253.5319357825563 Pa max von Mises; 7.250757351503458e-9 m max total deformation | 0.8540022760476914 / 0.9279603806421596 / 0.9864843574037263 |
| Modal, 3 modes | `Done` | 21.609975179192634 Hz; 21.609977898586124 Hz; 56.38194648923333 Hz | 0.8540022760476914 / 0.9279603806421596 / 0.9864843574037263 |

The static run still surfaced the material `MP/TB` warning associated in the
earlier investigation with generated load-surface elements. It is not silently
discarded. These numbers have no physical acceptance status. They are a
single sample, not a modal benchmark or a mesh-independence proof.

## Verification and outstanding engineering gates

- Automated tests cover conversion, handedness, anchor mismatch/collinearity,
  authenticated endpoints, modal failure gates and browser contract parsing.
  Final local gates passed: 209 Python tests, Ruff, mypy, ESLint, TypeScript,
  65 frontend unit tests, production build, 13 regular Chromium flows (one
  licensed flow intentionally skipped), and the separately opted-in real
  Chromium frontend → authenticated bridge → Student Mechanical → frontend
  flow. The latter completed three static mesh solves, surfaced the actual
  fine-mesh `Done` values (278.7390026061557 Pa and
  7.259030706281926e-9 m), retained `NOT_CONVERGED` and physical-unvalidation
  warnings, then completed the modal browser result/units/quality checks.
  The initial real browser run exposed an asynchronous test-response race; it
  was fixed and the full licensed flow passed on rerun. Local Mechanical is
  not available in GitHub CI; CI fakes do not count as physical or
  licensed-solver evidence. Vite's existing large-chunk advisory remains.
- Import actual MSKU Racing solid CAD, identify CAD faces and joint locations,
  and compare all anchors against independent CAD/measurement evidence. The
  GLB parts remain visual only.
- Import measured, versioned material properties and solve with physically
  justified supports, load patches and contact. A face force is not yet a
  verified suspension load path; dynamic modal pre-stress is not modeled.
- Perform modal and static mesh convergence, element shape/through-thickness
  inspection, spatial hot-spot/singularity checks, an independent benchmark
  and vehicle-test correlation. Phase 4 sample peak stress remained
  `NOT_CONVERGED`; Phase 5 does not waive that status.
- Verify team licensing rights for intended use and the solver's actual
  checkout/limits. A Student installation path, writable session or `Done`
  alone does not establish license entitlement for every analysis.

ANSYS references: [Student feature and limits](https://www.ansys.com/en-in/academic/students/ansys-student),
[Mechanical v261 model scripting API](https://scripting.mechanical.docs.pyansys.com/version/stable/api/ansys/mechanical/stubs/v261/Ansys/ACT/Automation/Mechanical/Model.html),
[Mechanical v261 mesh metrics API](https://scripting.mechanical.docs.pyansys.com/version/stable/api/ansys/mechanical/stubs/v261/Ansys/ACT/Automation/Mechanical/MeshControls/Mesh.html).
