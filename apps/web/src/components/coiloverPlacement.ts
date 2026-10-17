import type { ActuationGeometry, Vec3 } from "@msku/contracts";

import type { ThreePosition } from "./ProceduralCadAssembly";

export interface CoiloverPlacement {
  start: ThreePosition;
  end: ThreePosition;
  status: "DECLARED_STATIC_GEOMETRY" | "UNMOUNTED_COMPONENT_PREVIEW";
}

const unmountedCoiloverPreviewPlacement = (
  positionFor: (id: string) => ThreePosition,
): CoiloverPlacement => {
  const inboardIds = ["uca_front_inboard", "uca_rear_inboard", "lca_front_inboard", "lca_rear_inboard"];
  const inboards = inboardIds.map(positionFor);
  const chassisCentre: ThreePosition = [
    inboards.reduce((sum, point) => sum + point[0], 0) / inboards.length,
    inboards.reduce((sum, point) => sum + point[1], 0) / inboards.length,
    inboards.reduce((sum, point) => sum + point[2], 0) / inboards.length,
  ];
  const maximumHeight = Math.max(...inboards.map((point) => point[1]));
  const previewLength = 0.22;
  const previewHeight = maximumHeight + 0.08;
  return {
    start: [chassisCentre[0] - previewLength / 2, previewHeight, chassisCentre[2]],
    end: [chassisCentre[0] + previewLength / 2, previewHeight, chassisCentre[2]],
    status: "UNMOUNTED_COMPONENT_PREVIEW",
  };
};

const declaredCoiloverPlacement = (
  actuation: ActuationGeometry | undefined,
  pointFor: ((point: Vec3) => ThreePosition) | undefined,
): CoiloverPlacement | undefined => {
  if (!actuation || !pointFor) return undefined;
  const rockerPickup = actuation.damper?.rockerPickup ?? actuation.rockerSpringPickup;
  const chassisPickup = actuation.damper?.chassisPickup ?? actuation.springChassisPickup;
  return {
    start: pointFor(rockerPickup),
    end: pointFor(chassisPickup),
    status: "DECLARED_STATIC_GEOMETRY",
  };
};

export const resolveCoiloverPlacement = (
  actuation: ActuationGeometry | undefined,
  actuationPointFor: ((point: Vec3) => ThreePosition) | undefined,
  referencePositionFor: (id: string) => ThreePosition,
): CoiloverPlacement => declaredCoiloverPlacement(actuation, actuationPointFor)
  ?? unmountedCoiloverPreviewPlacement(referencePositionFor);
