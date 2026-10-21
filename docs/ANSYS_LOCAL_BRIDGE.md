# ANSYS Local Bridge — Phase 2 connection and Phase 3 analysis

## Scope and security

The separate `services/ansys_bridge` process discovers local Mechanical installations, checks PyMechanical compatibility, tests an existing process, and can launch Mechanical when the engineer explicitly requests it. Phase 3 adds a separately requested Static Structural workflow in a bridge-owned process; see [the Phase 3 guide](./ANSYS_PHASE_3_STATIC_STRUCTURAL.md). `simulationsEnabled` remains `false` in the legacy readiness response to signal that no automatic simulation is enabled. The bridge is excluded from the Vercel Python function bundle and runs only on the engineer's Windows computer.

Phase 1 controls remain: binding to `127.0.0.1:8765`, loopback client checks, an exact browser Origin allowlist, a random session token for protected endpoints, and a strict loopback browser URL. The token remains in browser `sessionStorage`. Mechanical gRPC uses Windows Named User Authentication (`wnua`) at `127.0.0.1`; there is no insecure fallback.

## Student 2026 R1 executable and discovery

The local `Mechanical 2026 R1.lnk` shortcut targets `C:\Program Files\ANSYS Inc\ANSYS Student\v261\aisol\bin\winx64\AnsysWBU.exe` with `-DSApplet`. That executable's Windows file description says `Mechanical 2026 R1`. The separate `RunWB2.exe` shortcut launches Workbench. PyMechanical [supports `launch_mechanical(exec_file=...)`](https://mechanical.docs.pyansys.com/version/stable/getting_started/running_mechanical.html) for an explicit Mechanical executable.

Discovery inspects `AWP_ROOT###`, `C:\Program Files\ANSYS Inc\ANSYS Student\v###`, `C:\Program Files\ANSYS Inc\v###`, and optional `MSKU_ANSYS_MECHANICAL_EXECUTABLE`. The explicit path must be absolute and local, with the `v###\aisol\bin\winx64\AnsysWBU.exe` layout; UNC paths and arbitrary executables are rejected. An explicit valid path takes selection priority. Discovery checks file presence and revision, not runtime or license entitlement.

For this nested Student installation, `launch_mechanical(exec_file=...)` alone timed out before opening a gRPC port. Passing `AWP_ROOT261=C:\Program Files\ANSYS Inc\ANSYS Student\v261` to the child through PyMechanical's `additional_envs` started the same executable successfully. The bridge derives that variable from the verified installation revision and root. It does not bypass license checkout.

## Compatibility and verification

The bridge uses `ansys-mechanical-core` 0.13.x. Its compatibility gate follows the [PyMechanical installation guide](https://mechanical.docs.pyansys.com/version/stable/getting_started/installation.html): Python 3.12–3.14 and Mechanical v242 (2024 R2) or later. `COMPATIBLE` indicates a version match only.

**Gerçek bağlantıyı test et** connects to an existing local gRPC process. **Mechanical'ı başlat** uses the selected executable and versioned `AWP_ROOT###` through `launch_mechanical`, in batch mode with WNUA. `auto` delegates license selection to ANSYS (`start_license=None`); this installation actually checked out the Academic Student structural product, whereas explicit `aa_t_i` started read-only. Explicit keywords use PyMechanical's [`start_license`](https://mechanical.docs.pyansys.com/version/stable/api/ansys/mechanical/core/mechanical/index.html) and are never silently retried with another product. The launch action checks that the port is free first; it never replaces an existing listener. Startup can take time and consume an available license. The bridge retains its PyMechanical client during its lifetime and closes only the process it owns on shutdown.

Both actions require these independent checks before returning `VERIFIED`:

1. Installation and documented version compatibility.
2. A real PyMechanical gRPC connection and `verify_valid_connection()` without rejection.
3. `get_product_info()` identifying Ansys Mechanical.
4. A process version matching a detected local installation.
5. Mechanical `ReadOnlyMode=False`, which demonstrates a writable license-backed session at test time.

The response includes `processVerified`, `licenseVerified`, `startedByBridge`, timestamp, endpoint, process version, and bounded product information. Status refresh rechecks the listener and PyMechanical connection, revoking the verified state if the process is gone. Failed checks yield a non-success state and sanitized errors; raw exceptions can expose local paths or license-server details. A successful test does not prove the active license edition is Student, that automation is permitted under a team's entitlement, or that an engineering result is valid.

On this Windows machine, direct Python launch and the protected bridge endpoint each verified version `261`, an `Ansys Mechanical` product response, `verify_valid_connection()` without error, and `ReadOnlyMode=False`. The product string was `Ansys Mechanical Enterprise PrepPost` on the first run and `Ansys Mechanical Enterprise` on the final bridge lifecycle run. This is evidence of a licensed Mechanical process, not evidence that a free Student license was active. The final bridge test kept the gRPC listener alive after the launch response and closed it when the bridge shut down. No model was created or solved.

## Local operation

```powershell
uv sync --all-packages --all-extras --dev
npm run ansys-bridge:dev
```

Enter the printed token in the **ANSYS YEREL** panel. Then choose **Mechanical'ı başlat** to use the discovered executable, or **Gerçek bağlantıyı test et** for a process already listening at the configured port. PyMechanical's `ansys-mechanical --revision 261` CLI may fail to discover this nested Student installation by itself; the bridge uses the supported explicit-path API.

| Environment variable | Default | Constraint |
| --- | --- | --- |
| `MSKU_ANSYS_BRIDGE_TOKEN` | Random from launcher | At least 32 characters |
| `MSKU_ANSYS_BRIDGE_ALLOWED_ORIGINS` | Local Vite/preview and official production origins | Exact comma-separated origins |
| `MSKU_ANSYS_MECHANICAL_PORT` | `10000` | `1024`–`65535`, loopback only |
| `MSKU_ANSYS_CONNECTION_TIMEOUT_SECONDS` | `8` | `1`–`30` seconds |
| `MSKU_ANSYS_LAUNCH_TIMEOUT_SECONDS` | `180` | `30`–`300` seconds |
| `MSKU_ANSYS_MECHANICAL_EXECUTABLE` | Discovered path | Absolute local `v###\aisol\bin\winx64\AnsysWBU.exe` |
| `MSKU_ANSYS_START_LICENSE` | `auto` | `auto` and `none` delegate selection to ANSYS; explicit `aa_t_i`, `ansys`, `mech_1`, `mech_2` are accepted on v261+ but require real entitlement |
| `MSKU_ANSYS_PROJECT_DIRECTORY` | Per-user TEMP short ASCII path | Optional existing, local, absolute ASCII directory for documented Mechanical `Project.SaveAs`; Unicode/UNC/invalid paths fail before solve |

Do not commit tokens or license-server details.

## HTTP endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/bridge/v1/health/live` | Minimal local liveness |
| `GET` | `/bridge/v1/health/ready` | Authenticated bridge/adapter readiness |
| `GET` | `/bridge/v1/status` | Installation, compatibility, and last verification |
| `POST` | `/bridge/v1/connection/test` | Verify existing local Mechanical process |
| `POST` | `/bridge/v1/connection/launch` | User-triggered explicit-path launch and verification |
| `POST` | `/bridge/v1/analyses/static-structural` | Explicit local Static Structural job start |
| `GET` | `/bridge/v1/analyses/static-structural/{jobId}` | Poll submitted job and actual results |

All but `/health/live` require the bridge token. All requests require a loopback socket and allowed browser Origin. The only solve endpoint is the explicit Static Structural job described in the Phase 3 guide. There is no arbitrary-script or general upload endpoint.

## Student and license limits

The [Ansys Student page](https://www.ansys.com/academic/students/ansys-student) lists structural model, geometry export, HPC, and term limits. The exact entitlement can differ for a Student Team Partnership or institutional license; follow the applicable [academic usage terms](https://www.ansys.com/legal/terms-and-conditions/academic-usage). The bridge requests the configured product through ANSYS's standard checkout path, never reads or modifies a license file, and never bypasses licensing. `ReadOnlyMode=False` establishes a usable session, not structural solver entitlement or the terms of that entitlement. A bridge-owned PrepPost or empty-product report is rejected.

CI uses strict fake clients because it has no Mechanical installation or license. The earlier `start_license` attempts are documented in [the smoke diagnosis](./ANSYS_PHASE_3_SMOKE_DIAGNOSIS_2026-10-21.md). The later controlled Unicode/ASCII comparison and real successful two-core smoke are documented in [the root-cause report](./ANSYS_PARTIAL_STATUS_ROOT_CAUSE_2026-10-21.md). The result remains numerically solved, not physically correlated.
