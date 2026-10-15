import {
  actuationSeriesResponseSchema,
  createDemoProject,
  projectSchema,
  uprightEquilibriumResponseSchema,
  vehicleLoadTransferResponseSchema,
} from "@msku/contracts";
import { describe, expect, it } from "vitest";

const quality = {
  numerical: "VERIFIED_NUMERICALLY" as const,
  reference: "REFERENCE_BENCHMARKED" as const,
  physical: "UNVALIDATED_PHYSICALLY" as const,
  engineeringApproval: "NOT_APPROVED" as const,
};

describe("Phase 3 versioned contracts", () => {
  it("accepts optional explicit actuation geometry without changing legacy projects", () => {
    expect(projectSchema.parse(createDemoProject()).suspension.actuation).toBeUndefined();
    const project = createDemoProject();
    project.suspension.actuation = {
      type: "pushrod",
      uprightPickup: { x: 0, y: 0.6, z: 0.2 },
      rockerPushrodPickup: { x: 0, y: 0.2, z: 0.5 },
      rockerSpringPickup: { x: 0.1, y: 0.2, z: 0.5 },
      rockerAxisStart: { x: -0.1, y: 0.2, z: 0.5 },
      rockerAxisEnd: { x: 0.1, y: 0.2, z: 0.5 },
      springChassisPickup: { x: 0.2, y: 0.2, z: 0.5 },
      springFreeLengthM: 0.2,
      springRateNPerM: 10_000,
      springPreloadN: 100,
    };
    expect(projectSchema.parse(project).suspension.actuation?.type).toBe("pushrod");
  });

  it("parses a traceable upright-equilibrium payload", () => {
    const project = createDemoProject();
    const points = Object.fromEntries(project.suspension.hardpoints.map((item) => [item.id, item.position]));
    expect(uprightEquilibriumResponseSchema.parse({
      schemaVersion: "1.0.0",
      calculationStatus: "VERIFIED_NUMERICALLY",
      validationStatus: quality,
      solverVersion: "3.0.0",
      units: { force: "N", moment: "N*m", length: "m" },
      inputProvenance: {
        projectId: project.projectId,
        projectName: project.name,
        dataClassification: project.dataClassification,
        declaredModelStatus: project.modelStatus,
        projectInputSha256: "a".repeat(64),
      },
      pose: {
        hardpoints: points,
        wheelAxis: { x: 0, y: 1, z: 0 },
        translation: { x: 0, y: 0, z: 0 },
        rotationVector: { x: 0, y: 0, z: 0 },
      },
      memberForces: [],
      diagnostics: {
        matrixRows: 6,
        matrixColumns: 5,
        matrixRank: 5,
        conditionNumber: 4,
        forceResidualN: { x: 0, y: 0, z: 0 },
        momentResidualNm: { x: 0, y: 0, z: 0 },
        forceResidualNormN: 0,
        momentResidualNormNm: 0,
        characteristicLengthM: 0.4,
        message: "accepted",
      },
      warnings: [],
    }).validationStatus.engineeringApproval).toBe("NOT_APPROVED");
  });

  it("keeps unsupported load transfer and actuation results explicit", () => {
    const load = vehicleLoadTransferResponseSchema.parse({
      schemaVersion: "1.0.0",
      calculationStatus: "NOT_COMPUTABLE",
      validationStatus: { ...quality, numerical: "NOT_COMPUTABLE" },
      solverVersion: "3.0.0",
      modelName: "rigid_body_with_elastic_roll_stiffness_distribution",
      units: { mass: "kg", length: "m", acceleration: "m/s^2", force: "N" },
      axleLoads: { frontN: 1000, rearN: 1000 },
      wheelLoads: null,
      longitudinalTransferN: 0,
      frontLateralTransferN: null,
      rearLateralTransferN: null,
      totalWeightN: 2000,
      forceResidualN: 0,
      warnings: ["MISSING_STIFFNESS"],
    });
    expect(load.wheelLoads).toBeNull();

    const series = actuationSeriesResponseSchema.parse({
      schemaVersion: "1.0.0",
      calculationStatus: "NOT_COMPUTABLE",
      validationStatus: { ...quality, numerical: "NOT_COMPUTABLE" },
      solverVersion: "3.0.0",
      units: { length: "m", force: "N", springRate: "N/m", energy: "J", motionRatio: "m/m" },
      samples: [],
      warnings: ["MISSING_GEOMETRY"],
    });
    expect(series.samples).toEqual([]);
  });
});
