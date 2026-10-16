# Phase 6 verification report

Date: 2026-10-16  
Scope: four-corner project/workflow integration, solver-driven visualization, reports, and evidence
management. This report does not claim CAD or physical vehicle validation.

## Acceptance summary

Phase 6 satisfies its software verification gate. All four assemblies are separately addressable,
front/rear geometries can differ, migration is lossless for the supplied legacy corner, solver
playback is gated by model support, and reports preserve provenance and unapproved status. The
bundled data remains synthetic and no MSKU Racing CAD or physical evidence was available.

## Test environment and gates

Executed from the repository root on Windows with Node.js/npm, Chromium Playwright, Python 3.12,
`uv`, Ruff, and mypy:

| Gate | Result |
|---|---:|
| Python pytest | 110 passed |
| Frontend Vitest | 37 passed |
| Chromium Playwright | 8 passed |
| Ruff | passed after line-length correction |
| mypy | passed |
| ESLint | passed after unused-import correction |
| TypeScript | passed |
| Production build | passed |

The production build reports only Vite's existing large-chunk advisory; it is not a compilation or
runtime failure. Playwright owns both the web and API test servers so the browser suite is
reproducible without a manually started API.

## Quantitative geometry checks

The synthetic fixture declares:

| Quantity | Configured | Reconstructed from wheel assembly positions | Discrepancy |
|---|---:|---:|---:|
| Wheelbase | 1.600000000000 m | 1.600000000000 m | below JS test tolerance (`1e-10 m`) |
| Front track | 1.440000000000 m | 1.440000000000 m | below JS test tolerance (`1e-10 m`) |
| Rear track | 1.400000000000 m | 1.400000000000 m | below JS test tolerance (`1e-10 m`) |

The test also requires four unique `(x,y,z)` wheel-centre tuples. This is a software-coordinate
identity check, not a measurement-accuracy result. No claim of zero manufacturing or physical error
is made.

For every corner, mapping its stored `wheel_center` through the full-vehicle transform must equal the
configured target exactly under JavaScript object comparison for the bundled finite decimal inputs.
Front-left and rear-left hardpoint arrays are explicitly required to differ. Right-side sources must
be labeled `mirrored_assumption`.

## Schema and migration checks

Automated tests verify:

1. a `2.0.0` project round-trips through JSON and local storage;
2. a `1.0.0` project loads from the legacy storage key;
3. the legacy suspension is unchanged after migration;
4. the legacy record is not overwritten during load;
5. the opposite corner is labeled as a mirror assumption;
6. missing corners are labeled synthetic;
7. future versions are rejected;
8. active snapshot and selected vehicle corner remain identical after edits;
9. API validation accepts consistent `2.0.0` and rejects a missing corner;
10. the legacy API request path remains accepted.

## Independent corner and UI-state checks

The workspace regression edits front-left and rear-left `uca_outboard.x` to different values, switches
corner and view state, and verifies both values remain independent. The untouched front-right input
remains unchanged. Camera, visibility, and view-mode changes are checked against a byte-equivalent
project JSON snapshot to detect unintended data mutation.

Chromium repeats the user-facing corner-switch/edit flow and confirms that an unsolved rear-left
kinematics view displays a blocking explanation instead of a mirrored front result.

## Solver playback checks

- The full-car mapping test supplies four deliberately different unsprung histories
  `[+0.001, -0.002, +0.003, -0.004] m` and verifies all four are returned unchanged with the supplied
  heave, pitch, and roll values.
- An absent dynamics sample returns exactly zero display displacement; no sinusoid or arbitrary
  animation is generated.
- Bicycle yaw integration is checked against an independently calculated trapezoidal case:
  rates `[0, 2, 2] rad/s` at `[0, 1, 2] s` produce `3 rad` display heading.
- Kinematics playback requires a matching `solvedCornerId` and accepted state.
- Failed Phase 5 responses clear the stored accepted result and therefore cannot drive the scene.

The above proves data-path correctness within the stated model outputs. It does not prove physical
vehicle motion fidelity.

## Report and safety checks

Report tests require:

- all four corners and their source/provenance;
- physical-correlation and mirror-assumption limitations;
- `NOT_APPROVED` in CSV and PDF;
- `UNVALIDATED_PHYSICALLY` in PDF;
- a valid `%PDF-1.4` header and cross-reference trailer;
- JSON-safe complete report objects.

Chromium verifies the reports and validation workspaces, PDF control, geometry-diagram section,
disabled approval action, evidence-record creation, and unchanged physical status after adding a
record. The same workflow checks that the comparison module exposes exact rigid-link differences and
shows a blocking explanation when no independently retained corner sweeps are available.

## Regression evidence

All prior geometry, kinematics, quasi-static, quarter-car, full-car, bicycle, and optimization unit,
API, contract, and browser tests pass. No Phase 2–5 solver equations were replaced by rendering logic.
The only numerical-core change extends the existing left/right sign selection to rear corner IDs by
using the corner side suffix; all prior front-corner benchmarks remain green.

## Remaining risks and required external evidence

- No actual MSKU Racing four-corner hardpoint set, mass properties, CAD assembly, motion study,
  corner-weight record, damper dyno, rig response, or track response was supplied.
- The wireframe chassis is not a structural model.
- Right-side demo geometry is an explicit mirror assumption.
- Full-car ride does not close suspension links during motion.
- Bicycle visualization is limited to input steer and integrated yaw heading.
- Direct PDF is a traceable textual summary; the print/PDF workflow carries the vector diagrams and
  plot preview.
- Local storage has no authentication, revision history, electronic signatures, or multi-user
  conflict resolution.
- Evidence acceptance is a record, not a cryptographic signature or approval authority.

Before design release, import controlled team data, attach independent CAD and physical comparisons
with measurement uncertainty, review discrepancies, and obtain human engineering sign-off outside
this software.

