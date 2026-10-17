import { createDemoProject, type KinematicPose } from "@msku/contracts";
import { describe, expect, it } from "vitest";

import { solveActuationKinematics, transformUprightPoint } from "./actuationKinematics";

describe("synthetic pushrod actuation kinematics", () => {
  it("closes all four static demonstration mechanisms without residual", () => {
    const project = createDemoProject();
    for (const corner of Object.values(project.vehicle.corners)) {
      const actuation = corner.suspension.actuation;
      const wheelCenter = corner.suspension.hardpoints.find((point) => point.id === "wheel_center")?.position;
      expect(actuation).toBeDefined();
      expect(wheelCenter).toBeDefined();
      const result = solveActuationKinematics(actuation!, wheelCenter!);
      expect(result.status).toBe("SOLVED");
      if (result.status === "SOLVED") {
        expect(result.rockerAngleRad).toBeCloseTo(0, 10);
        expect(result.pushrodResidualM).toBeLessThan(1e-10);
        expect(result.coiloverLengthM).toBeGreaterThan(0.15);
      }
    }
  });

  it("solves rocker rotation and coilover length change for a rigid upright pose", () => {
    const suspension = createDemoProject().vehicle.corners.front_left.suspension;
    const actuation = suspension.actuation!;
    const wheelCenter = suspension.hardpoints.find((point) => point.id === "wheel_center")!.position;
    const pose: KinematicPose = {
      hardpoints: {},
      wheelAxis: { x: 0, y: 1, z: 0 },
      translation: { x: 0, y: 0, z: 0.01 },
      rotationVector: { x: 0.01, y: -0.005, z: 0.002 },
    };
    const result = solveActuationKinematics(actuation, wheelCenter, pose);
    expect(result.status).toBe("SOLVED");
    if (result.status === "SOLVED") {
      expect(Math.abs(result.rockerAngleRad)).toBeGreaterThan(1e-4);
      expect(result.pushrodResidualM).toBeLessThan(1e-7);
      expect(result.coiloverLengthM).not.toBeCloseTo(actuation.springFreeLengthM, 5);
    }
  });

  it("applies the production rigid-upright rotation-vector convention", () => {
    const result = transformUprightPoint(
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      {
        hardpoints: {},
        wheelAxis: { x: 0, y: 1, z: 0 },
        translation: { x: 0.2, y: -0.1, z: 0.3 },
        rotationVector: { x: 0, y: 0, z: Math.PI / 2 },
      },
    );
    expect(result.x).toBeCloseTo(0.2, 12);
    expect(result.y).toBeCloseTo(0.9, 12);
    expect(result.z).toBeCloseTo(0.3, 12);
  });
});
