# Coilover Spring–Damper Model

Status: solver `3.1.0`, numerically verified and physically unvalidated.

The model evaluates the existing solved pushrod–rocker geometry. It does not
move suspension hardpoints, estimate missing velocity, or modify the wheel
kinematics solution.

## Sign conventions and equations

- Wheel bump travel and wheel velocity are positive in compression.
- Coilover compression is `x = L_ref - L`.
- Motion ratio is `MR = dx / dz_wheel`, evaluated from three neighbouring,
  accepted kinematic states.
- Coilover compression velocity is `v_c = MR * v_wheel`. `v_wheel` is an
  explicit user input; browser frame time is never used as a velocity source.
- Spring force is `F_s = F_preload + k*x`.
- Damper generalized force is `F_d = -c(v_c)*v_c`, where `c` uses the declared
  compression coefficient for `v_c >= 0` and the rebound coefficient for
  `v_c < 0`.
- Total coilover axial force, positive when pushing the mounts apart, is
  `F_axial = F_s - F_d`.
- Generalized wheel force is `F_wheel = -F_axial*MR`.
- Stored spring energy relative to the reference state is
  `E = F_preload*x + 0.5*k*x^2`.

The calculation is rejected when the kinematic pose, rocker closure, damper
parameters, or declared minimum/maximum eye-to-eye length is invalid. A
compression-only spring is not allowed to return a tensile spring force.

## Demonstration inputs

The packaged vehicle uses explicitly synthetic values: `30,000 N/m` spring
rate, `350 N` preload, `1,200 N*s/m` compression damping, `1,800 N*s/m`
rebound damping, and `70 mm` total eye-to-eye travel around the static length.
They are stored in the Vehicle Parameter Manifest as `SYNTHETIC` and are not
MSKU Racing measurements, manufacturer data, or physical validation evidence.

## 3D coupling

The GLB mount eyes remain coincident with the geometrically solved rocker and
chassis pickups. Its axial scale follows the solved eye-to-eye length while its
radial scale remains tied to the static reference length, preventing the body
and spring diameter from growing with travel. Force and motion-ratio metadata
attached to the rendered coilover originate from the same selected state.

The model is one-way: suspension kinematics determine coilover displacement,
then the spring–damper model evaluates force. Compliance, friction, hysteresis,
gas pressure, bump stops, thermal fade, cavitation, digressive valving, and
force feedback into the kinematic constraints are not represented.
