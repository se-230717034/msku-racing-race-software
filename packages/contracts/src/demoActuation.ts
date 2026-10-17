import type { ActuationGeometry, Suspension, Vec3 } from "./index";

const point = (suspension: Suspension, id: string): Vec3 => {
  const hardpoint = suspension.hardpoints.find((item) => item.id === id);
  if (!hardpoint) throw new Error(`Synthetic actuation requires hardpoint ${id}.`);
  return hardpoint.position;
};

const distance = (first: Vec3, second: Vec3): number => Math.hypot(
  first.x - second.x,
  first.y - second.y,
  first.z - second.z,
);

/**
 * Creates visualization-only pushrod geometry for the packaged demonstration
 * project. It is never applied to imported/team projects and is not CAD data.
 */
export const createSyntheticDemoActuation = (suspension: Suspension): ActuationGeometry => {
  const side = suspension.corner.endsWith("left") ? 1 : -1;
  const upperFront = point(suspension, "uca_front_inboard");
  const upperRear = point(suspension, "uca_rear_inboard");
  const lowerOutboard = point(suspension, "lca_outboard");
  const pivot = {
    x: (upperFront.x + upperRear.x) / 2,
    y: (upperFront.y + upperRear.y) / 2,
    z: Math.max(upperFront.z, upperRear.z) + 0.08,
  };
  const uprightPickup = {
    x: lowerOutboard.x,
    y: lowerOutboard.y - side * 0.025,
    z: lowerOutboard.z + 0.065,
  };
  const rockerPushrodPickup = {
    x: pivot.x,
    y: pivot.y + side * 0.055,
    z: pivot.z - 0.035,
  };
  const rockerSpringPickup = {
    x: pivot.x,
    y: pivot.y - side * 0.05,
    z: pivot.z + 0.03,
  };
  const springChassisPickup = {
    x: pivot.x - 0.01,
    y: pivot.y - side * 0.265,
    z: pivot.z + 0.04,
  };
  return {
    type: "pushrod",
    uprightPickup,
    rockerPushrodPickup,
    rockerSpringPickup,
    rockerAxisStart: { x: pivot.x - 0.06, y: pivot.y, z: pivot.z },
    rockerAxisEnd: { x: pivot.x + 0.06, y: pivot.y, z: pivot.z },
    springChassisPickup,
    springFreeLengthM: distance(rockerSpringPickup, springChassisPickup),
    springRateNPerM: 30_000,
    springPreloadN: 0,
  };
};
