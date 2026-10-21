# ANSYS Phase 4 — solver-warning mitigation and mesh screening (2026-10-21–22)

This report covers an **opt-in local Student 2026 R1 software/mesh study**, not
physical validation of an MSKU Racing part. Phase 4 starts from the unmerged
Phase 3 branch. No ANSYS process or CAD is deployed to Vercel.

## Changes and rationale

- The bridge sets Mechanical's documented `AnalysisSettings.SolverType` to
  `SolverType.Direct`, verifies the property before solve, and rejects a result
  if the previous reduced-integration/PCG warning still appears. Direct selects
  the sparse solver; it does **not** demonstrate sufficient elements through
  every thin section or cure all hourglassing/mesh-discretization risks.
- A fixed, bridge-authored Commands (APDL) object requests `/PREP7`,
  `SHPP,ON,ALL`, `CHECK`, `/SOLU`. The response records whether `SHPP,ON,ALL`
  and `CHECK` were actually emitted in `ds.dat`. This is not a blanket claim that
  all element-quality metrics are acceptable; engineers must inspect local
  solver output, mesh-quality metrics, and element shapes on their own CAD.
- An optional three-mesh study uses the same local CAD, material, load,
  boundary scopes, solver process, and two-core cap. Each generated mesh must
  pass the 128,000-node/element Student precheck before it is solved. Every
  point requires Mechanical `Done`, finite SI results and per-step warnings.
  A failed step fails the job; earlier numeric values are not returned as an
  approved result.

For a reported scalar result `Q`, adjacent relative change is
`abs(Q_next-Q_previous)/abs(Q_next)`. `0→0` has zero change; a nonzero value
followed by zero is undefined and rejected. The **screening** status
`PASSED_NUMERICALLY` requires strictly increasing node and element counts,
both middle→fine changes at most 5%, and both middle→fine changes no greater
than the respective coarse→middle changes. This deliberately conservative
rule is not a mesh-independence proof, convergence-order estimate, hot-spot
location check, or physical correlation. All results retain
`NUMERIC_RESULT_UNVALIDATED_PHYSICALLY`.

The request field `meshConvergenceSizesMm` is optional for backward
compatibility and must contain exactly three strictly decreasing sizes; the
last equals `meshSizeMm`. The Turkish panel requires a separate checkbox and
proposes `1.6×, 1.25×, 1×` of the entered fine size. The study makes three real
solves and may consume substantial local time/disk/license resources.

## Real Student 2026 R1 evidence

Pinned official PyMechanical example AGDB SHA-256:
`49756ab321a4736c5ba94a318e5bf38363a032c8a9c210a817ce1910c1a201f8`.
Inputs: Structural Steel, `NS_Fixed`, `NS_Face_1`, global X 1000 N, two cores.
The writable Mechanical process reported `Ansys Mechanical Enterprise`; the
actual entitlement is subject to the local Student checkout and team terms.
The smoke verified a nonempty `file.rst`, `RUN COMPLETED`, zero MAPDL errors,
Mechanical `Done`, `SHPP,ON,ALL`/`CHECK` in `ds.dat`, a sparse/direct marker in
`solve.out`, and absence of the prior shape-inactive and brick/PCG warnings.

| Requested mesh size (mm) | Mechanical nodes | Mechanical elements | Max von Mises (Pa) | Max total deformation (m) |
| ---: | ---: | ---: | ---: | ---: |
| 500 | 4,464 | 840 | 253.5319357825563 | 7.250757351503458e-9 |
| 400 | 8,614 | 1,696 | 264.88754152944796 | 7.284751469556398e-9 |
| 300 | 14,404 | 2,925 | 278.7390026061557 | 7.259030706281926e-9 |

The measured coarse→middle and middle→fine **stress** changes are 4.287% and
4.969%; the latter grows, so the actual Phase 4 response is `NOT_CONVERGED`,
even though it narrowly falls below the 5% single-pair threshold. Deformation
changes are 0.467% and 0.354%. The rising maximum stress may reflect a local
hot spot, boundary-condition sensitivity, or non-convergence; the cause was
**not established** by this three-mesh global-max study. Do not use the fine
maximum stress as a design allowable.

At each mesh size, MAPDL reported **two warnings**, both the same material
warning: material 11 on element 1741 has no `MP`/`TB`; energy by material may
be unavailable. The previous Phase 3 `ds.dat` associated this element with a
generated `SURF154` load-surface element. Phase 4 did not re-audit every
current generated element type, so the bridge surfaces this warning without
silently dismissing it. No material-energy result is exported.

The opt-in real Chromium flow then repeated the three-mesh study through the
Turkish frontend, tokened localhost bridge and actual Student process. It
observed `Done`, the same fine result (278.7390026061557 Pa and
7.259030706281926e-9 m), `NOT_CONVERGED`, the physical-unvalidation notice,
and the sanitized `MP/TB` warning in the browser. A deliberately missing CAD
path returned an error and no numeric result. The first run of this browser
test revealed a real parser defect: MAPDL split “at least” and “one MP” across
lines. The parser and regression fixture were corrected before the passing
rerun. This is end-to-end software evidence, not a physical benchmark.

The 500 mm direct/sparse run gave 253.5319357825563 Pa and
7.250757351503458e-9 m, close to but not mathematically identical to the
earlier 500 mm PCG run (253.53193716800135 Pa,
7.250757351476696e-9 m). Agreement on this small example cannot validate
other geometries or loads.

## Remaining engineering gates

- Inspect volume-element types, element-quality/Jacobian distributions and
  minimum through-thickness element counts on each real component. Direct
  sparse removes the particular PCG combination warning, not all
  reduced-integration risks.
- Continue mesh refinement and compare spatial stress fields/hot-spot
  locations; investigate whether peak stress is singular at a support/load
  edge. Repeat with physically justified loads, supports, contact and materials.
- Independently benchmark a reference problem, then correlate real MSKU
  Racing CAD, measured material properties, loads and physical tests. Neither
  `Done` nor `PASSED_NUMERICALLY` provides physical validation.
- Confirm the team's Academic Student entitlement and remain within the
  actual solver-enforced model and HPC limits. The 128K precheck is not a
  licensing guarantee because MAPDL can generate additional elements.

Primary Ansys references: [Mechanical solver controls](https://ansyshelp.ansys.com/public/views/secured/corp/v252/en/wb_sim/ds_Solver_Controls.html),
[SHPP](https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/ans_cmd/Hlp_C_SHPP.html),
[Commands object](https://ansyshelp.ansys.com/public/Views/Secured/corp/v251/en/wb_sim/ds_commands_object_sol.html),
and [Mechanical v261 scripting example](https://ansyshelp.ansys.com/public/Views/Secured/corp/v261/en/pdf/Ansys_Scripting_in_Mechanical_Guide.pdf).

## Quality checks

The Phase 4 branch passed 192 Python tests, Ruff, mypy, ESLint, TypeScript,
59 frontend unit tests, the production build, 13 regular Chromium tests, and
the opt-in real-ANSYS Chromium mesh-study test. The production build retains
the existing large-chunk advisory; Python reports one upstream Starlette
`httpx` deprecation warning. The default browser suite skips the licensed
real-ANSYS test; it was run separately with explicit local credentials.
