import type { ActuationGeometry, Vec3 } from "@msku/contracts";
import { describe, expect, it } from "vitest";

import { resolveCoiloverPlacement } from "./coiloverPlacement";

describe("GLB coilover placement", () => {
  it("uses declared damper endpoints without inventing a connection", () => {
    const actuation: ActuationGeometry = {
      type: "pushrod",
      uprightPickup: { x: 0.1, y: 0.2, z: 0.3 },
      rockerPushrodPickup: { x: 0.2, y: 0.3, z: 0.4 },
      rockerSpringPickup: { x: 0.3, y: 0.4, z: 0.5 },
      rockerAxisStart: { x: 0, y: 0.2, z: 0.5 },
      rockerAxisEnd: { x: 0.1, y: 0.2, z: 0.5 },
      springChassisPickup: { x: 0.6, y: 0.2, z: 0.7 },
      springFreeLengthM: 0.25,
      springRateNPerM: 30_000,
      springPreloadN: 0,
      damper: {
        rockerPickup: { x: 0.31, y: 0.41, z: 0.51 },
        chassisPickup: { x: 0.61, y: 0.21, z: 0.71 },
        compressionCoefficientNsPerM: 1_000,
        reboundCoefficientNsPerM: 1_500,
      },
    };
    const toScene = (point: Vec3): [number, number, number] => [point.x, point.z, -point.y];
    const placement = resolveCoiloverPlacement(
      actuation,
      toScene,
    );

    expect(placement.status).toBe("DECLARED_STATIC_GEOMETRY");
    expect(placement.placement?.start).toEqual([0.31, 0.51, -0.41]);
    expect(placement.placement?.end).toEqual([0.61, 0.71, -0.21]);
  });

  it("refuses to invent a placement when actuation hardpoints are absent", () => {
    const placement = resolveCoiloverPlacement(
      undefined,
      undefined,
    );

    expect(placement.status).toBe("MISSING_ACTUATION_HARDPOINTS");
    expect(placement.placement).toBeUndefined();
    expect(placement.missingHardpoints).toEqual([
      "uprightPickup",
      "rockerPushrodPickup",
      "rockerSpringPickup",
      "rockerAxisStart",
      "rockerAxisEnd",
      "springChassisPickup",
    ]);
  });

  it("suppresses the static coilover while rocker closure is unsolved", () => {
    const actuation: ActuationGeometry = {
      type: "pushrod",
      uprightPickup: { x: 0.1, y: 0.2, z: 0.3 },
      rockerPushrodPickup: { x: 0.2, y: 0.3, z: 0.4 },
      rockerSpringPickup: { x: 0.3, y: 0.4, z: 0.5 },
      rockerAxisStart: { x: 0, y: 0.2, z: 0.5 },
      rockerAxisEnd: { x: 0.1, y: 0.2, z: 0.5 },
      springChassisPickup: { x: 0.6, y: 0.2, z: 0.7 },
      springFreeLengthM: 0.25,
      springRateNPerM: 30_000,
      springPreloadN: 0,
    };

    const placement = resolveCoiloverPlacement(
      actuation,
      (point) => [point.x, point.z, -point.y],
      true,
    );

    expect(placement.status).toBe("UNSOLVED_KINEMATIC_CLOSURE");
    expect(placement.placement).toBeUndefined();
  });
});
