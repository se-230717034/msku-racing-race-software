# ANSYS v261 partial-status root-cause investigation — 2026-10-21

This report concerns one locally installed ANSYS Student 2026 R1 instance and
the official small `example_01_geometry.agdb` CAD (SHA-256
`49756ab321a4736c5ba94a318e5bf38363a032c8a9c210a817ce1910c1a201f8`).
No mock solver results, license bypass, internal Workbench launch flags, or
concurrent ANSYS sessions were used. Results here demonstrate a numerical solve
of this example, **not** engineering validation for a Formula Student part.

## Controlled evidence

All comparisons used four bodies, `NS_Fixed`, `NS_Face_1`, Structural Steel,
1000 N in global X, a 500 mm requested mesh size, 4,464 mesh nodes, 840
Mechanical mesh elements, and two distributed MAPDL cores. The actual MAPDL
model includes 1,113 elements when contact/surface elements are counted.

| Run | Project/solver path | Mechanical message and final `Solution.Status` | MAPDL and postprocessing |
| --- | --- | --- | --- |
| Standalone PyMechanical, before fix | Unicode `C:\Users\Yaşar\...\AnsysMech...` | Error: “An unknown error occurred during solution”; `SolveRequiredPartialResultsAvailable`, still partial after `EvaluateAllResults()` | Load step completed; 0 errors, 3 warnings; `.rst` generated; Mechanical could read finite stress and deformation but bridge correctly rejected them |
| Workbench `RunWB2 -B -R`, before fix | Unicode workspace project | Same partial status; `EvaluateAllResults()` did not repair it | Load step completed; 0 errors, 3 warnings; 1,441,792-byte `.rst`; finite diagnostic values, rejected |
| Standalone, controlled ASCII `Project.SaveAs` | `C:\dev\msku_ansys_ascii_temp\...` | `Done` | Same values, 0 errors, 3 warnings |
| Standalone, per-user Windows short path | `C:\Users\YAAR~1\AppData\Local\Temp\...` | `Done` | Same values, 0 errors, 3 warnings |
| Workbench, controlled ASCII project | `C:\dev\msku_ansys_ascii_temp\wb_same_model_20261021\...` | `Done`; no Mechanical error message (only a color-theme information message) | 1,441,792-byte `.rst`; `RUN COMPLETED`; 0 errors, 3 warnings; finite values |

In the successful ASCII Workbench run, `solve.out` records completed load step
1/substep 1 and two distributed cores; `file.rst` is nonempty and the Mechanical
results evaluate to maximum equivalent stress `253.53193716800135 [Pa]` and
maximum total deformation `7.2507573514766963E-09 [m]`. The subsequent
production standalone smoke, with no project-directory or product override,
reported `ReadOnlyMode=False`, `Done`, the same finite SI values, a 1,441,792-byte
`.rst`, and MAPDL 0 errors/3 warnings. Its product report was
`Ansys Mechanical Enterprise`; the MAPDL banner and license checkout identified
`Ansys Mechanical Enterprise Academic Student` and `ansys` plus `HPC_PARALLEL`.
The protected localhost FastAPI launch → explicit job → poll path was then run
against the same real installation and returned `SUCCEEDED/done` with the same
Mechanical values and no mock fallback. The strict Workbench diagnostic journal
was also rerun with checks for `Done`, finite SI values, nonempty `.rst` and
MAPDL `RUN COMPLETED`/zero errors; its real report was `SOLVED`.

The `.rst` file was present and postprocessable even in the Unicode-path runs;
file absence or unreadable result values was **not** the cause. A completed
MAPDL process alone was insufficient: Mechanical's own status and message
remained failed/partial. Geometry update state also was not the difference:
the Workbench journal used the same documented Geometry `Update` and Model
`Refresh` sequence in both paths. Re-evaluating results on the Unicode path
did not change the status. The only controlled change that reproduced `Done`
in both launch modes was moving the Mechanical project/solver working directory
to an ASCII path. This establishes a path-dependent Mechanical post-solve
failure on this installation; the specific internal ANSYS component and a
general Windows-wide Unicode limitation have **not** been proven.

## Three persistent MAPDL warnings

1. Element shape checking was inactive. Mesh quality has not been independently
   established; enable/review appropriate element shape checks for a real model.
2. Material number 11 had no `MP`/`TB` command; energy by that material may be
   unavailable. The successful run's `ds.dat` assigns `MAT,11` to `ET,11,154`
   under “Define Force Using Surface Effect Elements” (the cited element 1741
   is in that block). Thus this warning concerns a generated `SURF154` force
   surface, not evidence that the Structural Steel solid bodies lack material.
3. Reduced-integration brick elements with PCG require through-thickness mesh
   review or a suitable solver choice. No mesh convergence study was performed.

The identical warning classes occurred in Unicode-path partial runs, ASCII-path
`Done` runs, and the earlier successful Workbench project. They are **not** the
observed trigger for the partial status, but they remain engineering warnings.
No warning was suppressed to obtain `Done`.

## Fix and acceptance gate

The bridge now uses the documented standalone Mechanical
[`Project.SaveAs`](https://ansyshelp.ansys.com/public/views/secured/corp/v261/en/act_ref/item2301862269413248198541712202549813619610921712886182.html)
before solve. It defaults to the existing per-user TEMP directory's Windows
short ASCII alias. An engineer may configure an existing local ASCII directory
with `MSKU_ANSYS_PROJECT_DIRECTORY`; invalid, Unicode or UNC paths fail before
solve. The returned solver `WorkingDir` must itself be confirmed absolute and
ASCII. Fresh unique project names avoid overwrite. The `auto` product setting
now delegates to ANSYS; explicit configured products still require entitlement.
No license is bypassed.

The production bridge still rejects every state other than Mechanical `Done`
and rejects missing, non-SI, negative or non-finite stress/deformation. It also
surfaces the MAPDL warning count in the result warning list without exposing
raw solver logs to the browser. The
opt-in real smoke additionally checks a nonempty `.rst`, MAPDL `RUN COMPLETED`
and zero MAPDL errors. The Workbench journal in `services/ansys_bridge/scripts/`
is a local diagnostic only; it is not connected to the application or Vercel.
The saved Mechanical project files are local diagnostic artifacts and can
consume disk space; keep their directory access-controlled.

Remaining work before real-car engineering approval: trace material and
geometry provenance, resolve/review the three warnings, perform mesh
convergence and boundary-condition sensitivity, compare against independent
benchmarks/CAD/measurements, and verify applicable Student license terms and
model-size limits. A successful numerical smoke is not physical correlation.

Verification after the fix: 182 Python tests, Ruff, mypy, 57 frontend unit tests,
ESLint, TypeScript, production Vite build and 13 Chromium end-to-end tests
passed. The frontend build retained its existing large-chunk advisory; the
Python suite retained one upstream Starlette `httpx` deprecation warning.
