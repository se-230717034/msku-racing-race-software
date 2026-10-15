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
      validationStatus: {
        numerical: "VERIFIED_NUMERICALLY",
        reference: "REFERENCE_BENCHMARKED",
        physical: "UNVALIDATED_PHYSICALLY",
        engineeringApproval: "NOT_APPROVED",
      },
      solver: {
        name: "rigid_upright_double_wishbone",
        version: "2.5.0",
        residualToleranceM: 1e-8,
        rankRelativeTolerance: 1e-9,
        conditionLimit: 1e10,
        continuityPositionLimitM: 0.03,
        continuityRotationLimitRad: 0.35,
        maximumTravelStepM: 0.025,
        maxFunctionEvaluations: 500,
        gradientMethod: "second_order_nonuniform_finite_difference",
      },
      inputProvenance: {
        projectId: "test-project",
        projectName: "Test project",
        dataClassification: "demonstration",
        declaredModelStatus: "unvalidated",
        projectInputSha256: "a".repeat(64),
      },
      warnings: ["PHYSICAL_VALIDATION_EVIDENCE_NOT_ATTACHED"],
      residualToleranceM: 1e-8,
      states: [{
        travelM: 0.01,
        calculationStatus: "VERIFIED_NUMERICALLY",
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
          optimizerSuccess: true,
          residualsAccepted: true,
          jacobianAccepted: true,
          continuityAccepted: true,
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
    expect(csv).toContain("# engineering_approval,NOT_APPROVED");
    expect(csv).toContain("# solver_version,2.5.0");
    expect(csv).toContain(`# project_input_sha256,${"a".repeat(64)}`);
    expect(csv).toContain("travel_mm,calculation_status,converged");
    expect(csv).toContain("10.0000000000,VERIFIED_NUMERICALLY,true,true,true,true,true");
    expect(csv).toContain("REFERENCE_WARNING");
  });

  it("rejects export when any sweep result failed", () => {
    const failed = {
      schemaVersion: "1.0.0",
      modelStatus: "unvalidated",
      units: { length: "m", angle: "rad", camberGain: "rad/m", bumpSteerGradient: "rad/m" },
      allConverged: false,
      validationStatus: {
        numerical: "FAILED",
        reference: "REFERENCE_BENCHMARKED",
        physical: "UNVALIDATED_PHYSICALLY",
        engineeringApproval: "NOT_APPROVED",
      },
      solver: {
        name: "rigid_upright_double_wishbone",
        version: "2.5.0",
        residualToleranceM: 1e-8,
        rankRelativeTolerance: 1e-9,
        conditionLimit: 1e10,
        continuityPositionLimitM: 0.03,
        continuityRotationLimitRad: 0.35,
        maximumTravelStepM: 0.025,
        maxFunctionEvaluations: 500,
        gradientMethod: "second_order_nonuniform_finite_difference",
      },
      inputProvenance: {
        projectId: "test-project",
        projectName: "Test project",
        dataClassification: "demonstration",
        declaredModelStatus: "unvalidated",
        projectInputSha256: "b".repeat(64),
      },
      warnings: ["PHYSICAL_VALIDATION_EVIDENCE_NOT_ATTACHED"],
      residualToleranceM: 1e-8,
      states: [],
    } as unknown as KinematicsSweepResponse;
    expect(() => serializeKinematicsCsv(failed)).toThrow(/cannot be exported/);
  });
});
