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
      { x: 0, y: 0, z: 0 },
      toScene,
    );

    expect(placement.status).toBe("SOLVED_ACTUATION_GEOMETRY");
    expect(placement.placement?.start[0]).toBeCloseTo(0.31, 12);
    expect(placement.placement?.start[1]).toBeCloseTo(0.51, 12);
    expect(placement.placement?.start[2]).toBeCloseTo(-0.41, 12);
    expect(placement.placement?.end).toEqual([0.61, 0.71, -0.21]);
    expect(placement.placement?.referenceLengthM).toBeCloseTo(Math.sqrt(0.17), 12);
  });

  it("refuses to invent a placement when actuation hardpoints are absent", () => {
    const placement = resolveCoiloverPlacement(
      undefined,
      { x: 0, y: 0, z: 0 },
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

  it("suppresses the coilover when the pushrod cannot reach the rocker", () => {
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
      { x: 0, y: 0, z: 0 },
      (point) => [point.x, point.z, -point.y],
      {
        hardpoints: {},
        wheelAxis: { x: 0, y: 1, z: 0 },
        translation: { x: 0, y: 0, z: 10 },
        rotationVector: { x: 0, y: 0, z: 0 },
      },
    );

    expect(placement.status).toBe("FAILED_ACTUATION_KINEMATICS");
    expect(placement.placement).toBeUndefined();
  });
});
