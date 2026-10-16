import type {
  BicycleSample,
  CornerId,
  FullCarSample,
  Project,
  Vec3,
} from "@msku/contracts";

import type { VehicleViewMode } from "../store/workspace";

export const CORNER_IDS: readonly CornerId[] = [
  "front_left",
  "front_right",
  "rear_left",
  "rear_right",
];

export const cornerIndex = (cornerId: CornerId): number => CORNER_IDS.indexOf(cornerId);

export const cornerWheelPosition = (project: Project, cornerId: CornerId): Vec3 => {
  const front = cornerId.startsWith("front");
  const left = cornerId.endsWith("left");
  const suspension = project.vehicle.corners[cornerId].suspension;
  const staticCentre = suspension.hardpoints.find((point) => point.id === "wheel_center")?.position;
  if (!staticCentre) throw new Error(`Corner ${cornerId} is missing wheel_center.`);
  return {
    x: (front ? 1 : -1) * project.vehicle.wheelbaseM / 2,
    y: (left ? 1 : -1) * (front ? project.vehicle.frontTrackM : project.vehicle.rearTrackM) / 2,
    z: staticCentre.z,
  };
};

export const cornerPointToVehicle = (
  project: Project,
  cornerId: CornerId,
  point: Vec3,
): Vec3 => {
  const suspension = project.vehicle.corners[cornerId].suspension;
  const staticCentre = suspension.hardpoints.find((item) => item.id === "wheel_center")?.position;
  if (!staticCentre) throw new Error(`Corner ${cornerId} is missing wheel_center.`);
  const targetCentre = cornerWheelPosition(project, cornerId);
  return {
    x: targetCentre.x + point.x - staticCentre.x,
    y: targetCentre.y + point.y - staticCentre.y,
    z: point.z,
  };
};

export const visibleCornerIds = (
  mode: VehicleViewMode,
  activeCornerId: CornerId,
): readonly CornerId[] => {
  if (mode === "front_axle") return ["front_left", "front_right"];
  if (mode === "rear_axle") return ["rear_left", "rear_right"];
  if (mode === "active_corner" || mode === "kinematics") return [activeCornerId];
  if (mode === "chassis_cg") return [];
  return CORNER_IDS;
};

export const fullCarVisualState = (sample?: FullCarSample): {
  bodyHeaveM: number;
  pitchRad: number;
  rollRad: number;
  unsprungDisplacementsM: [number, number, number, number];
} => ({
  bodyHeaveM: sample?.bodyHeaveM ?? 0,
  pitchRad: sample?.pitchRad ?? 0,
  rollRad: sample?.rollRad ?? 0,
  unsprungDisplacementsM: sample
    ? [...sample.unsprungDisplacementsM] as [number, number, number, number]
    : [0, 0, 0, 0],
});

export const integratedYawRad = (samples: BicycleSample[], selectedIndex: number): number => {
  let yaw = 0;
  for (let index = 1; index <= Math.min(selectedIndex, samples.length - 1); index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    yaw += 0.5 * (previous.yawRateRadps + current.yawRateRadps) * (current.timeS - previous.timeS);
  }
  return yaw;
};
