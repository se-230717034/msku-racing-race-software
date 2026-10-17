import type { ActuationGeometry, KinematicPose, Vec3 } from "@msku/contracts";

const EPSILON = 1e-10;
const RESIDUAL_TOLERANCE_M = 1e-7;
const MAX_ROCKER_ROTATION_RAD = 2 * Math.PI / 3;

const add = (first: Vec3, second: Vec3): Vec3 => ({
  x: first.x + second.x,
  y: first.y + second.y,
  z: first.z + second.z,
});
const subtract = (first: Vec3, second: Vec3): Vec3 => ({
  x: first.x - second.x,
  y: first.y - second.y,
  z: first.z - second.z,
});
const scale = (value: Vec3, factor: number): Vec3 => ({
  x: value.x * factor,
  y: value.y * factor,
  z: value.z * factor,
});
const dot = (first: Vec3, second: Vec3): number => (
  first.x * second.x + first.y * second.y + first.z * second.z
);
const cross = (first: Vec3, second: Vec3): Vec3 => ({
  x: first.y * second.z - first.z * second.y,
  y: first.z * second.x - first.x * second.z,
  z: first.x * second.y - first.y * second.x,
});
const norm = (value: Vec3): number => Math.hypot(value.x, value.y, value.z);
const normalize = (value: Vec3): Vec3 | undefined => {
  const length = norm(value);
  return length > EPSILON ? scale(value, 1 / length) : undefined;
};
const distance = (first: Vec3, second: Vec3): number => norm(subtract(first, second));
const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

export const rotateAroundAxis = (
  point: Vec3,
  axisStart: Vec3,
  axisEnd: Vec3,
  angleRad: number,
): Vec3 | undefined => {
  const axis = normalize(subtract(axisEnd, axisStart));
  if (!axis) return undefined;
  const relative = subtract(point, axisStart);
  const cosine = Math.cos(angleRad);
  const sine = Math.sin(angleRad);
  const rotated = add(
    add(scale(relative, cosine), scale(cross(axis, relative), sine)),
    scale(axis, dot(axis, relative) * (1 - cosine)),
  );
  return add(axisStart, rotated);
};

export const transformUprightPoint = (
  point: Vec3,
  wheelCenter: Vec3,
  pose?: KinematicPose,
): Vec3 => {
  if (!pose) return { ...point };
  const rotationMagnitude = norm(pose.rotationVector);
  let rotatedRelative = subtract(point, wheelCenter);
  if (rotationMagnitude > EPSILON) {
    const axis = scale(pose.rotationVector, 1 / rotationMagnitude);
    const cosine = Math.cos(rotationMagnitude);
    const sine = Math.sin(rotationMagnitude);
    rotatedRelative = add(
      add(scale(rotatedRelative, cosine), scale(cross(axis, rotatedRelative), sine)),
      scale(axis, dot(axis, rotatedRelative) * (1 - cosine)),
    );
  }
  return add(add(wheelCenter, pose.translation), rotatedRelative);
};

export interface SolvedActuationKinematics {
  status: "SOLVED";
  rockerAngleRad: number;
  rockerAxisStart: Vec3;
  rockerAxisEnd: Vec3;
  rockerPivot: Vec3;
  uprightPickup: Vec3;
  rockerPushrodPickup: Vec3;
  rockerCoiloverPickup: Vec3;
  chassisCoiloverPickup: Vec3;
  pushrodLengthM: number;
  coiloverLengthM: number;
  pushrodResidualM: number;
}

export interface FailedActuationKinematics {
  status: "FAILED";
  reason: string;
}

export type ActuationKinematicsResult = SolvedActuationKinematics | FailedActuationKinematics;

/** Solves the one-DOF rocker angle from a fixed-length pushrod constraint. */
export const solveActuationKinematics = (
  actuation: ActuationGeometry,
  staticWheelCenter: Vec3,
  pose?: KinematicPose,
): ActuationKinematicsResult => {
  const axis = normalize(subtract(actuation.rockerAxisEnd, actuation.rockerAxisStart));
  if (!axis) return { status: "FAILED", reason: "Rocker pivot axis has zero length." };

  const staticPushrodLength = distance(actuation.uprightPickup, actuation.rockerPushrodPickup);
  if (staticPushrodLength <= EPSILON) {
    return { status: "FAILED", reason: "Pushrod has zero static length." };
  }
  const currentUprightPickup = transformUprightPoint(
    actuation.uprightPickup,
    staticWheelCenter,
    pose,
  );
  const relative = subtract(actuation.rockerPushrodPickup, actuation.rockerAxisStart);
  const parallel = scale(axis, dot(relative, axis));
  const radial = subtract(relative, parallel);
  const radialLength = norm(radial);
  if (radialLength <= EPSILON) {
    return { status: "FAILED", reason: "Rocker pushrod pickup lies on the pivot axis." };
  }
  const tangent = cross(axis, radial);
  const circleCenter = add(actuation.rockerAxisStart, parallel);
  const offset = subtract(circleCenter, currentUprightPickup);
  const coefficientCos = 2 * dot(offset, radial);
  const coefficientSin = 2 * dot(offset, tangent);
  const target = staticPushrodLength ** 2 - dot(offset, offset) - radialLength ** 2;
  const amplitude = Math.hypot(coefficientCos, coefficientSin);
  if (amplitude <= EPSILON) {
    return { status: "FAILED", reason: "Pushrod constraint is singular at the rocker axis." };
  }
  const normalizedTarget = target / amplitude;
  if (normalizedTarget < -1 - 1e-9 || normalizedTarget > 1 + 1e-9) {
    return { status: "FAILED", reason: "Pushrod cannot reach the rocker circle at this wheel pose." };
  }
  const phase = Math.atan2(coefficientSin, coefficientCos);
  const opening = Math.acos(Math.max(-1, Math.min(1, normalizedTarget)));
  const candidates = [wrapAngle(phase + opening), wrapAngle(phase - opening)];
  const rockerAngleRad = candidates.reduce((best, candidate) => (
    Math.abs(candidate) < Math.abs(best) ? candidate : best
  ));
  if (Math.abs(rockerAngleRad) > MAX_ROCKER_ROTATION_RAD) {
    return { status: "FAILED", reason: "Rocker solution exceeds the supported physical branch." };
  }

  const rockerPushrodPickup = rotateAroundAxis(
    actuation.rockerPushrodPickup,
    actuation.rockerAxisStart,
    actuation.rockerAxisEnd,
    rockerAngleRad,
  );
  const staticCoiloverPickup = actuation.damper?.rockerPickup ?? actuation.rockerSpringPickup;
  const rockerCoiloverPickup = rotateAroundAxis(
    staticCoiloverPickup,
    actuation.rockerAxisStart,
    actuation.rockerAxisEnd,
    rockerAngleRad,
  );
  if (!rockerPushrodPickup || !rockerCoiloverPickup) {
    return { status: "FAILED", reason: "Rocker rotation could not be evaluated." };
  }
  const chassisCoiloverPickup = actuation.damper?.chassisPickup ?? actuation.springChassisPickup;
  const pushrodResidualM = Math.abs(
    distance(currentUprightPickup, rockerPushrodPickup) - staticPushrodLength,
  );
  if (!Number.isFinite(pushrodResidualM) || pushrodResidualM > RESIDUAL_TOLERANCE_M) {
    return { status: "FAILED", reason: "Pushrod closure residual exceeds tolerance." };
  }
  const coiloverLengthM = distance(rockerCoiloverPickup, chassisCoiloverPickup);
  if (!Number.isFinite(coiloverLengthM) || coiloverLengthM <= EPSILON) {
    return { status: "FAILED", reason: "Coilover length is invalid." };
  }
  return {
    status: "SOLVED",
    rockerAngleRad,
    rockerAxisStart: actuation.rockerAxisStart,
    rockerAxisEnd: actuation.rockerAxisEnd,
    rockerPivot: scale(add(actuation.rockerAxisStart, actuation.rockerAxisEnd), 0.5),
    uprightPickup: currentUprightPickup,
    rockerPushrodPickup,
    rockerCoiloverPickup,
    chassisCoiloverPickup,
    pushrodLengthM: staticPushrodLength,
    coiloverLengthM,
    pushrodResidualM,
  };
};
