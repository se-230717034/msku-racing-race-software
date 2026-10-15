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

The wheel stores explicit static camber and toe reference angles; the demonstration values are zero. At zero alignment, the outward wheel spin axis is `+Y` on the left and `-Y` on the right. The solved rigid-upright rotation carries that configured axis through wheel travel.

- positive camber: wheel top outward
- positive toe: toe-in on either side
- positive wheel travel: bump (`+Z` wheel-centre displacement in the chassis-fixed frame)

Caster is positive when the upper kingpin point is rearward of the lower point. KPI/SAI is positive when the upper kingpin point is inboard of the lower point. These definitions are applied consistently under left/right mirroring.

## Units

| Quantity | Internal/API unit | Phase 1 UI |
|---|---:|---:|
| position, length, radius, width | metre (`m`) | millimetre (`mm`) |
| angle | radian (`rad`) | degree (`deg`) where labeled |
| angle gradient vs travel | radian per metre (`rad/m`) | degree per 10 mm (`deg/10mm`) |
| force | newton (`N`) | newton (`N`) |
| moment | newton metre (`N*m`) | newton metre (`N·m`) |
| spring/wheel rate | newton per metre (`N/m`) | newton per millimetre (`N/mm`) where labeled |
| velocity | metre per second (`m/s`) | metre per second (`m/s`) |
| acceleration | metre per second squared (`m/s²`) | metre per second squared (`m/s²`) |
| mass | kilogram (`kg`) | kilogram (`kg`) |
| time (future) | second (`s`) | second (`s`) |

Conversions occur at input/output boundaries. No unitless engineering result may be added to the interface.

