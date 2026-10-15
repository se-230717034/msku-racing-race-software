# Coordinates and units

## Vehicle frame

The persisted project uses one right-handed vehicle coordinate frame:

- origin: project-defined vehicle reference; the demo uses an arbitrary chassis datum
- `+X`: vehicle forward
- `+Y`: vehicle left
- `+Z`: upward
- cross product: `X × Y = Z`

The demonstration corner is `front-left`. A display-only right-side mirror applies `(x, y, z) -> (x, -y, z)`. Mirroring does not mutate the project.

## Three.js mapping

Three.js uses its Y axis as screen-up. Rendering maps vehicle coordinates to `(X_three, Y_three, Z_three) = (x, z, -y)`. This is a visualization transform only; stored data stays in the vehicle frame.

## Wheel frame

At the static demo pose, the wheel spin axis is parallel to vehicle `Y`. Camber and toe are not yet calculated. Phase 2 must define an upright/wheel orientation basis from non-collinear reference points before those quantities are displayed.

## Units

| Quantity | Internal/API unit | Phase 1 UI |
|---|---:|---:|
| position, length, radius, width | metre (`m`) | millimetre (`mm`) |
| angle (future) | radian (`rad`) | degree (`deg`) where labeled |
| force (future) | newton (`N`) | newton (`N`) |
| mass (future) | kilogram (`kg`) | kilogram (`kg`) |
| time (future) | second (`s`) | second (`s`) |

Conversions occur at input/output boundaries. No unitless engineering result may be added to the interface.

