import type { KinematicsSweepResponse } from "@msku/contracts";
import { describe, expect, it } from "vitest";

import { serializeKinematicsCsv } from "./kinematicsCsv";

describe("kinematics CSV", () => {
  it("exports calculated values, diagnostics, units, and warnings", () => {
    const sweep: KinematicsSweepResponse = {
      schemaVersion: "1.0.0",
      modelStatus: "unvalidated",
      units: { length: "m", angle: "rad", camberGain: "rad/m", bumpSteerGradient: "rad/m" },
      allConverged: true,
      residualToleranceM: 1e-8,
      states: [{
        travelM: 0.01,
        pose: null,
        metrics: {
          camberRad: Math.PI / 180,
          camberChangeRad: Math.PI / 360,
          camberGainRadPerM: 1,
          toeRad: 0,
          bumpSteerRad: 0,
          bumpSteerGradientRadPerM: 0,
          casterRad: 0,
          kpiRad: 0,
          trackChangeM: 0.001,
          rollCenterHeightM: 0.02,
          instantCenterYM: 1,
          instantCenterZM: 0.1,
        },
        diagnostics: {
          converged: true,
          residualNormM: 1e-10,
          maxAbsResidualM: 1e-10,
          jacobianRank: 6,
          jacobianCondition: 12,
          functionEvaluations: 4,
          message: "converged",
        },
        warnings: ["REFERENCE_WARNING"],
      }],
    };
    const csv = serializeKinematicsCsv(sweep);
    expect(csv).toContain("travel_mm,converged,camber_deg");
    expect(csv).toContain("10.0000000000,true,1.00000000000");
    expect(csv).toContain("REFERENCE_WARNING");
  });
});
