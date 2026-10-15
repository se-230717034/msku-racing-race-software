import {
  createDemoProject,
  engineeringOptimizationRequestSchema,
  engineeringOptimizationResponseSchema,
} from "@msku/contracts";
import { describe, expect, it } from "vitest";

const request = {
  model: "kinematics",
  designVariables: [{
    path: "hardpoints.tie_rod_inboard.y",
    lowerBound: 0.26,
    upperBound: 0.32,
  }],
  objectives: [{
    id: "bump_steer_rms_rad",
    goal: "minimize",
    targetValue: null,
    weight: 1,
    normalization: 0.01,
  }],
  constraints: {
    minimumLinkLengthM: 0.01,
    maximumAbsSuspensionTravelM: 0.04,
    requireWheelContact: false,
    requireStableHandling: false,
  },
  settings: {
    seed: 2307,
    maximumGenerations: 40,
    populationMultiplier: 6,
    convergenceTolerance: 1e-5,
    paretoPoints: 0,
    sensitivityStepFraction: 1e-4,
  },
  project: createDemoProject(),
  kinematicsSweep: { startTravelM: -0.03, endTravelM: 0.03, steps: 13 },
  kinematicsSolver: { residualToleranceM: 1e-8, maxFunctionEvaluations: 500 },
  quarterCar: null,
  fullCar: null,
  bicycle: null,
} as const;

describe("Phase 5 optimization contracts", () => {
  it("accepts bounded SI variables and explicit objective normalization", () => {
    const parsed = engineeringOptimizationRequestSchema.parse(request);
    expect(parsed.settings.seed).toBe(2307);
    expect(parsed.objectives[0]?.normalization).toBe(0.01);
  });

  it("rejects reversed bounds and Pareto requests with one objective", () => {
    expect(() => engineeringOptimizationRequestSchema.parse({
      ...request,
      designVariables: [{ ...request.designVariables[0], lowerBound: 1, upperBound: 0 }],
    })).toThrow();
    expect(() => engineeringOptimizationRequestSchema.parse({
      ...request,
      settings: { ...request.settings, paretoPoints: 5 },
    })).toThrow();
  });

  it("requires traceability and preserves failed-candidate suppression", () => {
    const parsed = engineeringOptimizationResponseSchema.parse({
      schemaVersion: "1.0.0",
      model: "kinematics",
      calculationStatus: "FAILED",
      validationStatus: {
        numerical: "FAILED",
        reference: "REFERENCE_BENCHMARKED",
        physical: "UNVALIDATED_PHYSICALLY",
        engineeringApproval: "NOT_APPROVED",
      },
      solverVersion: "5.0.0",
      units: { designVariables: "SI" },
      availableObjectives: ["bump_steer_rms_rad"],
      baseline: null,
      optimized: null,
      paretoFront: [],
      convergence: [],
      sensitivities: [],
      diagnostics: {
        success: false,
        message: "baseline infeasible",
        method: "scipy_differential_evolution",
        evaluations: 1,
        feasibleEvaluations: 0,
        rejectedEvaluations: 1,
        generations: 0,
        seed: 2307,
      },
      provenance: {
        inputSha256: "a".repeat(64),
        dataClassification: "demonstration",
        sourceLabel: "Synthetic fixture",
      },
      warnings: ["INFEASIBLE_BASELINE"],
    });
    expect(parsed.optimized).toBeNull();
    expect(parsed.validationStatus.engineeringApproval).toBe("NOT_APPROVED");
  });
});
