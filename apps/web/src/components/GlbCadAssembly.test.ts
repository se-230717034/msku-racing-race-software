import type { ActuationGeometry, Vec3 } from "@msku/contracts";
import { describe, expect, it } from "vitest";

import { resolveCoiloverPlacement } from "./coiloverPlacement";

const referencePoints: Record<string, [number, number, number]> = {
  uca_front_inboard: [0.10, 0.40, -0.30],
  uca_rear_inboard: [-0.10, 0.40, -0.30],
  lca_front_inboard: [0.12, 0.12, -0.32],
  lca_rear_inboard: [-0.12, 0.12, -0.32],
};

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
      (id) => referencePoints[id],
    );

    expect(placement.status).toBe("DECLARED_STATIC_GEOMETRY");
    expect(placement.start).toEqual([0.31, 0.51, -0.41]);
    expect(placement.end).toEqual([0.61, 0.71, -0.21]);
  });

  it("returns an explicitly unmounted preview when actuation hardpoints are absent", () => {
    const placement = resolveCoiloverPlacement(
      undefined,
      undefined,
      (id) => referencePoints[id],
    );

    expect(placement.status).toBe("UNMOUNTED_COMPONENT_PREVIEW");
    expect(placement.start[1]).toBeCloseTo(0.48);
    expect(placement.end[1]).toBeCloseTo(0.48);
    expect(placement.end[0] - placement.start[0]).toBeCloseTo(0.22);
  });
});
