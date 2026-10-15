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
  }),
});

export type Vec3 = z.infer<typeof vec3Schema>;
export type Hardpoint = z.infer<typeof hardpointSchema>;
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
  pose: kinematicPoseSchema.nullable(),
  metrics: kinematicMetricsSchema.nullable(),
  diagnostics: solverDiagnosticsSchema,
  warnings: z.array(z.string()),
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
  residualToleranceM: z.number().finite().positive(),
  states: z.array(kinematicStateSchema).min(1),
});

export type SolverDiagnostics = z.infer<typeof solverDiagnosticsSchema>;
export type KinematicMetrics = z.infer<typeof kinematicMetricsSchema>;
export type KinematicPose = z.infer<typeof kinematicPoseSchema>;
export type KinematicState = z.infer<typeof kinematicStateSchema>;
export type KinematicsSweepResponse = z.infer<typeof kinematicsSweepResponseSchema>;

