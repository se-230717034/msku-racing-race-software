import { z } from "zod";

export const API_SCHEMA_VERSION = "1.0.0" as const;
export const PROJECT_SCHEMA_VERSION = "2.0.0" as const;

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

export const cornerIdSchema = z.enum(["front_left", "front_right", "rear_left", "rear_right"]);

export const suspensionSchema = z.object({
  type: z.literal("double_wishbone"),
  corner: cornerIdSchema,
  hardpoints: z.array(hardpointSchema).length(9),
  wheel: z.object({
    radius: z.number().finite().positive(),
    width: z.number().finite().positive(),
    staticCamberRad: z.number().finite().min(-0.35).max(0.35).default(0),
    staticToeRad: z.number().finite().min(-0.35).max(0.35).default(0),
  }),
  actuation: actuationGeometrySchema.optional(),
});

export const vehicleCornerSchema = z.object({
  id: cornerIdSchema,
  label: z.string().min(1),
  geometrySource: z.enum(["independent", "mirrored_assumption", "synthetic_demo"]),
  derivedFrom: cornerIdSchema.optional(),
  provenanceNote: z.string().min(1).max(500),
  suspension: suspensionSchema,
});

export const validationEvidenceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["numerical_benchmark", "cad_comparison", "physical_measurement", "input_provenance"]),
  title: z.string().min(1).max(160),
  source: z.string().min(1).max(300),
  recordedAt: z.string().datetime(),
  status: z.enum(["pending_review", "accepted", "rejected"]),
  notes: z.string().max(1000),
});

export const engineeringModuleSchema = z.enum([
  "geometry",
  "kinematics",
  "quasi_static",
  "quarter_car",
  "full_car_7dof",
  "bicycle",
  "optimization",
]);

export const independentVerificationEvidenceSchema = z.object({
  id: z.string().min(1).max(160),
  kind: z.enum([
    "input_declaration",
    "numerical_benchmark",
    "reference_benchmark",
    "physical_correlation",
  ]),
  title: z.string().min(1).max(200),
  source: z.string().min(1).max(500),
  recordedAt: z.string().datetime().nullable().optional(),
  reviewStatus: z.enum(["pending_review", "accepted", "rejected"]),
  notes: z.string().max(1000).default(""),
  artifactSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional(),
});

const verificationAxisSchema = <T extends z.ZodTypeAny>(status: T) => z.object({
  status,
  evidenceIds: z.array(z.string()).default([]),
});

export const independentVerificationSchema = z.object({
  declared: verificationAxisSchema(z.enum(["DECLARED", "NOT_DECLARED"])),
  numerical: verificationAxisSchema(z.enum([
    "VERIFIED_NUMERICALLY", "PARTIALLY_VERIFIED", "UNVERIFIED", "FAILED",
  ])),
  reference: verificationAxisSchema(z.enum([
    "REFERENCE_BENCHMARKED", "PARTIALLY_BENCHMARKED", "NOT_BENCHMARKED",
  ])),
  physical: verificationAxisSchema(z.enum([
    "PHYSICALLY_CORRELATED", "PARTIALLY_CORRELATED", "UNVALIDATED_PHYSICALLY",
  ])),
  evidence: z.array(independentVerificationEvidenceSchema).default([]),
}).superRefine((verification, context) => {
  const evidence = new Map(verification.evidence.map((item) => [item.id, item]));
  if (evidence.size !== verification.evidence.length) {
    context.addIssue({ code: "custom", message: "Verification evidence identifiers must be unique." });
  }
  const requirements = [
    {
      active: verification.declared.status === "DECLARED",
      ids: verification.declared.evidenceIds,
      kind: "input_declaration",
      axis: "declared",
    },
    {
      active: ["VERIFIED_NUMERICALLY", "PARTIALLY_VERIFIED"].includes(verification.numerical.status),
      ids: verification.numerical.evidenceIds,
      kind: "numerical_benchmark",
      axis: "numerical",
    },
    {
      active: ["REFERENCE_BENCHMARKED", "PARTIALLY_BENCHMARKED"].includes(verification.reference.status),
      ids: verification.reference.evidenceIds,
      kind: "reference_benchmark",
      axis: "reference",
    },
    {
      active: ["PHYSICALLY_CORRELATED", "PARTIALLY_CORRELATED"].includes(verification.physical.status),
      ids: verification.physical.evidenceIds,
      kind: "physical_correlation",
      axis: "physical",
    },
  ] as const;
  for (const requirement of requirements) {
    if (requirement.active && requirement.ids.length === 0) {
      context.addIssue({ code: "custom", message: `The ${requirement.axis} state requires accepted evidence.` });
    }
    for (const id of requirement.ids) {
      const item = evidence.get(id);
      if (!item || item.reviewStatus !== "accepted" || item.kind !== requirement.kind) {
        context.addIssue({ code: "custom", message: `Invalid evidence ${id} for ${requirement.axis} verification.` });
      }
    }
  }
});

export const vehicleParameterManifestSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  manifestId: z.string().min(1).max(160),
  revision: z.number().int().min(1),
  vehicleId: z.string().min(1).max(160),
  configurationId: z.string().min(1).max(160),
  configurationLabel: z.string().min(1).max(300),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  parameters: z.array(z.object({
    key: z.string().min(1).max(200),
    value: z.union([z.number().finite(), z.array(z.number().finite()).min(1)]),
    unit: z.string().min(1).max(40),
    measurementStatus: z.enum([
      "SYNTHETIC", "DECLARED_UNMEASURED", "MEASURED", "DERIVED_FROM_MEASURED",
    ]),
    source: z.object({
      kind: z.enum([
        "synthetic_assumption", "cad", "physical_measurement", "manufacturer_data",
        "derived", "legacy_import",
      ]),
      label: z.string().min(1).max(300),
      reference: z.string().max(500).nullable().optional(),
      recordedAt: z.string().datetime().nullable().optional(),
      notes: z.string().max(1000).default(""),
    }),
    applicableModules: z.array(engineeringModuleSchema).min(1),
    uncertainty: z.object({
      value: z.number().finite().nonnegative(),
      unit: z.string().min(1).max(40),
      kind: z.enum(["standard", "expanded", "bound"]),
      coverageFactor: z.number().finite().positive().nullable().optional(),
      confidence: z.number().finite().positive().max(1).nullable().optional(),
    }).nullable().optional(),
    evidenceIds: z.array(z.string()).default([]),
  })).min(1),
  verification: independentVerificationSchema,
}).superRefine((manifest, context) => {
  const keys = new Set<string>();
  const evidenceIds = new Set(manifest.verification.evidence.map((item) => item.id));
  for (const parameter of manifest.parameters) {
    if (keys.has(parameter.key)) {
      context.addIssue({ code: "custom", message: `Duplicate parameter key ${parameter.key}.` });
    }
    keys.add(parameter.key);
    if (parameter.source.kind === "synthetic_assumption" && parameter.measurementStatus !== "SYNTHETIC") {
      context.addIssue({ code: "custom", message: `Synthetic parameter ${parameter.key} cannot be presented as measured.` });
    }
    if (parameter.measurementStatus === "MEASURED" && parameter.source.kind !== "physical_measurement") {
      context.addIssue({ code: "custom", message: `Measured parameter ${parameter.key} requires a physical measurement source.` });
    }
    if (parameter.uncertainty && parameter.uncertainty.unit !== parameter.unit) {
      context.addIssue({ code: "custom", message: `Uncertainty unit for ${parameter.key} must match its unit.` });
    }
    for (const evidenceId of parameter.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        context.addIssue({ code: "custom", message: `Parameter ${parameter.key} references missing evidence ${evidenceId}.` });
      }
    }
  }
});

export const vehicleParameterManifestSummarySchema = z.object({
  manifestId: z.string().min(1),
  revision: z.number().int().min(1),
  vehicleId: z.string().min(1),
  configurationId: z.string().min(1),
  configurationLabel: z.string().min(1),
  manifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
};

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
  activeCornerId: cornerIdSchema,
  suspension: suspensionSchema,
  vehicle: z.object({
    wheelbaseM: z.number().finite().positive(),
    frontTrackM: z.number().finite().positive(),
    rearTrackM: z.number().finite().positive(),
    cgPositionM: vec3Schema,
    massProperties: z.object({
      totalMassKg: z.number().finite().positive().nullable(),
      sprungMassKg: z.number().finite().positive().nullable(),
      rollInertiaKgM2: z.number().finite().positive().nullable(),
      pitchInertiaKgM2: z.number().finite().positive().nullable(),
      yawInertiaKgM2: z.number().finite().positive().nullable(),
      provenanceNote: z.string().min(1).max(500),
    }),
    corners: z.object({
      front_left: vehicleCornerSchema,
      front_right: vehicleCornerSchema,
      rear_left: vehicleCornerSchema,
      rear_right: vehicleCornerSchema,
    }),
  }),
  provenance: z.object({
    sourceLabel: z.string().min(1).max(300),
    migratedFromSchemaVersion: z.string().optional(),
    migrationNote: z.string().max(500).optional(),
  }),
  validation: z.object({
    numerical: z.enum(["VERIFIED_NUMERICALLY", "PARTIALLY_VERIFIED", "UNVERIFIED"]),
    reference: z.enum(["REFERENCE_BENCHMARKED", "PARTIALLY_BENCHMARKED", "NOT_BENCHMARKED"]),
    physical: z.literal("UNVALIDATED_PHYSICALLY"),
    engineeringApproval: z.literal("NOT_APPROVED"),
    evidence: z.array(validationEvidenceSchema),
  }),
  parameterManifest: vehicleParameterManifestSchema.optional(),
  verification: independentVerificationSchema.optional(),
}).superRefine((project, context) => {
  const active = project.vehicle.corners[project.activeCornerId];
  if (active.id !== project.activeCornerId || active.suspension.corner !== project.activeCornerId) {
    context.addIssue({ code: "custom", message: "Active corner identifiers must be internally consistent." });
  }
  if (canonicalJson(active.suspension) !== canonicalJson(project.suspension)) {
    context.addIssue({ code: "custom", message: "The active suspension snapshot must match vehicle.corners[activeCornerId]." });
  }
  for (const cornerId of cornerIdSchema.options) {
    const corner = project.vehicle.corners[cornerId];
    if (corner.id !== cornerId || corner.suspension.corner !== cornerId) {
      context.addIssue({ code: "custom", message: `Corner key ${cornerId} does not match its identifiers.` });
    }
    if (corner.geometrySource === "mirrored_assumption" && !corner.derivedFrom) {
      context.addIssue({ code: "custom", message: `Mirrored corner ${cornerId} must identify its source corner.` });
    }
  }
});

export type Vec3 = z.infer<typeof vec3Schema>;
export type Hardpoint = z.infer<typeof hardpointSchema>;
export type ActuationGeometry = z.infer<typeof actuationGeometrySchema>;
export type CornerId = z.infer<typeof cornerIdSchema>;
export type Suspension = z.infer<typeof suspensionSchema>;
export type VehicleCorner = z.infer<typeof vehicleCornerSchema>;
export type ValidationEvidence = z.infer<typeof validationEvidenceSchema>;
export type IndependentVerificationEvidence = z.infer<typeof independentVerificationEvidenceSchema>;
export type IndependentVerification = z.infer<typeof independentVerificationSchema>;
export type VehicleParameterManifest = z.infer<typeof vehicleParameterManifestSchema>;
export type VehicleParameterManifestSummary = z.infer<typeof vehicleParameterManifestSummarySchema>;
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

const frontLeftDemoSuspension = (): Suspension => ({
  type: "double_wishbone",
  corner: "front_left",
  hardpoints: [
    { id: "uca_front_inboard", label: "Üst salıncak ön iç", group: "upper_wishbone", position: { x: 0.18, y: 0.31, z: 0.46 } },
    { id: "uca_rear_inboard", label: "Üst salıncak arka iç", group: "upper_wishbone", position: { x: -0.16, y: 0.30, z: 0.45 } },
    { id: "uca_outboard", label: "Üst salıncak dış", group: "upper_wishbone", position: { x: 0.01, y: 0.64, z: 0.40 } },
    { id: "lca_front_inboard", label: "Alt salıncak ön iç", group: "lower_wishbone", position: { x: 0.22, y: 0.27, z: 0.19 } },
    { id: "lca_rear_inboard", label: "Alt salıncak arka iç", group: "lower_wishbone", position: { x: -0.19, y: 0.26, z: 0.18 } },
    { id: "lca_outboard", label: "Alt salıncak dış", group: "lower_wishbone", position: { x: 0.0, y: 0.68, z: 0.17 } },
    { id: "tie_rod_inboard", label: "Rot kolu iç", group: "steering", position: { x: -0.12, y: 0.29, z: 0.25 } },
    { id: "tie_rod_outboard", label: "Rot kolu dış", group: "steering", position: { x: -0.09, y: 0.67, z: 0.26 } },
    { id: "wheel_center", label: "Tekerlek merkezi", group: "wheel", position: { x: 0.0, y: 0.72, z: 0.285 } },
  ],
  wheel: { radius: 0.2286, width: 0.18, staticCamberRad: 0, staticToeRad: 0 },
});

const cloneSuspensionForCorner = (
  source: Suspension,
  corner: CornerId,
  adjustments: Partial<Record<string, Vec3>> = {},
): Suspension => {
  const side = corner.endsWith("left") ? 1 : -1;
  return {
    ...source,
    corner,
    hardpoints: source.hardpoints.map((point) => {
      const adjusted = adjustments[point.id] ?? point.position;
      return { ...point, position: { ...adjusted, y: Math.abs(adjusted.y) * side } };
    }),
    wheel: { ...source.wheel },
  };
};

const demoCorners = (): Project["vehicle"]["corners"] => {
  const frontLeft = frontLeftDemoSuspension();
  const rearLeft = cloneSuspensionForCorner(frontLeft, "rear_left", {
    uca_front_inboard: { x: 0.17, y: 0.30, z: 0.44 },
    uca_rear_inboard: { x: -0.15, y: 0.29, z: 0.43 },
    uca_outboard: { x: 0.0, y: 0.62, z: 0.385 },
    lca_front_inboard: { x: 0.20, y: 0.26, z: 0.185 },
    lca_rear_inboard: { x: -0.18, y: 0.25, z: 0.175 },
    lca_outboard: { x: 0.0, y: 0.65, z: 0.165 },
    tie_rod_inboard: { x: 0.11, y: 0.28, z: 0.245 },
    tie_rod_outboard: { x: 0.08, y: 0.64, z: 0.25 },
    wheel_center: { x: 0.0, y: 0.70, z: 0.285 },
  });
  const frontRight = cloneSuspensionForCorner(frontLeft, "front_right");
  const rearRight = cloneSuspensionForCorner(rearLeft, "rear_right");
  return {
    front_left: { id: "front_left", label: "Ön sol", geometrySource: "synthetic_demo", provenanceNote: "Bağımsız sentetik Faz 6 gösterim tanımıdır; araç verisi değildir.", suspension: frontLeft },
    front_right: { id: "front_right", label: "Ön sağ", geometrySource: "mirrored_assumption", derivedFrom: "front_left", provenanceNote: "Sentetik ön sol tanımından açık ayna varsayımıyla türetilmiştir.", suspension: frontRight },
    rear_left: { id: "rear_left", label: "Arka sol", geometrySource: "synthetic_demo", provenanceNote: "Bağımsız sentetik arka geometridir; ön akstan kopyalanmamıştır ve araç verisi değildir.", suspension: rearLeft },
    rear_right: { id: "rear_right", label: "Arka sağ", geometrySource: "mirrored_assumption", derivedFrom: "rear_left", provenanceNote: "Sentetik arka sol tanımından açık ayna varsayımıyla türetilmiştir.", suspension: rearRight },
  };
};

export const createDemoProject = (projectId = "msku-demo-full-vehicle"): Project => {
  const corners = demoCorners();
  const declarationEvidence = {
    id: "demo-input-declaration",
    kind: "input_declaration" as const,
    title: "Paketlenmiş sentetik gösterim girdisi",
    source: "@msku/contracts createDemoProject",
    recordedAt: "2026-10-15T00:00:00.000Z",
    reviewStatus: "accepted" as const,
    notes: "Bu kayıt bir ölçüm kanıtı değildir; yalnız sentetik girdiyi beyan eder.",
  };
  const verification = {
    declared: { status: "DECLARED" as const, evidenceIds: [declarationEvidence.id] },
    numerical: { status: "UNVERIFIED" as const, evidenceIds: [] },
    reference: { status: "NOT_BENCHMARKED" as const, evidenceIds: [] },
    physical: { status: "UNVALIDATED_PHYSICALLY" as const, evidenceIds: [] },
    evidence: [declarationEvidence],
  };
  return ({
  schemaVersion: PROJECT_SCHEMA_VERSION,
  projectId,
  name: "Tam araç gösterim projesi",
  description: "Yalnızca yazılım gösterimi için dört köşeli sentetik geometridir; MSKU Racing araç verisi değildir.",
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
  activeCornerId: "front_left",
  suspension: corners.front_left.suspension,
  vehicle: {
    wheelbaseM: 1.6,
    frontTrackM: 1.44,
    rearTrackM: 1.4,
    cgPositionM: { x: 0, y: 0, z: 0.29 },
    massProperties: {
      totalMassKg: 324,
      sprungMassKg: 276,
      rollInertiaKgM2: 80,
      pitchInertiaKgM2: 120,
      yawInertiaKgM2: 150,
      provenanceNote: "Sentetik gösterim değerleridir; tartılmış veya ölçülmüş takım verisiyle değiştirin.",
    },
    corners,
  },
  provenance: { sourceLabel: "Paketlenmiş sentetik Faz 6 gösterim aracı" },
  validation: {
    numerical: "PARTIALLY_VERIFIED",
    reference: "PARTIALLY_BENCHMARKED",
    physical: "UNVALIDATED_PHYSICALLY",
    engineeringApproval: "NOT_APPROVED",
    evidence: [],
  },
  parameterManifest: {
    schemaVersion: "1.0.0",
    manifestId: `${projectId}-parameters`,
    revision: 1,
    vehicleId: projectId,
    configurationId: "synthetic-demo-default",
    configurationLabel: "Sentetik gösterim varsayılanı",
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
    parameters: [
      ["vehicle.mass.total", 324, "kg", ["quasi_static", "bicycle"]],
      ["vehicle.mass.sprung", 276, "kg", ["quarter_car", "full_car_7dof"]],
      ["vehicle.inertia.roll", 80, "kg*m^2", ["full_car_7dof"]],
      ["vehicle.inertia.pitch", 120, "kg*m^2", ["full_car_7dof"]],
      ["vehicle.inertia.yaw", 150, "kg*m^2", ["bicycle"]],
      ["vehicle.wheelbase", 1.6, "m", ["quasi_static", "bicycle"]],
      ["vehicle.track.front", 1.44, "m", ["quasi_static"]],
      ["vehicle.track.rear", 1.4, "m", ["quasi_static"]],
      ["vehicle.cg.position", [0, 0, 0.29], "m", ["quasi_static", "bicycle"]],
    ].map(([key, value, unit, applicableModules]) => ({
      key: key as string,
      value: value as number | number[],
      unit: unit as string,
      measurementStatus: "SYNTHETIC" as const,
      source: {
        kind: "synthetic_assumption" as const,
        label: "Paketlenmiş Faz 6 gösterim değeri; MSKU Racing ölçümü değildir.",
        notes: "Gerçek araç analizi öncesinde izlenebilir ölçümle değiştirilmelidir.",
      },
      applicableModules: applicableModules as z.infer<typeof engineeringModuleSchema>[],
      evidenceIds: [declarationEvidence.id],
    })),
    verification,
  },
  verification,
  });
};

const legacyProjectSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  projectId: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().max(500),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  dataClassification: z.enum(["demonstration", "team_private"]),
  modelStatus: z.enum(["demonstration", "unvalidated", "benchmarked", "experimentally_validated"]),
  units: z.object({ length: z.literal("m"), angle: z.literal("rad") }),
  coordinateSystem: z.object({
    handedness: z.literal("right"),
    xAxis: z.literal("forward"),
    yAxis: z.literal("left"),
    zAxis: z.literal("up"),
  }),
  suspension: suspensionSchema.extend({ corner: z.enum(["front_left", "front_right"]) }),
});

export const migrateLegacyProject = (input: unknown): Project => {
  const legacy = legacyProjectSchema.parse(input);
  const migrated = createDemoProject(legacy.projectId);
  const activeId = legacy.suspension.corner;
  const oppositeId: CornerId = activeId === "front_right" ? "front_left" : "front_right";
  const activeSuspension: Suspension = {
    ...legacy.suspension,
    hardpoints: legacy.suspension.hardpoints.map((point) => ({
      ...point,
      position: { ...point.position },
    })),
    wheel: { ...legacy.suspension.wheel },
  };
  const oppositeSuspension = cloneSuspensionForCorner(activeSuspension, oppositeId);
  const corners = {
    ...migrated.vehicle.corners,
    [activeId]: {
      id: activeId,
      label: activeId.replace("_", " "),
      geometrySource: "independent" as const,
      provenanceNote: "İçe aktarılan 1.0.0 proje şemasından aynen korunmuştur.",
      suspension: activeSuspension,
    },
    [oppositeId]: {
      id: oppositeId,
      label: oppositeId.replace("_", " "),
      geometrySource: "mirrored_assumption" as const,
      derivedFrom: activeId,
      provenanceNote: "Geçiş sırasında açık ayna varsayımıyla üretilmiştir; ölçülmüş geometri değildir.",
      suspension: oppositeSuspension,
    },
  };
  return projectSchema.parse({
    ...migrated,
    name: legacy.name,
    description: legacy.description,
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
    dataClassification: legacy.dataClassification,
    modelStatus: legacy.modelStatus === "experimentally_validated" ? "unvalidated" : legacy.modelStatus,
    units: legacy.units,
    coordinateSystem: legacy.coordinateSystem,
    activeCornerId: activeId,
    suspension: activeSuspension,
    vehicle: { ...migrated.vehicle, corners },
    provenance: {
      sourceLabel: "İçe aktarılan eski proje",
      migratedFromSchemaVersion: "1.0.0",
      migrationNote: "Özgün köşe korundu; eksik köşeler açıkça etiketlenmiş sentetik veya aynalanmış varsayımlar olarak eklendi.",
    },
    validation: {
      numerical: "UNVERIFIED",
      reference: "NOT_BENCHMARKED",
      physical: "UNVALIDATED_PHYSICALLY",
      engineeringApproval: "NOT_APPROVED",
      evidence: [],
    },
  });
};

export const parseProject = (input: unknown): Project => {
  const version = typeof input === "object" && input !== null && "schemaVersion" in input
    ? (input as { schemaVersion?: unknown }).schemaVersion
    : undefined;
  return version === "1.0.0" ? migrateLegacyProject(input) : projectSchema.parse(input);
};

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
  schemaVersion: z.literal(API_SCHEMA_VERSION),
  calculationStatus: phase3CalculationStatusSchema,
  validationStatus: phase3ValidationStatusSchema,
  solverVersion: z.string(),
  units: z.object({ force: z.literal("N"), moment: z.literal("N*m"), length: z.literal("m") }),
  inputProvenance: inputProvenanceSchema,
  parameterManifest: vehicleParameterManifestSummarySchema.nullable().optional(),
  verificationAxes: independentVerificationSchema.optional(),
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
  schemaVersion: z.literal(API_SCHEMA_VERSION),
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
  parameterManifest: vehicleParameterManifestSummarySchema.nullable().optional(),
  verificationAxes: independentVerificationSchema.optional(),
});

export const actuationSeriesResponseSchema = z.object({
  schemaVersion: z.literal(API_SCHEMA_VERSION),
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
  parameterManifest: vehicleParameterManifestSummarySchema.nullable().optional(),
  verificationAxes: independentVerificationSchema.optional(),
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
  parameterManifest: vehicleParameterManifestSchema.optional(),
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
  schemaVersion: z.literal(API_SCHEMA_VERSION),
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
  parameterManifest: vehicleParameterManifestSummarySchema.nullable().optional(),
  verificationAxes: independentVerificationSchema.optional(),
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

export const fullCarCornerParametersSchema = z.object({
  xPositionM: z.number().finite(),
  yPositionM: z.number().finite(),
  unsprungMassKg: z.number().finite().positive(),
  suspensionStiffnessNPerM: z.number().finite().positive(),
  suspensionDampingNsPerM: z.number().finite().nonnegative(),
  tireStiffnessNPerM: z.number().finite().positive(),
  tireDampingNsPerM: z.number().finite().nonnegative(),
  staticTireLoadN: z.number().finite().nonnegative().nullable(),
});

const dynamicsSettingsSchema = z.object({
  durationS: z.number().finite().positive(),
  outputSamples: z.number().int().min(2).max(20001),
  relativeTolerance: z.number().finite().min(1e-12).max(1e-2),
  absoluteTolerance: z.number().finite().min(1e-14).max(1e-3),
  maximumStepS: z.number().finite().positive(),
  method: z.enum(["DOP853", "Radau", "BDF"]),
});

export const fullCarSimulationRequestSchema = z.object({
  dataClassification: z.enum(["demonstration", "team_private"]),
  sourceLabel: z.string().min(1).max(160),
  parameters: z.object({
    sprungMassKg: z.number().finite().positive(),
    pitchInertiaKgM2: z.number().finite().positive(),
    rollInertiaKgM2: z.number().finite().positive(),
    corners: z.array(fullCarCornerParametersSchema).length(4),
  }),
  roadProfiles: z.array(roadProfileSchema).length(4),
  initialState: z.object({
    bodyHeaveM: z.number().finite(),
    bodyHeaveVelocityMps: z.number().finite(),
    pitchRad: z.number().finite(),
    pitchRateRadps: z.number().finite(),
    rollRad: z.number().finite(),
    rollRateRadps: z.number().finite(),
    unsprungDisplacementsM: z.array(z.number().finite()).length(4),
    unsprungVelocitiesMps: z.array(z.number().finite()).length(4),
  }),
  settings: dynamicsSettingsSchema,
  parameterManifest: vehicleParameterManifestSchema.optional(),
});

export const fullCarSampleSchema = z.object({
  timeS: z.number().finite(),
  roadDisplacementsM: z.array(z.number().finite()).length(4),
  roadVelocitiesMps: z.array(z.number().finite()).length(4),
  bodyHeaveM: z.number().finite(),
  bodyHeaveVelocityMps: z.number().finite(),
  bodyHeaveAccelerationMps2: z.number().finite(),
  pitchRad: z.number().finite(),
  pitchRateRadps: z.number().finite(),
  pitchAccelerationRadps2: z.number().finite(),
  rollRad: z.number().finite(),
  rollRateRadps: z.number().finite(),
  rollAccelerationRadps2: z.number().finite(),
  unsprungDisplacementsM: z.array(z.number().finite()).length(4),
  unsprungVelocitiesMps: z.array(z.number().finite()).length(4),
  unsprungAccelerationsMps2: z.array(z.number().finite()).length(4),
  suspensionTravelsM: z.array(z.number().finite()).length(4),
  tireCompressionsM: z.array(z.number().finite()).length(4),
  suspensionForcesOnBodyN: z.array(z.number().finite()).length(4),
  tireForceIncrementsN: z.array(z.number().finite()).length(4),
  totalTireContactForcesN: z.array(z.number().finite().nullable()).length(4),
  mechanicalEnergyJ: z.number().finite(),
  dissipatedPowerW: z.number().finite(),
  roadInputPowerW: z.number().finite(),
});

export const fullCarSimulationResponseSchema = z.object({
  schemaVersion: z.literal(API_SCHEMA_VERSION),
  modelName: z.literal("linear_full_car_7dof"),
  calculationStatus: phase3CalculationStatusSchema,
  validationStatus: phase3ValidationStatusSchema,
  solverVersion: z.string().min(1),
  units: z.record(z.string(), z.string()),
  inputProvenance: z.object({
    dataClassification: z.enum(["demonstration", "team_private"]),
    sourceLabel: z.string().min(1),
    inputSha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  parameterManifest: vehicleParameterManifestSummarySchema.nullable().optional(),
  verificationAxes: independentVerificationSchema.optional(),
  naturalFrequenciesHz: z.array(z.number().finite().positive()).length(7).nullable(),
  cornerOrder: z.tuple([
    z.literal("front_left"), z.literal("front_right"),
    z.literal("rear_left"), z.literal("rear_right"),
  ]),
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
    massMatrixCondition: z.number().finite().positive().nullable(),
    stiffnessMatrixCondition: z.number().finite().positive().nullable(),
    initialEnergyJ: z.number().finite().nullable(),
    finalEnergyJ: z.number().finite().nullable(),
    roadInputWorkJ: z.number().finite().nullable(),
    dissipatedEnergyJ: z.number().finite().nullable(),
    energyBalanceResidualJ: z.number().finite().nullable(),
    relativeEnergyBalanceError: z.number().finite().nonnegative().nullable(),
    minimumTotalContactForceN: z.number().finite().nullable(),
    contactLossCorner: z.string().nullable(),
    message: z.string(),
  }),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
  samples: z.array(fullCarSampleSchema),
});

export const bicycleSimulationRequestSchema = z.object({
  dataClassification: z.enum(["demonstration", "team_private"]),
  sourceLabel: z.string().min(1).max(160),
  parameters: z.object({
    massKg: z.number().finite().positive(),
    yawInertiaKgM2: z.number().finite().positive(),
    cgToFrontAxleM: z.number().finite().positive(),
    cgToRearAxleM: z.number().finite().positive(),
    frontCorneringStiffnessNPerRad: z.number().finite().positive(),
    rearCorneringStiffnessNPerRad: z.number().finite().positive(),
    speedMps: z.number().finite().positive(),
  }),
  steering: z.object({
    kind: z.enum(["step", "smooth_step", "sine", "sampled"]),
    amplitudeRad: z.number().finite(),
    startTimeS: z.number().finite().nonnegative(),
    riseTimeS: z.number().finite(),
    frequencyHz: z.number().finite(),
    sampleTimesS: z.array(z.number().finite()),
    sampleAnglesRad: z.array(z.number().finite()),
  }),
  initialState: z.object({
    lateralVelocityMps: z.number().finite(),
    yawRateRadps: z.number().finite(),
  }),
  domainLimits: z.object({
    maximumAbsSteeringRad: z.number().finite().positive(),
    maximumAbsSideslipRad: z.number().finite().positive(),
    maximumAbsTireSlipRad: z.number().finite().positive(),
  }),
  settings: dynamicsSettingsSchema,
  parameterManifest: vehicleParameterManifestSchema.optional(),
});

export const bicycleSampleSchema = z.object({
  timeS: z.number().finite(),
  steeringRad: z.number().finite(),
  lateralVelocityMps: z.number().finite(),
  yawRateRadps: z.number().finite(),
  sideslipRad: z.number().finite(),
  lateralAccelerationMps2: z.number().finite(),
  frontSlipAngleRad: z.number().finite(),
  rearSlipAngleRad: z.number().finite(),
  frontLateralForceN: z.number().finite(),
  rearLateralForceN: z.number().finite(),
});

export const bicycleSimulationResponseSchema = z.object({
  schemaVersion: z.literal(API_SCHEMA_VERSION),
  modelName: z.literal("linear_planar_bicycle"),
  calculationStatus: phase3CalculationStatusSchema,
  validationStatus: phase3ValidationStatusSchema,
  solverVersion: z.string().min(1),
  units: z.record(z.string(), z.string()),
  inputProvenance: z.object({
    dataClassification: z.enum(["demonstration", "team_private"]),
    sourceLabel: z.string().min(1),
    inputSha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  parameterManifest: vehicleParameterManifestSummarySchema.nullable().optional(),
  verificationAxes: independentVerificationSchema.optional(),
  diagnostics: z.object({
    solverSuccess: z.boolean(),
    finiteStates: z.boolean(),
    stable: z.boolean().nullable(),
    domainAccepted: z.boolean(),
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
    eigenvaluesReal: z.array(z.number().finite()).length(2).nullable(),
    eigenvaluesImag: z.array(z.number().finite()).length(2).nullable(),
    understeerCoefficientS2PerM: z.number().finite().nullable(),
    characteristicSpeedMps: z.number().finite().positive().nullable(),
    criticalSpeedMps: z.number().finite().positive().nullable(),
    steadyStateYawRateGainPerS: z.number().finite().nullable(),
    steadyStateSideslipGain: z.number().finite().nullable(),
    maximumAbsSideslipRad: z.number().finite().nonnegative().nullable(),
    maximumAbsFrontSlipRad: z.number().finite().nonnegative().nullable(),
    maximumAbsRearSlipRad: z.number().finite().nonnegative().nullable(),
    message: z.string(),
  }),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
  samples: z.array(bicycleSampleSchema),
});

export const optimizationDesignVariableSchema = z.object({
  path: z.string().min(1).max(160),
  lowerBound: z.number().finite(),
  upperBound: z.number().finite(),
}).refine((value) => value.lowerBound < value.upperBound, {
  message: "lowerBound must be less than upperBound",
});

export const optimizationObjectiveSchema = z.object({
  id: z.string().min(1).max(120),
  goal: z.enum(["minimize", "target"]),
  targetValue: z.number().finite().nullable(),
  weight: z.number().finite().positive(),
  normalization: z.number().finite().positive(),
}).refine((value) => value.goal !== "target" || value.targetValue !== null, {
  message: "targetValue is required for a target objective",
});

export const engineeringOptimizationRequestSchema = z.object({
  model: z.enum(["kinematics", "quarter_car", "full_car", "bicycle"]),
  designVariables: z.array(optimizationDesignVariableSchema).min(1).max(24),
  objectives: z.array(optimizationObjectiveSchema).min(1).max(8),
  constraints: z.object({
    minimumLinkLengthM: z.number().finite().positive(),
    maximumAbsSuspensionTravelM: z.number().finite().positive().nullable(),
    requireWheelContact: z.boolean(),
    requireStableHandling: z.boolean(),
  }),
  settings: z.object({
    seed: z.number().int().min(0).max(2 ** 32 - 1),
    maximumGenerations: z.number().int().min(1).max(500),
    populationMultiplier: z.number().int().min(4).max(50),
    convergenceTolerance: z.number().finite().positive().max(0.1),
    paretoPoints: z.number().int().min(0).max(31),
    sensitivityStepFraction: z.number().finite().positive().max(0.1),
  }),
  project: projectSchema.nullable(),
  kinematicsSweep: z.object({
    startTravelM: z.number().finite().min(-0.25).max(0.25),
    endTravelM: z.number().finite().min(-0.25).max(0.25),
    steps: z.number().int().min(3).max(401),
  }).nullable(),
  kinematicsSolver: z.object({
    residualToleranceM: z.number().finite().min(1e-12).max(1e-4),
    maxFunctionEvaluations: z.number().int().min(50).max(5_000),
  }).nullable(),
  quarterCar: quarterCarSimulationRequestSchema.nullable(),
  fullCar: fullCarSimulationRequestSchema.nullable(),
  bicycle: bicycleSimulationRequestSchema.nullable(),
  parameterManifest: vehicleParameterManifestSchema.optional(),
}).superRefine((value, context) => {
  const payload = {
    kinematics: value.project,
    quarter_car: value.quarterCar,
    full_car: value.fullCar,
    bicycle: value.bicycle,
  }[value.model];
  if (payload === null) {
    context.addIssue({ code: "custom", message: `${value.model} model payload is required` });
  }
  if (value.model === "kinematics" && value.kinematicsSweep === null) {
    context.addIssue({ code: "custom", message: "kinematicsSweep is required" });
  }
  if (value.settings.paretoPoints > 0 && value.objectives.length < 2) {
    context.addIssue({ code: "custom", message: "Pareto generation requires two objectives" });
  }
});

export const optimizationCandidateSchema = z.object({
  variableValues: z.record(z.string(), z.number().finite()),
  metrics: z.record(z.string(), z.number().finite()),
  normalizedObjectives: z.record(z.string(), z.number().finite().nonnegative()),
  weightedObjective: z.number().finite().nonnegative(),
});

export const engineeringOptimizationResponseSchema = z.object({
  schemaVersion: z.literal(API_SCHEMA_VERSION),
  model: z.enum(["kinematics", "quarter_car", "full_car", "bicycle"]),
  calculationStatus: z.enum(["VERIFIED_NUMERICALLY", "FAILED"]),
  validationStatus: phase3ValidationStatusSchema,
  solverVersion: z.string().min(1),
  units: z.record(z.string(), z.string()),
  availableObjectives: z.array(z.string()),
  baseline: optimizationCandidateSchema.nullable(),
  optimized: optimizationCandidateSchema.nullable(),
  paretoFront: z.array(optimizationCandidateSchema),
  convergence: z.array(z.object({
    generation: z.number().int().nonnegative(),
    bestWeightedObjective: z.number().finite().nonnegative(),
    convergenceIndicator: z.number().finite(),
  })),
  sensitivities: z.array(z.object({
    variablePath: z.string(),
    metricId: z.string(),
    derivative: z.number().finite().nullable(),
    step: z.number().finite().positive(),
    method: z.enum(["central", "forward", "backward", "unavailable"]),
  })),
  diagnostics: z.object({
    success: z.boolean(),
    message: z.string(),
    method: z.string(),
    evaluations: z.number().int().nonnegative(),
    feasibleEvaluations: z.number().int().nonnegative(),
    rejectedEvaluations: z.number().int().nonnegative(),
    generations: z.number().int().nonnegative(),
    seed: z.number().int().nonnegative(),
  }),
  provenance: z.object({
    inputSha256: z.string().regex(/^[0-9a-f]{64}$/),
    dataClassification: z.enum(["demonstration", "team_private"]),
    sourceLabel: z.string().min(1),
  }),
  warnings: z.array(z.string()),
  parameterManifest: vehicleParameterManifestSummarySchema.nullable().optional(),
  verificationAxes: independentVerificationSchema.optional(),
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
  schemaVersion: z.literal(API_SCHEMA_VERSION),
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
  parameterManifest: vehicleParameterManifestSummarySchema.nullable().optional(),
  verificationAxes: independentVerificationSchema.optional(),
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
export type FullCarCornerParameters = z.infer<typeof fullCarCornerParametersSchema>;
export type FullCarSimulationRequest = z.infer<typeof fullCarSimulationRequestSchema>;
export type FullCarSample = z.infer<typeof fullCarSampleSchema>;
export type FullCarSimulationResponse = z.infer<typeof fullCarSimulationResponseSchema>;
export type BicycleSimulationRequest = z.infer<typeof bicycleSimulationRequestSchema>;
export type BicycleSample = z.infer<typeof bicycleSampleSchema>;
export type BicycleSimulationResponse = z.infer<typeof bicycleSimulationResponseSchema>;
export type OptimizationDesignVariable = z.infer<typeof optimizationDesignVariableSchema>;
export type OptimizationObjective = z.infer<typeof optimizationObjectiveSchema>;
export type EngineeringOptimizationRequest = z.infer<typeof engineeringOptimizationRequestSchema>;
export type OptimizationCandidate = z.infer<typeof optimizationCandidateSchema>;
export type EngineeringOptimizationResponse = z.infer<typeof engineeringOptimizationResponseSchema>;

