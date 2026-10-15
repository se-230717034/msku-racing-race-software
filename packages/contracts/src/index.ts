import { z } from "zod";

export const PROJECT_SCHEMA_VERSION = "1.0.0" as const;

export const vec3Schema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});

export const hardpointSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  group: z.enum(["upper_wishbone", "lower_wishbone", "steering", "upright", "wheel"]),
  position: vec3Schema,
});

export const actuationGeometrySchema = z.object({
  type: z.enum(["pushrod", "pullrod"]),
  uprightPickup: vec3Schema,
  rockerPushrodPickup: vec3Schema,
  rockerSpringPickup: vec3Schema,
  rockerAxisStart: vec3Schema,
  rockerAxisEnd: vec3Schema,
  springChassisPickup: vec3Schema,
  springFreeLengthM: z.number().finite().positive(),
  springRateNPerM: z.number().finite().positive(),
  springPreloadN: z.number().finite().nonnegative().default(0),
  damper: z.object({
    rockerPickup: vec3Schema,
    chassisPickup: vec3Schema,
    compressionCoefficientNsPerM: z.number().finite().nonnegative(),
    reboundCoefficientNsPerM: z.number().finite().nonnegative(),
  }).optional(),
});

export const projectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  projectId: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().max(500),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  dataClassification: z.enum(["demonstration", "team_private"]),
  modelStatus: z.enum(["demonstration", "unvalidated", "benchmarked", "experimentally_validated"]),
  units: z.object({
    length: z.literal("m"),
    angle: z.literal("rad"),
  }),
  coordinateSystem: z.object({
    handedness: z.literal("right"),
    xAxis: z.literal("forward"),
    yAxis: z.literal("left"),
    zAxis: z.literal("up"),
  }),
  suspension: z.object({
    type: z.literal("double_wishbone"),
    corner: z.enum(["front_left", "front_right"]),
    hardpoints: z.array(hardpointSchema).length(9),
    wheel: z.object({
      radius: z.number().finite().positive(),
      width: z.number().finite().positive(),
      staticCamberRad: z.number().finite().min(-0.35).max(0.35).default(0),
      staticToeRad: z.number().finite().min(-0.35).max(0.35).default(0),
    }),
    actuation: actuationGeometrySchema.optional(),
  }),
});

export type Vec3 = z.infer<typeof vec3Schema>;
export type Hardpoint = z.infer<typeof hardpointSchema>;
export type ActuationGeometry = z.infer<typeof actuationGeometrySchema>;
export type Project = z.infer<typeof projectSchema>;
export type ModelStatus = Project["modelStatus"];

export const REQUIRED_HARDPOINT_IDS = [
  "uca_front_inboard",
  "uca_rear_inboard",
  "uca_outboard",
  "lca_front_inboard",
  "lca_rear_inboard",
  "lca_outboard",
  "tie_rod_inboard",
  "tie_rod_outboard",
  "wheel_center",
] as const;

export const createDemoProject = (projectId = "msku-demo-front-left"): Project => ({
  schemaVersion: PROJECT_SCHEMA_VERSION,
  projectId,
  name: "Front-left demonstration corner",
  description: "Synthetic geometry for software demonstration only; not MSKU Racing vehicle data.",
  createdAt: "2026-10-15T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
  dataClassification: "demonstration",
  modelStatus: "unvalidated",
  units: { length: "m", angle: "rad" },
  coordinateSystem: {
    handedness: "right",
    xAxis: "forward",
    yAxis: "left",
    zAxis: "up",
  },
  suspension: {
    type: "double_wishbone",
    corner: "front_left",
    hardpoints: [
      { id: "uca_front_inboard", label: "UCA front inboard", group: "upper_wishbone", position: { x: 0.18, y: 0.31, z: 0.46 } },
      { id: "uca_rear_inboard", label: "UCA rear inboard", group: "upper_wishbone", position: { x: -0.16, y: 0.30, z: 0.45 } },
      { id: "uca_outboard", label: "UCA outboard", group: "upper_wishbone", position: { x: 0.01, y: 0.64, z: 0.40 } },
      { id: "lca_front_inboard", label: "LCA front inboard", group: "lower_wishbone", position: { x: 0.22, y: 0.27, z: 0.19 } },
      { id: "lca_rear_inboard", label: "LCA rear inboard", group: "lower_wishbone", position: { x: -0.19, y: 0.26, z: 0.18 } },
      { id: "lca_outboard", label: "LCA outboard", group: "lower_wishbone", position: { x: 0.0, y: 0.68, z: 0.17 } },
      { id: "tie_rod_inboard", label: "Tie rod inboard", group: "steering", position: { x: -0.12, y: 0.29, z: 0.25 } },
      { id: "tie_rod_outboard", label: "Tie rod outboard", group: "steering", position: { x: -0.09, y: 0.67, z: 0.26 } },
      { id: "wheel_center", label: "Wheel centre", group: "wheel", position: { x: 0.0, y: 0.72, z: 0.285 } },
    ],
    wheel: { radius: 0.2286, width: 0.18, staticCamberRad: 0, staticToeRad: 0 },
  },
});

export const parseProject = (input: unknown): Project => projectSchema.parse(input);

export const solverDiagnosticsSchema = z.object({
  converged: z.boolean(),
  optimizerSuccess: z.boolean(),
  residualsAccepted: z.boolean(),
  jacobianAccepted: z.boolean(),
  continuityAccepted: z.boolean(),
  residualNormM: z.number().finite().nullable(),
  maxAbsResidualM: z.number().finite().nullable(),
  jacobianRank: z.number().int().min(0),
  jacobianCondition: z.number().finite().nullable(),
  functionEvaluations: z.number().int().min(0),
  message: z.string(),
});

export const kinematicMetricsSchema = z.object({
  camberRad: z.number().finite(),
  camberChangeRad: z.number().finite(),
  camberGainRadPerM: z.number().finite().nullable(),
  toeRad: z.number().finite(),
  bumpSteerRad: z.number().finite(),
  bumpSteerGradientRadPerM: z.number().finite().nullable(),
  casterRad: z.number().finite(),
  kpiRad: z.number().finite(),
  trackChangeM: z.number().finite(),
  rollCenterHeightM: z.number().finite().nullable(),
  instantCenterYM: z.number().finite().nullable(),
  instantCenterZM: z.number().finite().nullable(),
});

export const kinematicPoseSchema = z.object({
  hardpoints: z.record(z.string(), vec3Schema),
  wheelAxis: vec3Schema,
  translation: vec3Schema,
  rotationVector: vec3Schema,
});

export const kinematicStateSchema = z.object({
  travelM: z.number().finite(),
  calculationStatus: z.enum(["VERIFIED_NUMERICALLY", "FAILED"]),
  pose: kinematicPoseSchema.nullable(),
  metrics: kinematicMetricsSchema.nullable(),
  diagnostics: solverDiagnosticsSchema,
  warnings: z.array(z.string()),
});

export const validationStatusSchema = z.object({
  numerical: z.enum(["VERIFIED_NUMERICALLY", "FAILED"]),
  reference: z.literal("REFERENCE_BENCHMARKED"),
  physical: z.literal("UNVALIDATED_PHYSICALLY"),
  engineeringApproval: z.literal("NOT_APPROVED"),
});

export const inputProvenanceSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  dataClassification: z.enum(["demonstration", "team_private"]),
  declaredModelStatus: z.enum([
    "demonstration",
    "unvalidated",
    "benchmarked",
    "experimentally_validated",
  ]),
  projectInputSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const phase3CalculationStatusSchema = z.enum([
  "VERIFIED_NUMERICALLY",
  "NOT_COMPUTABLE",
  "FAILED",
]);

export const phase3ValidationStatusSchema = z.object({
  numerical: phase3CalculationStatusSchema,
  reference: z.literal("REFERENCE_BENCHMARKED"),
  physical: z.literal("UNVALIDATED_PHYSICALLY"),
  engineeringApproval: z.literal("NOT_APPROVED"),
});

export const memberForceSchema = z.object({
  id: z.string(),
  axialForceN: z.number().finite(),
  state: z.enum(["TENSION", "COMPRESSION", "ZERO"]),
  forceOnUprightN: vec3Schema,
  chassisReactionN: vec3Schema,
  uprightPointM: vec3Schema,
});

export const uprightEquilibriumResponseSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  calculationStatus: phase3CalculationStatusSchema,
  validationStatus: phase3ValidationStatusSchema,
  solverVersion: z.string(),
  units: z.object({ force: z.literal("N"), moment: z.literal("N*m"), length: z.literal("m") }),
  inputProvenance: inputProvenanceSchema,
  pose: kinematicPoseSchema,
  memberForces: z.array(memberForceSchema),
  diagnostics: z.object({
    matrixRows: z.number().int(),
    matrixColumns: z.number().int(),
    matrixRank: z.number().int(),
    conditionNumber: z.number().finite().nullable(),
    forceResidualN: vec3Schema,
    momentResidualNm: vec3Schema,
    forceResidualNormN: z.number().finite(),
    momentResidualNormNm: z.number().finite(),
    characteristicLengthM: z.number().finite(),
    message: z.string(),
  }),
  warnings: z.array(z.string()),
});

export const vehicleLoadTransferResponseSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  calculationStatus: phase3CalculationStatusSchema,
  validationStatus: phase3ValidationStatusSchema,
  solverVersion: z.string(),
  modelName: z.literal("rigid_body_with_elastic_roll_stiffness_distribution"),
  units: z.object({ mass: z.literal("kg"), length: z.literal("m"), acceleration: z.literal("m/s^2"), force: z.literal("N") }),
  axleLoads: z.object({ frontN: z.number().finite(), rearN: z.number().finite() }).nullable(),
  wheelLoads: z.object({
    frontLeftN: z.number().finite(),
    frontRightN: z.number().finite(),
    rearLeftN: z.number().finite(),
    rearRightN: z.number().finite(),
  }).nullable(),
  longitudinalTransferN: z.number().finite().nullable(),
  frontLateralTransferN: z.number().finite().nullable(),
  rearLateralTransferN: z.number().finite().nullable(),
  totalWeightN: z.number().finite().nullable(),
  forceResidualN: z.number().finite().nullable(),
  warnings: z.array(z.string()),
});

export const actuationSeriesResponseSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  calculationStatus: phase3CalculationStatusSchema,
  validationStatus: phase3ValidationStatusSchema,
  solverVersion: z.string(),
  units: z.object({
    length: z.literal("m"),
    force: z.literal("N"),
    springRate: z.literal("N/m"),
    energy: z.literal("J"),
    motionRatio: z.literal("m/m"),
  }),
  samples: z.array(z.object({
    wheelTravelM: z.number().finite(),
    springLengthM: z.number().finite(),
    springCompressionM: z.number().finite(),
    motionRatio: z.number().finite(),
    springForceN: z.number().finite(),
    storedEnergyJ: z.number().finite(),
    wheelForceN: z.number().finite(),
    wheelRateNPerM: z.number().finite(),
  })),
  warnings: z.array(z.string()),
});

export const quarterCarParametersSchema = z.object({
  sprungMassKg: z.number().finite().positive(),
  unsprungMassKg: z.number().finite().positive(),
  suspensionStiffnessNPerM: z.number().finite().positive(),
  suspensionDampingNsPerM: z.number().finite().nonnegative(),
  tireStiffnessNPerM: z.number().finite().positive(),
  tireDampingNsPerM: z.number().finite().nonnegative().default(0),
  staticTireLoadN: z.number().finite().nonnegative().nullable().default(null),
});

export const roadProfileSchema = z.object({
  kind: z.enum(["step", "smooth_bump", "half_sine", "sine", "sampled"]),
  amplitudeM: z.number().finite().default(0),
  startTimeS: z.number().finite().nonnegative().default(0),
  durationS: z.number().finite().default(0.1),
  frequencyHz: z.number().finite().default(1),
  sampleTimesS: z.array(z.number().finite()).default([]),
  sampleDisplacementsM: z.array(z.number().finite()).default([]),
});

export const quarterCarSimulationRequestSchema = z.object({
  dataClassification: z.enum(["demonstration", "team_private"]),
  sourceLabel: z.string().min(1).max(160),
  parameters: quarterCarParametersSchema,
  road: roadProfileSchema,
  initialState: z.object({
    sprungDisplacementM: z.number().finite().default(0),
    sprungVelocityMps: z.number().finite().default(0),
    unsprungDisplacementM: z.number().finite().default(0),
    unsprungVelocityMps: z.number().finite().default(0),
  }),
  settings: z.object({
    durationS: z.number().finite().positive(),
    outputSamples: z.number().int().min(2).max(20001),
    relativeTolerance: z.number().finite().min(1e-12).max(1e-2),
    absoluteTolerance: z.number().finite().min(1e-14).max(1e-3),
    maximumStepS: z.number().finite().positive(),
    method: z.enum(["DOP853", "Radau", "BDF"]),
  }),
});

export const quarterCarSampleSchema = z.object({
  timeS: z.number().finite(),
  roadDisplacementM: z.number().finite(),
  roadVelocityMps: z.number().finite(),
  sprungDisplacementM: z.number().finite(),
  sprungVelocityMps: z.number().finite(),
  sprungAccelerationMps2: z.number().finite(),
  unsprungDisplacementM: z.number().finite(),
  unsprungVelocityMps: z.number().finite(),
  unsprungAccelerationMps2: z.number().finite(),
  suspensionTravelM: z.number().finite(),
  tireCompressionM: z.number().finite(),
  suspensionForceOnSprungN: z.number().finite(),
  tireForceIncrementN: z.number().finite(),
  totalTireContactForceN: z.number().finite().nullable(),
  mechanicalEnergyJ: z.number().finite(),
  dissipatedPowerW: z.number().finite(),
  roadInputPowerW: z.number().finite(),
});

export const quarterCarSimulationResponseSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  modelName: z.literal("linear_quarter_car_2dof"),
  calculationStatus: phase3CalculationStatusSchema,
  validationStatus: phase3ValidationStatusSchema,
  solverVersion: z.string().min(1),
  units: z.object({
    time: z.literal("s"),
    displacement: z.literal("m"),
    velocity: z.literal("m/s"),
    acceleration: z.literal("m/s^2"),
    force: z.literal("N"),
    energy: z.literal("J"),
    power: z.literal("W"),
  }),
  inputProvenance: z.object({
    dataClassification: z.enum(["demonstration", "team_private"]),
    sourceLabel: z.string().min(1),
    inputSha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  naturalFrequenciesHz: z.array(z.number().finite().positive()).length(2).nullable(),
  diagnostics: z.object({
    solverSuccess: z.boolean(),
    finiteStates: z.boolean(),
    contactAccepted: z.boolean().nullable(),
    functionEvaluations: z.number().int().nonnegative(),
    jacobianEvaluations: z.number().int().nonnegative(),
    luDecompositions: z.number().int().nonnegative(),
    integrationMethod: z.enum(["DOP853", "Radau", "BDF"]),
    relativeTolerance: z.number().finite().positive(),
    absoluteTolerance: z.number().finite().positive(),
    maximumStepS: z.number().finite().positive(),
    acceptedSteps: z.number().int().nonnegative(),
    minimumAcceptedStepS: z.number().finite().positive().nullable(),
    maximumAcceptedStepS: z.number().finite().positive().nullable(),
    initialEnergyJ: z.number().finite().nullable(),
    finalEnergyJ: z.number().finite().nullable(),
    roadInputWorkJ: z.number().finite().nullable(),
    dissipatedEnergyJ: z.number().finite().nullable(),
    energyBalanceResidualJ: z.number().finite().nullable(),
    relativeEnergyBalanceError: z.number().finite().nullable(),
    minimumTotalContactForceN: z.number().finite().nullable(),
    message: z.string(),
  }),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
  samples: z.array(quarterCarSampleSchema),
});

export const solverMetadataSchema = z.object({
  name: z.literal("rigid_upright_double_wishbone"),
  version: z.string().min(1),
  residualToleranceM: z.number().finite().positive(),
  rankRelativeTolerance: z.number().finite().positive(),
  conditionLimit: z.number().finite().positive(),
  continuityPositionLimitM: z.number().finite().positive(),
  continuityRotationLimitRad: z.number().finite().positive(),
  maximumTravelStepM: z.number().finite().positive(),
  maxFunctionEvaluations: z.number().int().positive(),
  gradientMethod: z.literal("second_order_nonuniform_finite_difference"),
});

export const kinematicsSweepResponseSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  modelStatus: z.literal("unvalidated"),
  units: z.object({
    length: z.literal("m"),
    angle: z.literal("rad"),
    camberGain: z.literal("rad/m"),
    bumpSteerGradient: z.literal("rad/m"),
  }),
  allConverged: z.boolean(),
  validationStatus: validationStatusSchema,
  solver: solverMetadataSchema,
  inputProvenance: inputProvenanceSchema,
  warnings: z.array(z.string()),
  residualToleranceM: z.number().finite().positive(),
  states: z.array(kinematicStateSchema).min(1),
});

export type SolverDiagnostics = z.infer<typeof solverDiagnosticsSchema>;
export type KinematicMetrics = z.infer<typeof kinematicMetricsSchema>;
export type KinematicPose = z.infer<typeof kinematicPoseSchema>;
export type KinematicState = z.infer<typeof kinematicStateSchema>;
export type ValidationStatus = z.infer<typeof validationStatusSchema>;
export type SolverMetadata = z.infer<typeof solverMetadataSchema>;
export type InputProvenance = z.infer<typeof inputProvenanceSchema>;
export type KinematicsSweepResponse = z.infer<typeof kinematicsSweepResponseSchema>;
export type Phase3CalculationStatus = z.infer<typeof phase3CalculationStatusSchema>;
export type Phase3ValidationStatus = z.infer<typeof phase3ValidationStatusSchema>;
export type MemberForce = z.infer<typeof memberForceSchema>;
export type UprightEquilibriumResponse = z.infer<typeof uprightEquilibriumResponseSchema>;
export type VehicleLoadTransferResponse = z.infer<typeof vehicleLoadTransferResponseSchema>;
export type ActuationSeriesResponse = z.infer<typeof actuationSeriesResponseSchema>;
export type QuarterCarParameters = z.infer<typeof quarterCarParametersSchema>;
export type RoadProfile = z.infer<typeof roadProfileSchema>;
export type QuarterCarSimulationRequest = z.infer<typeof quarterCarSimulationRequestSchema>;
export type QuarterCarSample = z.infer<typeof quarterCarSampleSchema>;
export type QuarterCarSimulationResponse = z.infer<typeof quarterCarSimulationResponseSchema>;

