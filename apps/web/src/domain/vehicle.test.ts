import { createDemoProject } from "@msku/contracts";
import { describe, expect, it } from "vitest";

import {
  CORNER_IDS,
  cornerPointToVehicle,
  cornerWheelPosition,
  fullCarVisualState,
  integratedYawRad,
  visibleCornerIds,
} from "./vehicle";

describe("Phase 6 full-vehicle geometry", () => {
  it("places four distinct wheel centres at the configured wheelbase and tracks", () => {
    const project = createDemoProject();
    const positions = Object.fromEntries(CORNER_IDS.map((id) => [id, cornerWheelPosition(project, id)]));
    expect(new Set(Object.values(positions).map((point) => `${point.x}/${point.y}/${point.z}`)).size).toBe(4);
    expect(positions.front_left.x - positions.rear_left.x).toBeCloseTo(project.vehicle.wheelbaseM, 12);
    expect(positions.front_left.y - positions.front_right.y).toBeCloseTo(project.vehicle.frontTrackM, 12);
    expect(positions.rear_left.y - positions.rear_right.y).toBeCloseTo(project.vehicle.rearTrackM, 12);
  });

  it("keeps independent rear geometry distinct from front geometry", () => {
    const project = createDemoProject();
    expect(project.vehicle.corners.rear_left.suspension.hardpoints)
      .not.toEqual(project.vehicle.corners.front_left.suspension.hardpoints);
    expect(project.vehicle.corners.front_right.geometrySource).toBe("mirrored_assumption");
    expect(project.vehicle.corners.rear_left.geometrySource).toBe("synthetic_demo");
  });

  it("maps each corner-local wheel centre exactly to its vehicle target", () => {
    const project = createDemoProject();
    for (const cornerId of CORNER_IDS) {
      const local = project.vehicle.corners[cornerId].suspension.hardpoints
        .find((point) => point.id === "wheel_center")!.position;
      expect(cornerPointToVehicle(project, cornerId, local)).toEqual(cornerWheelPosition(project, cornerId));
    }
  });

  it("filters front, rear, and selected-corner views without changing project state", () => {
    const project = createDemoProject();
    const snapshot = JSON.stringify(project);
    expect(visibleCornerIds("front_axle", "rear_right")).toEqual(["front_left", "front_right"]);
    expect(visibleCornerIds("rear_axle", "front_left")).toEqual(["rear_left", "rear_right"]);
    expect(visibleCornerIds("active_corner", "rear_right")).toEqual(["rear_right"]);
    expect(JSON.stringify(project)).toBe(snapshot);
  });

  it("integrates bicycle yaw rate using trapezoidal time integration", () => {
    const samples = [
      { timeS: 0, yawRateRadps: 0 },
      { timeS: 1, yawRateRadps: 2 },
      { timeS: 2, yawRateRadps: 2 },
    ];
    expect(integratedYawRad(samples as never, 2)).toBeCloseTo(3, 12);
  });

  it("uses all four full-car unsprung histories without mirroring or synthesis", () => {
    const state = fullCarVisualState({
      bodyHeaveM: 0.004,
      pitchRad: -0.012,
      rollRad: 0.009,
      unsprungDisplacementsM: [0.001, -0.002, 0.003, -0.004],
    } as never);
    expect(state.bodyHeaveM).toBe(0.004);
    expect(state.pitchRad).toBe(-0.012);
    expect(state.rollRad).toBe(0.009);
    expect(state.unsprungDisplacementsM).toEqual([0.001, -0.002, 0.003, -0.004]);
  });

  it("keeps an unsupported or absent dynamics state static instead of fabricating motion", () => {
    expect(fullCarVisualState()).toEqual({
      bodyHeaveM: 0,
      pitchRad: 0,
      rollRad: 0,
      unsprungDisplacementsM: [0, 0, 0, 0],
    });
  });
});
