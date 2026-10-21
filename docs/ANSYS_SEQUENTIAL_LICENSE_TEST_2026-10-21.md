# Sequential ANSYS Student license and solve comparison — 2026-10-21

This is a local, opt-in diagnostic, **not** evidence of a validated structural analysis or permission to return results through the application. No ANSYS session was concurrently running at the start of either comparison run. Each process had exited before the other was started. No license server setting, internal Workbench launch flag, or product code was overridden. The standalone run used `MSKU_ANSYS_START_LICENSE=none` (PyMechanical delegates product selection); the Workbench run used documented `RunWB2 -B -R` journal replay. Both used ANSYS Student 2026 R1, a two-core Static Structural solve, and the same official small CAD example:

- CAD: `example_01_geometry.agdb`, SHA-256 `49756AB321A4736C5BA94A318E5BF38363A032C8A9C210A817CE1910C1A201F8`.
- Four imported bodies; `NS_Fixed` and `NS_Face_1` named selections; Structural Steel; fixed support and 1000 N X force; 500 mm requested mesh size.
- The Workbench diagnostic used `Geometry.SetFile`, geometry `Update`, model `Refresh`, and a Python `Model.SendCommand`. Its journal was experimental and was removed after the comparison; it is **not** a validated integration.

| Evidence | Standalone PyMechanical | Workbench journal |
| --- | --- | --- |
| Mechanical read-only flag | `False` | `False` |
| Mechanical product report / MAPDL banner | `Ansys Mechanical Enterprise`; MAPDL `Ansys Mechanical Enterprise Academic Student` | MAPDL `Ansys Mechanical Enterprise Academic Student` |
| Mechanical license event | `licdebug.ebus.MECH.261.out`: 13:54:08 `CHECKOUT ansys (fnp-ansyslmd)` | Same log: 13:52:xx `CHECKOUT ansys (fnp-ansyslmd)` |
| MAPDL license event | `licdebug.ebus.ANSYS.261.out`: 13:54:26 `CHECKOUT ansys (Share)`; 13:54:27 `SPLIT_CHECKOUT` and `CHECKOUT HPC_PARALLEL` | Same log: 13:52:23 `CHECKOUT ansys (Share)`; `SPLIT_CHECKOUT` and `CHECKOUT HPC_PARALLEL` |
| Cores | MAPDL reports 2 distributed processes | MAPDL reports 2 distributed processes |
| Mesh | MAPDL reports 4464 nodes and 1113 total elements (including contact/surface elements) | Mechanical reports 4464 nodes and 840 mesh elements; MAPDL reports 1113 total elements |
| MAPDL result | Load step 1/substep 1 completed, `RUN COMPLETED`, 0 errors, 3 warnings | Same: completed load step, `RUN COMPLETED`, 0 errors, 3 warnings |
| Mechanical `Solution.Status` | `SolveRequiredPartialResultsAvailable` | `SolveRequiredPartialResultsAvailable`, including after `EvaluateAllResults()` |
| Finite result values | Not extracted: existing bridge rejects the non-`Done` status first | Diagnostic only: maximum equivalent stress `253.53193716800135 [Pa]`; maximum total deformation `7.2507573514766963E-09 [m]` |
| Application acceptance | **Rejected** (`SOLVER_NOT_DONE`) | **Rejected** (not `Done`) |

The Workbench run produced a nonempty `file.rst` (1,441,792 bytes) and `solve.out` (45,773 bytes). `file0.err` contained three warnings: element shape checking inactive; material 11 without an `MP` or `TB` definition (energy by material may be unavailable); and reduced-integration brick elements with PCG requiring thickness/solver review. These warnings and the unresolved Mechanical status prohibit treating the diagnostic numbers as approved engineering output. The standalone solver log showed the same warning classes and 0 MAPDL errors before PyMechanical cleaned up its temporary project. The local Workbench result files are retained in the ignored `.uv-cache/ansys-evidence-20261021/` directory; they are not committed or deployed.

## Conclusion and gate

The proposed conditional Workbench integration gate is **not met**: standalone licensing did **not** fail in this controlled test, and Workbench Mechanical did **not** reach `Done`. Workbench-managed licensing is therefore not established as the root cause of the Phase 3 rejection. Both paths can acquire the authorized Academic Student structural product and finish a MAPDL solve, while both expose the same unresolved Mechanical status. A Workbench journal must not be promoted to a success-returning application workflow on this evidence.

Follow-up: [the controlled ASCII-path investigation](./ANSYS_PARTIAL_STATUS_ROOT_CAUSE_2026-10-21.md) reproduced `Done` on both paths without changing geometry, mesh, loads, product or core count. The Unicode-path result above remains a correctly rejected result. This test does not establish physical validation, mesh convergence, or suitability for a real Formula Student component.
