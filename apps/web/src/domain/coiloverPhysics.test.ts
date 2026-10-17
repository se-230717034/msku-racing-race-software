import { createDemoProject, type KinematicState } from "@msku/contracts";
import { describe, expect, it } from "vitest";

import { buildCoiloverSeriesInput } from "./coiloverPhysics";

const state = (travelM: number): KinematicState => ({
  travelM,
  calculationStatus: "VERIFIED_NUMERICALLY",
  pose: {
    hardpoints: {},
    wheelAxis: { x: 0, y: 1, z: 0 },
    translation: { x: 0, y: 0, z: travelM },
    rotationVector: { x: 0, y: 0, z: 0 },
  },
  metrics: null,
  diagnostics: {
    converged: true,
    optimizerSuccess: true,
    residualsAccepted: true,
    jacobianAccepted: true,
    continuityAccepted: true,
    maxAbsResidualM: 0,
    residualNormM: 0,
    jacobianRank: 6,
    jacobianCondition: 1,
    functionEvaluations: 1,
    message: "test",
  },
  warnings: [],
});

describe("coilover physics request builder", () => {
  it("uses solved geometry and explicit velocity without inventing time", () => {
    const project = createDemoProject();
    const suspension = project.suspension;
    const wheelCenter = suspension.hardpoints.find((point) => point.id === "wheel_center")!.position;
    const result = buildCoiloverSeriesInput(
      suspension.actuation,
      wheelCenter,
      [state(-0.001), state(0), state(0.001)],
      0.35,
      project.parameterManifest,
    );

    expect(result.status).toBe("READY");
    if (result.status === "READY") {
      expect(result.payload.wheelVelocityMps).toEqual([0.35, 0.35, 0.35]);
      expect(result.payload.coiloverLengthM).toHaveLength(3);
      expect(result.payload.coiloverLengthM[0]).not.toBeCloseTo(result.payload.coiloverLengthM[2], 8);
      expect(result.payload.compressionCoefficientNsPerM).toBe(1_200);
      expect(result.payload.reboundCoefficientNsPerM).toBe(1_800);
      expect(result.payload.minimumCoiloverLengthM).toBeLessThan(result.payload.referenceCoiloverLengthM);
      expect(result.payload.maximumCoiloverLengthM).toBeGreaterThan(result.payload.referenceCoiloverLengthM);
    }
  });

  it("refuses damping when coefficients or accepted poses are absent", () => {
    const project = createDemoProject();
    const suspension = project.suspension;
    const wheelCenter = suspension.hardpoints.find((point) => point.id === "wheel_center")!.position;
    const withoutDamper = { ...suspension.actuation!, damper: undefined };
    expect(buildCoiloverSeriesInput(withoutDamper, wheelCenter, [state(-0.001), state(0), state(0.001)], 0).status)
      .toBe("NOT_COMPUTABLE");
    expect(buildCoiloverSeriesInput(suspension.actuation, wheelCenter, [state(0)], 0).status)
      .toBe("NOT_COMPUTABLE");
  });
});
