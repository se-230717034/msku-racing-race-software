# ANSYS local bridge — Phase 3 Static Structural

## What runs, and where

The **ANSYS YEREL** panel can submit one explicit Static Structural job to the separate
`127.0.0.1:8765` FastAPI bridge. The bridge uses its own verified, bridge-launched
Mechanical process. It does not modify an externally connected Mechanical project.
The CAD path is a local path on the engineer's Windows computer; the file, Mechanical
process, mesh and solver remain local. No ANSYS solve runs on Vercel, and there is no
mock fallback in the real endpoint. Jobs are never started by page load or polling.

## Supported first workflow

1. Provide an existing local `.agdb`, `.pmdb`, `.step` or `.stp` file (100 MB cap).
2. The CAD must contain two distinct, nonempty named selections: one for fixed support
   and one for the force. A STEP file without these will be rejected rather than
   assigned guessed faces. The bridge verifies that selected entity IDs do not overlap.
3. The first material choice is Mechanical's built-in **Structural Steel**. Force is a
   signed X/Y/Z component in newtons; global mesh size is in millimetres.
4. Mechanical imports geometry, assigns material to all bodies, adds one Static
   Structural analysis, fixed support and force, generates mesh, solves, and evaluates
   equivalent (von Mises) stress and total deformation.
5. `SUCCEEDED` requires Mechanical solution status `Done`, finite nonnegative result
   values with `[Pa]` and `[m]` units, positive mesh counts, and a verified bridge-owned
   licensed process. Outputs include input settings, CAD SHA-256, Mechanical version,
   reported product, mesh counts and warnings. They are **not physically validated**.

The bridge rejects a generated mesh exceeding 128,000 nodes or 128,000 elements before
solve. [Ansys' current Student page](https://www.ansys.com/academic/students/ansys-student)
lists 128K structural nodes/elements, but solver-generated entities may increase the
true count and the active entitlement can differ. The actual solver/license remains
authoritative; no license setting is bypassed. The local installation being under
`ANSYS Student` does not prove which license was checked out.

## Reproducible small-geometry smoke

PyMechanical's [official basic Static Structural example](https://examples.mechanical.docs.pyansys.com/examples/00_basic/example_01_simple_structural_solve.html)
provides `example_01_geometry.agdb` (~17 KB) with named selections `NS_Fixed` and
`NS_Face_1`. The opt-in local scripts download this sample to the OS temp directory
and run a **real** Mechanical solve:

```powershell
.\.venv\Scripts\python.exe services/ansys_bridge/scripts/real_static_smoke.py
.\.venv\Scripts\python.exe services/ansys_bridge/scripts/real_bridge_smoke.py
```

On this Windows installation (Mechanical v261, reported product `Ansys Mechanical
Enterprise`), one smoke run used `NS_Fixed`, `NS_Face_1`, X force +1000 N, mesh size
500 mm and Structural Steel. Mechanical reported `Done`, 4,464 nodes and 840 elements,
maximum von Mises stress **253.5319345691811 Pa**, and maximum total deformation
**7.250757351470993e-9 m**. CAD SHA-256 was
`49756ab321a4736c5ba94a318e5bf38363a032c8a9c210a817ce1910c1a201f8`.
These are observations from that one run, not reference expected values; no mesh
convergence or independent physical correlation was performed. Other ANSYS versions,
licenses, machines, CAD, loads or mesh settings may give different results or fail.
The second script also verified the protected HTTP launch/job/poll/result path with
the same Mechanical-reported `Done` state and numeric values. Both scripts are opt-in
and never run in CI or in the browser automatically.

To use the panel, start `npm run ansys-bridge:dev`, enter its token, click
**Mechanical'ı başlat**, enter the sample's local AGDB path and the fields above,
then click **Analizi açıkça başlat**. The browser polls only that submitted job.

## API and failure behavior

`POST /bridge/v1/analyses/static-structural` accepts `geometryPath`, `material`,
`fixedNamedSelection`, `forceNamedSelection`, `forceAxis`, `forceN` and `meshSizeMm`.
It returns HTTP 202 with a job ID. `GET /bridge/v1/analyses/static-structural/{jobId}`
returns `QUEUED`, `RUNNING`, `SUCCEEDED` or `FAILED`, stage, message, error code and
only on success a result. Both endpoints require the same token, loopback socket,
trusted host and allowed browser origin as Phase 2. Only one job runs at a time;
job state is in memory and is lost on bridge restart. There is no cancel or export
endpoint in this phase.

Missing named selections, unreadable/unsupported CAD, overlapping scopes, mesh-size
precheck, solver failure, unexpected result units, invalid values, and license errors
remain failures with **no numeric result**. Raw Mechanical/gRPC exceptions are not
returned to the browser because they may include local paths or license-server data.
Inspect local Mechanical logs for detailed diagnostics. A completed solve does not
establish mesh independence, stress-singularity freedom, correct boundary conditions,
material traceability for a real car, or physical correlation. Those remain required
before engineering approval.

The workflow follows the [PyMechanical Static Structural example](https://examples.mechanical.docs.pyansys.com/examples/00_basic/example_01_simple_structural_solve.html),
[v261 mesh/result API](https://scripting.mechanical.docs.pyansys.com/version/stable/api/ansys/mechanical/stubs/v261/Ansys/ACT/Automation/Mechanical/Solution.html)
and [Mechanical's named-selection API](https://scripting.mechanical.docs.pyansys.com/version/stable/api/ansys/mechanical/stubs/v261/Ansys/ACT/Automation/Mechanical/NamedSelection.html).
