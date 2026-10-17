# GLB suspension model integration report

Updated: 2026-10-17

## Scope and safety boundary

Six user-supplied GLB files were inspected and integrated into the existing Three.js render path. No Python engineering code, hardpoint coordinate, solver equation, API model, or calculated result was changed.

Imported meshes are visualization assets. They are not manufacturing CAD, dimensional inspection evidence, mass-property data, or physical-correlation evidence. The application scales them to the configured wheel dimensions and current hardpoint span only for visual assembly.

## Asset audit

| File | Size | Scene contents | Audited transformed bounds | Source pivot / axis finding | Integration decision |
| --- | ---: | --- | --- | --- | --- |
| `wheel.glb` | 3,239,628 B | Tire, wheel/rim, caliper and disc nodes | 0.3112 × 0.7561 × 0.7561 source metres | Axle is source X; centre approximately (0.01024, 0, 0) | Only tire and rim nodes are rendered. Embedded caliper/disc are suppressed to prevent duplicates. Radial and axial scales follow project wheel radius/width. |
| `brake.glb` | 6,846,540 B | Separate rotor and caliper meshes | Rotor diameter 0.3249 m; complete assembly 0.1067 × 0.3249 × 0.3387 m | Axle is source X; rotor centre approximately (-0.01860, 0.00287, 0.00037) | Rotor and caliper remain separately visible. Assembly is centred on the calculated wheel centre and oriented by the wheel-axis quaternion. |
| `coilover.glb` | 2,150,592 B | 13 named meshes including spring, body, shaft, bump stop, seats, lock nuts, and upper/lower mounts | 0.1072 × 0.3933 × 0.1072 m | Long axis is source Y; audited lower/upper mount centres are Y=-0.03261 m and Y=0.30265 m (0.33527 m apart) | Mount centres are mapped to declared damper endpoints, or declared spring endpoints when no damper is supplied. With no actuation geometry, it is shown separately as `UNMOUNTED_COMPONENT_PREVIEW` and never drives physics. |
| `hub.glb` | 1,488,164 B | One merged wheel-hub mesh | 44.9802 × 44.9605 × 40.0000 source units | Axle is source Z; source unit is not documented | Normalized to a hub radius/width derived from the configured wheel envelope. It is not treated as metre-scale vehicle data. |
| `upright.glb` | 21,256 B | One rear-knuckle mesh | 0.1800 × 0.2588 × 0.1864 m | Source scene has a large offset pivot near (10.3034, 0.5226, -12.0507); longest axis is Y | Re-centred, aligned to the live upper/lower outboard axis and wheel axis, scaled to 98% of the current kingpin span, narrowed to 68% longitudinally/52% axially to avoid false brake/tyre overlap, and mirrored for right corners. |
| `suspension.glb` | 7,040,416 B | 13 meshes under generic Blender/Collada node names | 212.9690 × 38.0809 × 291.1706 undocumented source units | No semantic nodes identify UCA/LCA/tie-rod/pushrod endpoints | Not used as solved suspension geometry. It is available only in the existing default-off, static, unsupported representative-actuation layer. |

The bundled demonstration wheel is radius 0.2286 m and width 0.18 m. Therefore `wheel.glb`, whose source radius is about 0.3780 m and width about 0.3095 m, is rendered with approximately 0.6047 radial and 0.5817 axial scale in the default project. These values prove the source model does not directly match the demonstration vehicle dimensions. They do not establish the dimensions of a real MSKU Racing car.

## Runtime assembly

- The original hardpoint-driven wishbones, steering rod, bushings, and rod ends remain active because the imported suspension file has no reliable endpoint semantics.
- The GLB upright, hub, rotor, caliper, rim, and tire share the current wheel centre and accepted wheel-axis quaternion.
- The coilover uses each corner's explicit `damper.rockerPickup`/`damper.chassisPickup` when available, falling back to explicit spring pickups. Because rocker closure is not solved, declared endpoints are shown as static geometry and never claimed as a solved motion result.
- The bundled demonstration project has no actuation geometry. In that project all four coilovers load by default but remain visibly separated from the mechanism, static, and marked `UNMOUNTED_COMPONENT_PREVIEW`. The UI lists the missing upright pickup, rocker pickup/axis, and chassis damper points.
- A mechanically mounted coilover requires corner-specific `uprightPickup`, `rockerPushrodPickup`, `rockerSpringPickup`, `rockerAxisStart`, `rockerAxisEnd`, and `springChassisPickup`; a separately located damper also requires `damper.rockerPickup` and `damper.chassisPickup`. None of these points exist in the bundled demonstration geometry.
- A low-opacity carrier panel is generated from the existing UCA/LCA/tie-rod inboard hardpoints so the inboard joints can be inspected without floating visually. It is explicitly labeled as a visual pickup reference rather than chassis CAD.
- Upright orientation is constructed from the live upper/lower outboard axis plus the accepted wheel axis.
- FL, FR, RL, and RR each use their own project geometry. Right-hand assemblies receive an explicit handedness mirror in addition to their corner-specific wheel-axis orientation.
- Accepted kinematic poses update the active corner exactly through the existing `positionFor` and `wheelQuaternion` render inputs.
- Full-car unsprung displacement and supported steering visualization continue through the existing wheel position/orientation path.
- The embedded brake nodes in `wheel.glb` are always hidden; only the separate `brake.glb` rotor and caliper are used. Procedural wheel/brake/upright parts are suppressed while GLB mode is active.
- GLTFLoader caching shares source geometry and textures between four corners. Scene nodes and materials are cloned per corner for independent visibility, handedness, opacity, and shadow settings.

## Loading and performance

- The active wheel/brake/hub/upright/coilover set is 13,746,180 bytes (about 13.1 MiB) before HTTP transfer compression. It is loaded once and reused across all four corners through the GLTF loader cache.
- `suspension.glb` adds 7,040,416 bytes (about 6.7 MiB) only when the default-off representative-actuation layer is enabled.
- A procedural assembly is shown as the Suspense fallback while imported assets load, so a slow transfer never appears as an empty vehicle.
- The production build retains Vite's existing large JavaScript chunk warning. The imported binary assets are emitted as public static files rather than duplicated inside the JavaScript bundle.

## User controls

The Turkish `3B model kaynağı` control switches between:

- `GLB modeller`: imported parts plus hardpoint-driven procedural links;
- `Prosedürel`: the complete previous procedural assembly.

Existing tire, rim, brake disc, caliper, hub, upright, wishbone, and tie-rod visibility controls apply to both modes. `Mekanik Montaj` continues to hide the tire and rim while exposing the suspension and brake group.

## Attribution recorded from GLB metadata

All six files declare CC BY 4.0 metadata:

- `brake.glb`: “Disc Brakes and Caliper”, author `l-odin`, Sketchfab asset `7c45d5572faa46a491a45675b0dc8d0c`.
- `coilover.glb`: “[Free] Coilover Shock Absorber Damper”, author `Robert Prispilović`, Sketchfab asset `92e61757780840a683abdd38c4e8a700`.
- `hub.glb`: “WHEEL HUB ASSEMBLY”, author `vr.designer_09`, Sketchfab asset `4234fdc248af45d18d127e9ae5fef7ca`.
- `suspension.glb`: “Formula E Push rod Suspension”, author `Aashutosh Dabhade`, Sketchfab asset `52149ab2d93548e2a06ae60b888ac66f`.
- `upright.glb`: “Rear suspension knuckle of Dubina Evo”, author `Dubina`, Sketchfab asset `af5cd571f5104da5b352487db66dbf22`.
- `wheel.glb`: “Car wheel with brake disc - Low poly”, author `Márcio Meireles`, Sketchfab asset `5b9bb83857674cd5a866f35fbf7fe8d4`.

License: `CC-BY-4.0`, as declared inside each supplied GLB. This report preserves the authorship and source identifiers supplied with the assets.

## Remaining limitations

- No model was compared to MSKU Racing production CAD or a measured component.
- `upright.glb` is a generic rear knuckle, not a dimensionally verified Formula Student upright.
- `coilover.glb` is a generic 335.27 mm mount-centre assembly; its fit, stroke, spring rate, damping, and package clearances are not verified for an MSKU Racing vehicle.
- The hub source unit is unknown.
- Imported mesh mass, inertia, stiffness, clearances, fastener grades, and material properties are not used by any calculation.
- Visual intersection or apparent clearance is not a packaging/kinematic-clearance result.
- The generic `suspension.glb` cannot be mapped to the current solver without independently identified endpoints; it remains an explicitly unsupported static reference.
