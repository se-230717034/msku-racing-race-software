# Phase 3 real-solver diagnosis — 2026-10-21

> Historical diagnosis. Later controlled tests obtained an authorized Academic
> Student checkout and isolated a Unicode project-path/post-solve failure. See
> [the updated root-cause report](./ANSYS_PARTIAL_STATUS_ROOT_CAUSE_2026-10-21.md).

This is an observation from the local ANSYS Student 2026 R1 installation, not a
simulation validation certificate. No mock results were substituted.

## Before code changes

- Mechanical v261 launched from `ANSYS Student/v261`. PyMechanical reported
  `Ansys Mechanical Enterprise PrepPost`; `ReadOnlyMode` was `False`. This proves
  a writable Mechanical editor session, **not** a usable structural solver license.
- Official `example_01_geometry.agdb`, SHA-256
  `49756ab321a4736c5ba94a318e5bf38363a032c8a9c210a817ce1910c1a201f8`,
  imported as four bodies with two fixed faces and one force face. Mesh: 4,464
  nodes and 840 elements. Inputs: Structural Steel, X force +1,000 N, 500 mm
  mesh size.
- With the default solve process, `Solution.Solve(True)` returned
  `Solution.Status = SolveRequired`. Mechanical displayed only the generic
  "unknown error" message. The actual `solve.out` reported four distributed
  tasks requested, only two cores included with the checked-out `emag` feature,
  and `Insufficient HPC licenses available` (`whybad=-1079`). No solution was
  computed.
- Changing to **My Computer, Background** with two cores in a diagnostic run
  did not start a solver or create `solve.out`; it was not adopted as the fix.
- Using Mechanical's **My Computer** foreground solve configuration with two
  cores removed the HPC checkout error and launched MAPDL. This exposed a
  second failure in `file0.err`: `The element option SOLID186 was either not
  ordered with this Ansys installation or the appropriate product was not
  selected for this session.` The status remained `SolveRequired`.

The `emag` feature and the PrepPost product report are observations from the
running installation. They do not establish that a structural solve feature is
available. We did not override license selection or suppress the element error.
The [Mechanical 2026 R1 scripting guide](https://ansyshelp.ansys.com/public/Views/Secured/corp/v261/en/pdf/Ansys_Scripting_in_Mechanical_Guide.pdf)
documents `SolveConfigurations` and `MaxNumberOfCores`. The
[ANSYS license guide](https://ansyshelp.ansys.com/public/Views/Secured/corp/v261/en/pdf/ansys_license_management_guide.pdf)
distinguishes product features; a writable PrepPost session is not proof of
solver entitlement.

## Change and rerun

The bridge now verifies a conservative two-core **My Computer** solve setting
before solving. It classifies the two observed local solver-log errors into
`ANSYS_HPC_LICENSE_LIMIT` and `ANSYS_STRUCTURAL_PRODUCT_UNAVAILABLE`, without
returning raw logs, paths or license-server details to the browser. Either
failure remains `FAILED` with no stress or deformation result. The opt-in smoke
scripts can reuse the pinned official CAD from local cache when GitHub is
unreachable.
The connection message now says explicitly that the writable editor check does
not verify a structural solver license; its existing API field is preserved for
backward compatibility.

After this change, the real `real_static_smoke.py` run reached `solving` and
failed with `ANSYS_STRUCTURAL_PRODUCT_UNAVAILABLE`. It did **not** return
`Done`, maximum von Mises stress or deformation. The independent diagnostic
with the same two-core foreground setting showed `SolveRequired` and the
`SOLID186` product/entitlement error. Thus the HPC request was corrected, but
Phase 3 is still blocked by the local solver license/product selection.
The protected bridge smoke on an isolated local gRPC port also reached `solving`
and ended `FAILED` with `ANSYS_STRUCTURAL_PRODUCT_UNAVAILABLE`; it returned no
numeric result. The default port was occupied during its first attempt, so
the rerun used the supported `MSKU_ANSYS_MECHANICAL_PORT` setting.

An earlier Phase 3 smoke run had reported `Done` and numeric results; that
historical run is not evidence that the current license state can reproduce
them. Do not use those historical values as current validated results.

## Remaining action

The user or ANSYS license administrator must verify, using ANSYS's supported
licensing interface, that this Student installation has a structural solver
entitlement suitable for the generated `SOLID186` model and that the correct
product is selected. We have not changed that selection. Once legitimately
configured, rerun the opt-in real smoke test and require `Done` plus valid SI
results before marking Phase 3 functional on this machine. Do not merge or
deploy a claim of successful structural solving based on the current run.

## Follow-up: explicit `start_license` request on 2026-10-21

PyMechanical 0.13.4 documents `launch_mechanical(start_license=...)`, which
passes `-p <keyword>` to Mechanical. The local bridge now exposes
`MSKU_ANSYS_START_LICENSE`. For a detected Student v261+ installation its
`auto` setting requests `aa_t_i`, listed as Academic Student in an older
[Ansys product table](https://storage.ansys.com/corp/2016/February/images/academic_features.pdf).
The old table does not establish that the feature exists or can be checked out
in this 2026 R1 installation. Explicit `ansys`/`mech_1`/`mech_2` and `none`
are configurable; no rejected request silently falls back to another product.
The conservative two-core foreground solver setting is unchanged.

The first real run with `-p ansys` launched Mechanical v261 but returned
`Ansys Mechanical []` and failed CAD import with `Cannot import while
Mechanical is in read-only mode`. The local ANSYS licensing debug log records
`DENIED ansys` with `Maximum licensed number of demo users already reached`.
The second real run with `-p aa_t_i` also returned `Ansys Mechanical []` and
`ReadOnlyMode=True`; the smoke script stopped before CAD import/mesh/solve.
No `aa_t_i` checkout or denial was visible in the inspected MECH licensing
log. Thus the **actual checked-out product was none**, and the **current solve
status is not attempted** (not `Done` or `SolveRequired`). There are no current
stress, deformation, or mesh result values. This is a licensing/startup
limitation, not a physically validated analysis.

The smoke CAD was the same official `example_01_geometry.agdb`, pinned by
SHA-256. `MSKU_ANSYS_SMOKE_CAD` now permits that already-cached file to be
referenced explicitly when a sandbox's temporary directory differs or GitHub
is unreachable; its hash must still match. The first sandboxed launch failed
with Windows `WinError 623` before ANSYS started. The two actual ANSYS runs
used the normal local Windows process context. The current license outcome
must be resolved through authorized ANSYS Student licensing/support before
rerunning a solve. Neither result may be treated as a successful Phase 3 solve.

Regression checks after this change: 176 Python tests, Ruff, mypy, 57 Vitest
tests, ESLint, TypeScript, production Vite build, and 13 Chromium flows passed.
The Unicode-path log regression is synthetic and verifies log classification;
the current real run stopped before a solver working directory was created.
