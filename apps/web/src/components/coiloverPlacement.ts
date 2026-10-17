import type { ActuationGeometry, KinematicPose, Vec3 } from "@msku/contracts";

import { solveActuationKinematics } from "../domain/actuationKinematics";
import type { ThreePosition } from "./ProceduralCadAssembly";

export const REQUIRED_ACTUATION_HARDPOINTS = [
  "uprightPickup",
  "rockerPushrodPickup",
  "rockerSpringPickup",
  "rockerAxisStart",
  "rockerAxisEnd",
  "springChassisPickup",
] as const;

export interface CoiloverPlacement {
  start: ThreePosition;
  end: ThreePosition;
  referenceLengthM: number;
}

export type CoiloverPlacementResolution =
  | {
    status: "SOLVED_ACTUATION_GEOMETRY";
    placement: CoiloverPlacement;
    missingHardpoints: [];
  }
  | {
    status: "MISSING_ACTUATION_HARDPOINTS";
    placement?: undefined;
    missingHardpoints: readonly string[];
  }
  | {
    status: "FAILED_ACTUATION_KINEMATICS";
    placement?: undefined;
    missingHardpoints: [];
    reason: string;
  };

/**
 * Resolves only explicitly declared damper/spring eyes.
 *
 * The GLB eye centres are mapped only after the fixed-length pushrod constraint
 * produces a valid rocker solution. No visual fallback coordinates are generated.
 */
export const resolveCoiloverPlacement = (
  actuation: ActuationGeometry | undefined,
  staticWheelCenter: Vec3,
  actuationPointFor: ((point: Vec3) => ThreePosition) | undefined,
  pose?: KinematicPose,
): CoiloverPlacementResolution => {
  if (!actuation || !actuationPointFor) {
    return {
      status: "MISSING_ACTUATION_HARDPOINTS",
      missingHardpoints: REQUIRED_ACTUATION_HARDPOINTS,
    };
  }
  const kinematics = solveActuationKinematics(actuation, staticWheelCenter, pose);
  if (kinematics.status === "FAILED") {
    return {
      status: "FAILED_ACTUATION_KINEMATICS",
      missingHardpoints: [],
      reason: kinematics.reason,
    };
  }
  const staticKinematics = solveActuationKinematics(actuation, staticWheelCenter);
  if (staticKinematics.status === "FAILED") {
    return {
      status: "FAILED_ACTUATION_KINEMATICS",
      missingHardpoints: [],
      reason: staticKinematics.reason,
    };
  }
  return {
    status: "SOLVED_ACTUATION_GEOMETRY",
    placement: {
      start: actuationPointFor(kinematics.rockerCoiloverPickup),
      end: actuationPointFor(kinematics.chassisCoiloverPickup),
      referenceLengthM: staticKinematics.coiloverLengthM,
    },
    missingHardpoints: [],
  };
};
