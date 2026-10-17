import type { ActuationGeometry, Vec3 } from "@msku/contracts";

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
}

export type CoiloverPlacementResolution =
  | {
    status: "DECLARED_STATIC_GEOMETRY";
    placement: CoiloverPlacement;
    missingHardpoints: [];
  }
  | {
    status: "MISSING_ACTUATION_HARDPOINTS";
    placement?: undefined;
    missingHardpoints: readonly string[];
  }
  | {
    status: "UNSOLVED_KINEMATIC_CLOSURE";
    placement?: undefined;
    missingHardpoints: [];
  };

/**
 * Resolves only explicitly declared damper/spring eyes.
 *
 * A wheel kinematic pose does not include rocker rotation or damper length. The
 * coilover is therefore suppressed during solved wheel motion until a coupled
 * actuation result exists. No visual fallback coordinates are generated.
 */
export const resolveCoiloverPlacement = (
  actuation: ActuationGeometry | undefined,
  actuationPointFor: ((point: Vec3) => ThreePosition) | undefined,
  kinematicPoseActive = false,
): CoiloverPlacementResolution => {
  if (!actuation || !actuationPointFor) {
    return {
      status: "MISSING_ACTUATION_HARDPOINTS",
      missingHardpoints: REQUIRED_ACTUATION_HARDPOINTS,
    };
  }
  if (kinematicPoseActive) {
    return {
      status: "UNSOLVED_KINEMATIC_CLOSURE",
      missingHardpoints: [],
    };
  }
  const rockerPickup = actuation.damper?.rockerPickup ?? actuation.rockerSpringPickup;
  const chassisPickup = actuation.damper?.chassisPickup ?? actuation.springChassisPickup;
  return {
    status: "DECLARED_STATIC_GEOMETRY",
    placement: {
      start: actuationPointFor(rockerPickup),
      end: actuationPointFor(chassisPickup),
    },
    missingHardpoints: [],
  };
};
