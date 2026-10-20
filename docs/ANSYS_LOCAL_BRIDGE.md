# ANSYS Local Bridge — Phase 2

## Scope and safety boundary

Phase 2 adds Windows installation discovery, documented-version compatibility checks, and an explicit test against an already-running local Ansys Mechanical process. It does **not** create a Mechanical model, import CAD, mesh, solve, export results, or implement any structural simulation.

The bridge remains a separate package under `services/ansys_bridge`. It is not imported by `api/index.py`, is excluded from the Vercel Python function bundle, and must run on the engineer's own Windows computer.

Security inherited from Phase 1 remains mandatory:

- Uvicorn binds only to `127.0.0.1:8765`.
- Non-loopback socket clients and untrusted browser origins are rejected.
- Protected endpoints require a random per-process `X-MSKU-Bridge-Token`.
- The browser accepts only HTTP loopback bridge URLs and stores the token in `sessionStorage`.
- Private Network Access preflight is restricted by the exact CORS allowlist.
- Vercel receives neither the token nor ANSYS installation/process data.

Phase 2 adds two further rules:

- The bridge never starts ANSYS automatically. Process testing targets only `127.0.0.1` and the configured local gRPC port.
- Windows Named User Authentication (`wnua`) is mandatory. The bridge does not silently fall back to insecure gRPC transport.

## Installation discovery

Discovery is read-only and never executes an Ansys binary. On Windows it inspects:

1. `AWP_ROOT###` environment variables created by Ansys installations.
2. `C:\Program Files\ANSYS Inc\ANSYS Student\v###`.
3. `C:\Program Files\ANSYS Inc\v###` for a non-Student installation that may coexist.

A candidate is accepted only when `aisol\bin\winx64\AnsysWBU.exe` exists. Version codes use Ansys revision notation: `v242` is 2024 R2, `v251` is 2025 R1, and `v261` is 2026 R1. Student installations are preferred when multiple installations are found.

Limitations:

- Automatic discovery is Windows-only in Phase 2.
- A custom installation outside the standard directories requires its `AWP_ROOT###` environment variable.
- A Student-looking directory proves only the installed distribution path. It does not prove the active license edition or entitlement.
- Discovery does not launch the executable and therefore cannot prove that Mechanical starts successfully.

## PyMechanical compatibility

The bridge pins `ansys-mechanical-core` to the supported `0.13.x` line. The compatibility gate follows the current official PyMechanical support statement:

- Python 3.12 through 3.14.
- Mechanical 2024 R2 (`v242`) or later.
- Windows for this bridge implementation.

Sources:

- [PyMechanical installation guide](https://mechanical.docs.pyansys.com/version/stable/getting_started/installation.html)
- [PyMechanical project compatibility](https://github.com/ansys/pymechanical)
- [PyMechanical known issues and limitations](https://mechanical.docs.pyansys.com/version/stable/kil/index.html)

`COMPATIBLE` means only that the detected versions fall within this documented range. It is not proof that a license is available, that the installed service pack supports the selected transport, or that an engineering analysis is valid.

## Verified connection test

The browser's **Gerçek bağlantıyı test et** action calls `POST /bridge/v1/connection/test`. The adapter then:

1. Re-runs installation and compatibility checks.
2. Confirms that a TCP listener exists at `127.0.0.1:<port>`.
3. Connects with PyMechanical `connect_to_mechanical()` using WNUA.
4. Calls `verify_valid_connection()`.
5. Queries `get_product_info()` and requires an `Ansys Mechanical` identity.
6. Reads the process version and requires it to match one of the locally detected installations.

Only after all six checks pass is `processVerified: true` returned. A listener alone, an optimizer/library success flag, or an installation directory can never produce a successful connection state. The result records the verification time, loopback endpoint, process version, and bounded product information. Raw exception text is not returned to the browser because it can contain local or license-server details.

The test does not retain a simulation session, mutate Mechanical state, or call any analysis API. `simulationsEnabled` remains `false` for every response.

## Starting the two local processes

Install dependencies:

```powershell
uv sync --all-packages --all-extras --dev
```

Start the MSKU bridge:

```powershell
npm run ansys-bridge:dev
```

Copy the printed token into **ANSYS YEREL**. The bridge is available at `http://127.0.0.1:8765`.

The bridge does not start Mechanical. If the engineer explicitly chooses to start a licensed Mechanical gRPC process, use a separate terminal and select the installed revision:

```powershell
uv run --package msku-ansys-bridge ansys-mechanical --revision 261 --port 10000 --transport-mode wnua
```

Replace `261` with the detected revision. Starting Mechanical can consume a license and can take significant time. The user remains responsible for accepting Ansys terms, selecting an entitled license, and closing the process.

Optional bridge configuration:

| Environment variable | Default | Constraint |
| --- | --- | --- |
| `MSKU_ANSYS_BRIDGE_TOKEN` | Random value from launcher | Minimum 32 characters |
| `MSKU_ANSYS_BRIDGE_ALLOWED_ORIGINS` | Local Vite/preview and official production origins | Exact comma-separated origins |
| `MSKU_ANSYS_MECHANICAL_PORT` | `10000` | Local port `1024`–`65535` |
| `MSKU_ANSYS_CONNECTION_TIMEOUT_SECONDS` | `8` | `1`–`30` seconds |

Do not commit tokens or license-server data to the repository.

## HTTP contract

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| `GET` | `/bridge/v1/health/live` | Loopback socket + allowed Origin | Minimal bridge liveness |
| `GET` | `/bridge/v1/health/ready` | Loopback + Origin + token | Bridge/adapter readiness; never simulation readiness |
| `GET` | `/bridge/v1/status` | Loopback + Origin + token | Installation, compatibility, and last verified-process result |
| `POST` | `/bridge/v1/connection/test` | Loopback + Origin + token | Explicit non-simulation test of an existing Mechanical process |

There are no model, job, solve, upload, arbitrary-script, filesystem-write, or result endpoints.

## Student automation and licensing limitations

As of the Phase 2 implementation date, the official Ansys Student page lists a 128K structural node/element limit, no geometry export, and restricted HPC resources. Ansys Student licenses are time-limited and must be renewed with a current release. Exact entitlements can change by release, product, and academic program.

The free Student download and other academic programs have different terms and limits. Academic usage is restricted to the applicable educational/non-commercial scope. Formula Student teams with an Ansys Student Team Partnership or institutional research license must follow the terms for that specific entitlement rather than assuming free Student limits.

Sources:

- [Current Ansys Student download and limits](https://www.ansys.com/academic/students/ansys-student)
- [Ansys academic usage terms](https://www.ansys.com/legal/terms-and-conditions/academic-usage)
- [PyMechanical launching and existing-process connection](https://mechanical.docs.pyansys.com/version/stable/getting_started/running_mechanical.html)
- [PyMechanical connection verification API](https://mechanical.docs.pyansys.com/version/stable/api/ansys/mechanical/core/mechanical/Mechanical.html)

The bridge does not inspect the license file, infer commercial/Student entitlement from product text, bypass license checks, or claim that automation is permitted for a particular team. A successful connection proves only that the local Mechanical process responded through PyMechanical at that time.

## Verification coverage and remaining work

Automated tests cover Student path/version discovery, environment-variable discovery, broken candidates, non-Windows suppression, compatibility boundaries, closed ports, rejected verification, unexpected product identity, process-version mismatch, sanitized license/authentication errors, token/origin/socket security, Private Network Access preflight, API serialization, browser contract rejection, and explicit UI connection flow.

No real ANSYS installation or license is available in CI. Success-path tests use a strict fake at the adapter boundary and cannot be cited as evidence of real ANSYS operation. A real successful connection must be produced only on a machine where the endpoint verifies an actual Mechanical process. Structural simulation remains future work and requires its own input schema, unit/coordinate contract, solver lifecycle, result provenance, failure containment, and independent verification.
