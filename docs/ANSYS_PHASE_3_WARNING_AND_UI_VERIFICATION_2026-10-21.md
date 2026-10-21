# Phase 3 ANSYS warning review and real UI verification — 2026-10-21

This is a software integration check on the official PyMechanical example CAD,
not validation of a Formula Student component. The pinned input SHA-256 is
`49756ab321a4736c5ba94a318e5bf38363a032c8a9c210a817ce1910c1a201f8`.
The real browser test used Structural Steel, `NS_Fixed`, `NS_Face_1`, 1000 N
in global X, a requested 500 mm mesh size, and the bridge's two-core limit.
The actual model contained 4,464 Mechanical mesh nodes and 840 Mechanical
mesh elements; MAPDL reported 1,113 elements including generated surface and
contact elements. These are **numerical observations**, not design allowables.

## Three MAPDL warnings and engineering significance

The real run's `file0.err` contained exactly the following three warning
classes. `solve.out` reported `RUN COMPLETED`, zero errors, and three warnings;
Mechanical reported `Done`. These warnings did not block this software smoke,
but none was suppressed or declared harmless for engineering use.

| Warning | Evidence from this run | Significance and required engineering action |
| --- | --- | --- |
| Shape checking inactive | Generated `ds.dat:27` contains `SHPP,OFF,,NOWARN`; `file0.err` asks for `SHPP,ON` or `SHPP,WARN`. | **Medium to high, unresolved mesh-quality risk.** The solve does not establish that Jacobian/shape limits were checked. Review Mechanical mesh-quality metrics and, where applicable, check the exported elements with documented `SHPP`/`CHECK` procedures. A mesh-convergence study is still required. Do not infer that every element is invalid. |
| Material 11 lacks `MP`/`TB` | `file0.err` names element 1741. `ds.dat:5847-5851` places `ET,11,154` and `MAT,11` under “Define Force Using Surface Effect Elements.” | **Low for this run's displacement/stress, conditional.** The named element is generated `SURF154` for the applied load, not proof that the Structural Steel volume bodies lack elastic properties. MAPDL explicitly warns that energy *by material* may be unavailable; do not accept material-energy output without checking. Reclassify as critical if a future run points to a load-bearing solid element or a needed energy quantity. |
| Reduced-integration brick with PCG | `file0.err` identifies the combination and recommends multiple elements through thickness or `EQSLV,SPARSE`. The mesh's minimum through-thickness layer count was **not** measured. | **High, unresolved result-accuracy risk** for this example and especially thin real parts: insufficient layers may permit hourglass/nonphysical deformation. Inspect each body and its through-thickness mesh, then compare mesh refinement and a supported full-integration or sparse-solver configuration. The `Done` flag does not resolve this. |

The `SURF154` interpretation is supported by the generated input and ANSYS's
[SURF154 element reference](https://ansyshelp.ansys.com/public/views/secured/corp/v261/en/ans_elem/Hlp_E_SURF154.html).
ANSYS documents the risks of disabled [shape checking](https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/ans_cmd/Hlp_C_SHPP.html)
and [one-element-thick reduced-integration meshes](https://ansyshelp.ansys.com/public/Views/Secured/corp/v261/en/wb_sim/ds_trouble_elem_two_directions.html).
The classifications above are our engineering judgments for this specific
model; they are not ANSYS product status codes.

## Real frontend → bridge → ANSYS → frontend evidence

The opt-in Chromium test `apps/web/tests/e2e/ansys-real.spec.ts` called the
unmocked localhost bridge from the actual React panel. It entered a session
token, explicitly launched a writable Mechanical Student 2026 R1 process,
submitted a deliberately nonexistent `.agdb` path and observed the Turkish
error without any result being shown, then submitted the pinned example CAD.
The bridge performed a real solve and the browser polled the completed job.

| Check | Actual observation |
| --- | --- |
| Process and license gate | Connection state `VERIFIED`, bridge-owned process, writable session; the structural checkout was confirmed by the real solve, not inferred from installation detection. |
| Solver/status | Mechanical `Done`; `solve.out` `RUN COMPLETED`, zero errors, three warnings; nonempty `file.rst`. |
| Maximum von Mises | `253.53193716800135 Pa` from Mechanical; the browser displayed the same response after conversion to **MPa**. |
| Maximum total deformation | `7.250757351476696e-9 m` from Mechanical; the browser displayed the same response after conversion to **mm**. |
| Provenance and warnings | Response `units=SI`, pinned CAD hash, `NUMERIC_RESULT_UNVALIDATED_PHYSICALLY`; browser displayed the physical-unvalidation statement, MAPDL count, and explicit shape-checking and reduced-integration/PCG risks. |
| Invalid input | Missing CAD returned a visible error; no stress/deformation card appeared for that request. |

The browser test compares its displayed values to the **actual** bridge job
response, rather than to fabricated fixtures. The test does not independently
benchmark stress or deformation physics. The numerical values are not proof of
material-property correctness, realistic boundary conditions, mesh
independence, or agreement with measurements.

Before the merge review, the bridge warning summary was extended to name the
shape-checking and reduced-integration/PCG risks when those exact phrases occur
in the local `file0.err`. Only fixed, sanitized messages cross the HTTP
boundary; raw logs and local CAD paths remain local. The opt-in browser test
asserts that both risk statements and the physical-unvalidation notice are
visible. This does not resolve either warning.

## Remaining gate before engineering approval

Record the actual MSKU Racing CAD, dimensions, material and load provenance;
inspect mesh shape and thickness, resolve or bound the reduced-integration
warning, perform mesh and boundary-condition sensitivity studies, and compare
stress/deformation to an independent reference and physical measurements.
The software feature may be mergeable after its automated gates pass; that is
**not** approval to use this sample result for vehicle design.

## Software quality gates

The real licensed Chromium flow passed again after the merge-review changes
(one additional actual ANSYS solve). The
regular Chromium suite passed 13 tests and intentionally skipped that opt-in
licensed case. The full Python suite passed 183 tests; Ruff and mypy passed.
Frontend lint, TypeScript, 58 unit tests, and the production build passed. The build
retained a large-chunk advisory, and Python tests retained one upstream
Starlette `httpx` deprecation warning. Neither changed the solver result.

## Merge-preparation security and repository review

The full feature diff against `main` was reviewed. The local bridge binds to
loopback, requires an exact allowed browser origin and a session token for all
non-live endpoints, uses Windows Named User Authentication, and never runs as
a Vercel function. Structural jobs require a newly bridge-owned process;
`start_instance=True` now explicitly prevents PyMechanical from adopting an
existing user session. Solver exceptions are sanitized before HTTP responses.
There is no arbitrary Python-script API or mock fallback for real jobs.

No token, private key, license-server detail, solver result binary, CAD file,
or generated test/build artifact is tracked in the feature diff. Personal
user-profile paths were removed from historical reports; the remaining ANSYS
installation path is a documented generic layout. The source's fixed tokens
are isolated test fixtures, not operational credentials. Generated Mechanical
projects remain local and require disk/access management by the engineer.

Student compliance is conditional on the user's actual entitlement and usage.
The bridge uses documented PyMechanical launch parameters, delegates automatic
product selection to ANSYS, checks for a writable real process and an actual
completed solve, caps the requested solve at two cores, and rejects oversized
pre-solve meshes at 128K nodes/elements. The solver can add elements and remains
the final licensing authority. Neither a successful checkout nor this software
review certifies the team's legal rights or a physically validated model.
