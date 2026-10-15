import {
  quarterCarSimulationRequestSchema,
  quarterCarSimulationResponseSchema,
} from "@msku/contracts";
import { describe, expect, it } from "vitest";

const request = {
  dataClassification: "demonstration",
  sourceLabel: "Synthetic contract fixture",
  parameters: {
    sprungMassKg: 75,
    unsprungMassKg: 12,
    suspensionStiffnessNPerM: 30_000,
    suspensionDampingNsPerM: 1_800,
    tireStiffnessNPerM: 180_000,
    tireDampingNsPerM: 0,
    staticTireLoadN: 1_000,
  },
  road: {
    kind: "smooth_bump",
    amplitudeM: 0.01,
    startTimeS: 0.2,
    durationS: 0.15,
    frequencyHz: 1,
    sampleTimesS: [],
    sampleDisplacementsM: [],
  },
  initialState: {
    sprungDisplacementM: 0,
    sprungVelocityMps: 0,
    unsprungDisplacementM: 0,
    unsprungVelocityMps: 0,
  },
  settings: {
    durationS: 1.5,
    outputSamples: 301,
    relativeTolerance: 1e-8,
    absoluteTolerance: 1e-10,
    maximumStepS: 0.002,
    method: "DOP853",
  },
} as const;

describe("Phase 4 dynamics contracts", () => {
  it("accepts a complete SI quarter-car request", () => {
    const parsed = quarterCarSimulationRequestSchema.parse(request);
    expect(parsed.road.kind).toBe("smooth_bump");
    expect(parsed.parameters.staticTireLoadN).toBe(1_000);
  });

  it("requires traceability and preserves unavailable contact force", () => {
    const parsed = quarterCarSimulationResponseSchema.parse({
      schemaVersion: "1.0.0",
      modelName: "linear_quarter_car_2dof",
      calculationStatus: "VERIFIED_NUMERICALLY",
      validationStatus: {
        numerical: "VERIFIED_NUMERICALLY",
        reference: "REFERENCE_BENCHMARKED",
        physical: "UNVALIDATED_PHYSICALLY",
        engineeringApproval: "NOT_APPROVED",
      },
      solverVersion: "4.0.0",
      units: {
        time: "s", displacement: "m", velocity: "m/s", acceleration: "m/s^2",
        force: "N", energy: "J", power: "W",
      },
      inputProvenance: {
        dataClassification: "demonstration",
        sourceLabel: "Synthetic fixture",
        inputSha256: "b".repeat(64),
      },
      naturalFrequenciesHz: [2.8, 20.1],
      diagnostics: {
        solverSuccess: true,
        finiteStates: true,
        contactAccepted: null,
        functionEvaluations: 40,
        jacobianEvaluations: 0,
        luDecompositions: 0,
        integrationMethod: "DOP853",
        relativeTolerance: 1e-8,
        absoluteTolerance: 1e-10,
        maximumStepS: 0.002,
        acceptedSteps: 10,
        minimumAcceptedStepS: 0.0001,
        maximumAcceptedStepS: 0.002,
        initialEnergyJ: 0,
        finalEnergyJ: 0,
        roadInputWorkJ: 0,
        dissipatedEnergyJ: 0,
        energyBalanceResidualJ: 0,
        relativeEnergyBalanceError: 0,
        minimumTotalContactForceN: null,
        message: "accepted",
      },
      assumptions: ["TWO_DOF_LINEAR_QUARTER_CAR"],
      warnings: ["TOTAL_CONTACT_FORCE_NOT_AVAILABLE_STATIC_TIRE_LOAD_MISSING"],
      samples: [{
        timeS: 0,
        roadDisplacementM: 0,
        roadVelocityMps: 0,
        sprungDisplacementM: 0,
        sprungVelocityMps: 0,
        sprungAccelerationMps2: 0,
        unsprungDisplacementM: 0,
        unsprungVelocityMps: 0,
        unsprungAccelerationMps2: 0,
        suspensionTravelM: 0,
        tireCompressionM: 0,
        suspensionForceOnSprungN: 0,
        tireForceIncrementN: 0,
        totalTireContactForceN: null,
        mechanicalEnergyJ: 0,
        dissipatedPowerW: 0,
        roadInputPowerW: 0,
      }],
    });
    expect(parsed.samples[0]?.totalTireContactForceN).toBeNull();
    expect(parsed.validationStatus.engineeringApproval).toBe("NOT_APPROVED");
  });

  it("rejects malformed sampled input before an API request is sent", () => {
    const malformed = {
      ...request,
      road: { ...request.road, kind: "sampled", sampleTimesS: [0, Number.NaN] },
    };
    expect(() => quarterCarSimulationRequestSchema.parse(malformed)).toThrow();
  });
});
