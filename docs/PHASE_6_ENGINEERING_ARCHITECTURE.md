# Phase 6 engineering architecture

Date: 2026-10-16  
Application version: `0.6.0`  
Project schema: `2.0.0`  
Report package version: `6.0.0`

## Purpose and safety boundary

Phase 6 turns the verified model workspaces into a four-corner engineering workflow. It does not add
an unverified physics model. Rendering consumes stored geometry or accepted solver samples; it is
never the source of a kinematic or dynamic result. The bundled vehicle remains synthetic,
`UNVALIDATED_PHYSICALLY`, and `NOT_APPROVED`.

## Four-corner project model

`vehicle.corners` contains exactly `front_left`, `front_right`, `rear_left`, and `rear_right`.
Every corner stores its own double-wishbone hardpoints, wheel/alignment inputs, optional actuation,
source class, derivation source, and provenance note. Front and rear configurations can be edited
independently. The active editor snapshot in `project.suspension` must exactly equal
`vehicle.corners[activeCornerId].suspension`; both Zod and Pydantic reject an inconsistent snapshot.

Vehicle-level data contains wheelbase, separate front/rear track, configured CG, nullable mass and
inertia values, and a provenance note. Values use the existing right-handed vehicle frame and SI
storage convention:

- `+X`: forward;
- `+Y`: vehicle left;
- `+Z`: up;
- length: metres;
- angle: radians.

The bundled rear-left geometry is an independent synthetic definition and is numerically different
from the front-left fixture. The bundled right corners are explicit mirror assumptions and carry
`geometrySource: mirrored_assumption` plus `derivedFrom`. No mirrored corner is presented as measured
or independently solved data.

## Schema migration

The browser accepts project `1.0.0` and `2.0.0`; new exports are always `2.0.0`. Migration is atomic:

1. parse and validate the complete legacy object;
2. preserve the original suspension object as the active source corner;
3. create the opposite side only as a labeled mirror assumption;
4. create missing rear corners from labeled synthetic demonstration definitions;
5. reset physical validation and engineering approval;
6. record `migratedFromSchemaVersion` and a migration note;
7. leave the legacy local-storage record untouched until the user explicitly saves.

The API accepts both project versions so older analysis clients continue to function. API result
contracts remain `1.0.0`; project-file and API-response versions are deliberately separate constants.

## Vehicle placement and reusable corner assembly

`VehicleCornerAssembly` renders one supplied corner definition. The target static wheel-centre
position is

```text
x = +wheelbase/2 for front, -wheelbase/2 for rear
y = +track/2 for left,      -track/2 for right
z = stored static wheel-centre z
```

For any stored or solved corner point `p`, with that corner's stored static wheel centre `w0` and
target centre `W`, full-vehicle placement is

```text
P.x = W.x + p.x - w0.x
P.y = W.y + p.y - w0.y
P.z = p.z
```

This preserves every local link vector and avoids scaling geometry when wheelbase or track changes.
The wheel torus is oriented from the stored static camber/toe axis or the accepted kinematics
`wheelAxis`. Wheel dimensions remain the corner's stored radius and width.

The chassis is intentionally a labeled reference envelope. Axle lines, centreline, ground plane,
and CG are references; no chassis tube, attachment, pushrod, rocker, spring, or damper location is
invented.

## View and state architecture

The full-vehicle workspace supports full vehicle, front axle, rear axle, active corner, chassis/CG,
suspension, kinematics playback, and dynamics playback. Camera presets are perspective, isometric,
front, rear, side, and top. Wheel, hardpoint, chassis, reference-plane, and label visibility is held
in the workspace store and survives view changes. View changes never mutate project engineering data.

Stable DOM scene-manifest identifiers expose all four assemblies to browser tests:

- `wheel-assembly-front-left`;
- `wheel-assembly-front-right`;
- `wheel-assembly-rear-left`;
- `wheel-assembly-rear-right`.

Each identifier also publishes its calculated static `x`, `y`, and `z` target for regression checks.

## Solver-driven visualization

### Corner kinematics

The kinematics store records the corner ID that produced the accepted sweep. Full-vehicle playback
applies a pose only when that ID equals the active corner and the selected state is
`VERIFIED_NUMERICALLY`. Other corners are neither copied nor inferred. An absent, failed, stale, or
different-corner result produces a visible blocking explanation.

### Full-car ride

Accepted Phase 5 sample fields drive the scene directly:

- `bodyHeaveM` translates the reference body in `+Z`;
- `pitchRad` rotates it about vehicle `+Y`;
- `rollRad` rotates it about vehicle `+X`;
- `unsprungDisplacementsM[0..3]` move FL, FR, RL, and RR wheels in the documented `cornerOrder`.

The 7DOF model has no suspension-link closure states. During this playback the links and hardpoints
are hidden, with an explicit explanation, instead of being stretched or animated arbitrarily.

### Bicycle handling

Front wheel steering uses the solver-returned `steeringRad`. Display heading is obtained only by
trapezoidal integration of returned yaw rate:

```text
psi[k] = psi[k-1] + 0.5 * (r[k-1] + r[k]) * (t[k] - t[k-1])
```

It is labeled as derived visualization. No tire deformation, suspension movement, roll, trajectory,
or load-transfer animation is inferred from the bicycle result.

## Reports and validation workflow

The comparison module reads two independently stored corner definitions and reports exact source,
derivation, alignment, rigid-link-length, and hardpoint-coordinate differences. It does not create a
second solver result from the currently retained sweep. Cross-corner calculated-result comparison is
therefore blocked until independent results for both selected corners can be retained and traced.

The reports module builds an immutable report snapshot containing project metadata, versions,
coordinate frame, units, all four corner inputs and provenance, vector geometry diagrams, available
accepted-result plots, solver versions, input hashes, warnings, limitations, evidence records, and
approval state. Outputs are direct PDF summary, CSV, JSON, and a print/PDF layout with vector diagrams.
Every output carries `NOT_APPROVED`; a failed result may be documented diagnostically but is never
exported as an approved engineering result.

The validation module records numerical benchmark, CAD comparison, physical measurement, and input
provenance evidence with source, time, notes, and review state. Evidence records never automatically
change physical status or approval. The schema fixes these to `UNVALIDATED_PHYSICALLY` and
`NOT_APPROVED`; changing that gate requires a future controlled human approval workflow with
independent evidence.

## Failure boundaries

- malformed, incomplete, future-version, or internally inconsistent projects are rejected atomically;
- a four-corner vehicle must contain exactly four consistent keys/IDs;
- an explicit mirror must name its source;
- unsupported playback stays static and displays the reason;
- failed dynamics responses clear the shared accepted-result state;
- report packages label missing results and validation gaps;
- no software action grants engineering approval.

