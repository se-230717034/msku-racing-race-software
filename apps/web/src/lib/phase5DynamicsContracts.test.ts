import {
  bicycleSimulationRequestSchema,
  fullCarSimulationRequestSchema,
} from "@msku/contracts";
import { describe, expect, it } from "vitest";

const settings = {
  durationS: 1,
  outputSamples: 201,
  relativeTolerance: 1e-8,
  absoluteTolerance: 1e-10,
  maximumStepS: 0.002,
  method: "DOP853" as const,
};

const road = {
  kind: "smooth_bump" as const,
  amplitudeM: 0.005,
  startTimeS: 0.2,
  durationS: 0.15,
  frequencyHz: 1,
  sampleTimesS: [],
  sampleDisplacementsM: [],
};

describe("Phase 5 dynamics contracts", () => {
  it("accepts an explicit seven-DOF full-car request", () => {
    const corner = {
      unsprungMassKg: 12,
      suspensionStiffnessNPerM: 30_000,
      suspensionDampingNsPerM: 1_800,
      tireStiffnessNPerM: 180_000,
      tireDampingNsPerM: 0,
      staticTireLoadN: 1_000,
    };
    const parsed = fullCarSimulationRequestSchema.parse({
      dataClassification: "demonstration",
      sourceLabel: "Synthetic contract fixture",
      parameters: {
        sprungMassKg: 300,
        pitchInertiaKgM2: 120,
        rollInertiaKgM2: 80,
        corners: [
          { ...corner, xPositionM: 0.8, yPositionM: 0.6 },
          { ...corner, xPositionM: 0.8, yPositionM: -0.6 },
          { ...corner, xPositionM: -0.8, yPositionM: 0.6 },
          { ...corner, xPositionM: -0.8, yPositionM: -0.6 },
        ],
      },
      roadProfiles: [road, road, road, road],
      initialState: {
        bodyHeaveM: 0,
        bodyHeaveVelocityMps: 0,
        pitchRad: 0,
        pitchRateRadps: 0,
        rollRad: 0,
        rollRateRadps: 0,
        unsprungDisplacementsM: [0, 0, 0, 0],
        unsprungVelocitiesMps: [0, 0, 0, 0],
      },
      settings,
    });
    expect(parsed.parameters.corners).toHaveLength(4);
    expect(parsed.roadProfiles).toHaveLength(4);
  });

  it("accepts a fully bounded linear bicycle request", () => {
    const parsed = bicycleSimulationRequestSchema.parse({
      dataClassification: "demonstration",
      sourceLabel: "Synthetic contract fixture",
      parameters: {
        massKg: 300,
        yawInertiaKgM2: 150,
        cgToFrontAxleM: 0.8,
        cgToRearAxleM: 0.8,
        frontCorneringStiffnessNPerRad: 50_000,
        rearCorneringStiffnessNPerRad: 50_000,
        speedMps: 15,
      },
      steering: {
        kind: "smooth_step",
        amplitudeRad: 0.02,
        startTimeS: 0.2,
        riseTimeS: 0.1,
        frequencyHz: 1,
        sampleTimesS: [],
        sampleAnglesRad: [],
      },
      initialState: { lateralVelocityMps: 0, yawRateRadps: 0 },
      domainLimits: {
        maximumAbsSteeringRad: 0.15,
        maximumAbsSideslipRad: 0.15,
        maximumAbsTireSlipRad: 0.15,
      },
      settings,
    });
    expect(parsed.parameters.speedMps).toBe(15);
    expect(parsed.domainLimits.maximumAbsTireSlipRad).toBe(0.15);
  });

  it("rejects missing full-car corners and non-positive speed", () => {
    const badFullCar = {
      dataClassification: "demonstration",
      sourceLabel: "bad",
      parameters: {
        sprungMassKg: 300,
        pitchInertiaKgM2: 120,
        rollInertiaKgM2: 80,
        corners: [],
      },
      roadProfiles: [road, road, road, road],
      initialState: {},
      settings,
    };
    expect(() => fullCarSimulationRequestSchema.parse(badFullCar)).toThrow();

    const bicycle = {
      dataClassification: "demonstration",
      sourceLabel: "bad",
      parameters: {
        massKg: 300,
        yawInertiaKgM2: 150,
        cgToFrontAxleM: 0.8,
        cgToRearAxleM: 0.8,
        frontCorneringStiffnessNPerRad: 50_000,
        rearCorneringStiffnessNPerRad: 50_000,
        speedMps: 0,
      },
      steering: {
        kind: "step",
        amplitudeRad: 0.02,
        startTimeS: 0,
        riseTimeS: 0.1,
        frequencyHz: 1,
        sampleTimesS: [],
        sampleAnglesRad: [],
      },
      initialState: { lateralVelocityMps: 0, yawRateRadps: 0 },
      domainLimits: {
        maximumAbsSteeringRad: 0.15,
        maximumAbsSideslipRad: 0.15,
        maximumAbsTireSlipRad: 0.15,
      },
      settings,
    };
    expect(() => bicycleSimulationRequestSchema.parse(bicycle)).toThrow();
  });
});
