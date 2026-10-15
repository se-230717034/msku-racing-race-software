import type { Hardpoint, Project, Vec3 } from "@msku/contracts";
import { REQUIRED_HARDPOINT_IDS } from "@msku/contracts";

export type DiagnosticSeverity = "error" | "warning";

export interface GeometryDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  pointIds: string[];
}

export interface LinkDefinition {
  id: string;
  label: string;
  start: string;
  end: string;
  group: "upper" | "lower" | "steering" | "upright" | "wheel";
}

export const LINKS: LinkDefinition[] = [
  { id: "uca_front_leg", label: "Upper front leg", start: "uca_front_inboard", end: "uca_outboard", group: "upper" },
  { id: "uca_rear_leg", label: "Upper rear leg", start: "uca_rear_inboard", end: "uca_outboard", group: "upper" },
  { id: "lca_front_leg", label: "Lower front leg", start: "lca_front_inboard", end: "lca_outboard", group: "lower" },
  { id: "lca_rear_leg", label: "Lower rear leg", start: "lca_rear_inboard", end: "lca_outboard", group: "lower" },
  { id: "tie_rod", label: "Tie rod", start: "tie_rod_inboard", end: "tie_rod_outboard", group: "steering" },
  { id: "upright", label: "Upright reference", start: "lca_outboard", end: "uca_outboard", group: "upright" },
  { id: "wheel_reference", label: "Wheel centre reference", start: "lca_outboard", end: "wheel_center", group: "wheel" },
];

const MIN_LINK_LENGTH_M = 0.001;
const MIN_PIVOT_SEPARATION_M = 0.01;

export const distance = (a: Vec3, b: Vec3): number =>
  Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

export const pointMap = (hardpoints: Hardpoint[]): Map<string, Hardpoint> =>
  new Map(hardpoints.map((point) => [point.id, point]));

export const linkLengths = (project: Project): Record<string, number> => {
  const points = pointMap(project.suspension.hardpoints);
  return Object.fromEntries(
    LINKS.map((link) => {
      const start = points.get(link.start);
      const end = points.get(link.end);
      if (!start || !end) {
        throw new Error(`Cannot evaluate ${link.id}: missing endpoint.`);
      }
      return [link.id, distance(start.position, end.position)];
    }),
  );
};

export const mirrorAcrossVehicleCentreline = (point: Vec3): Vec3 => ({
  x: point.x,
  y: -point.y,
  z: point.z,
});

export const toThreePosition = (point: Vec3): [number, number, number] => [
  point.x,
  point.z,
  -point.y,
];

export const validateProjectGeometry = (project: Project): GeometryDiagnostic[] => {
  const diagnostics: GeometryDiagnostic[] = [];
  const points = pointMap(project.suspension.hardpoints);
  const ids = project.suspension.hardpoints.map((point) => point.id);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];

  if (duplicateIds.length > 0) {
    diagnostics.push({
      severity: "error",
      code: "DUPLICATE_HARDPOINT",
      message: `Hardpoint identifiers must be unique: ${duplicateIds.join(", ")}.`,
      pointIds: duplicateIds,
    });
  }

  const missingIds = REQUIRED_HARDPOINT_IDS.filter((id) => !points.has(id));
  if (missingIds.length > 0) {
    diagnostics.push({
      severity: "error",
      code: "MISSING_HARDPOINT",
      message: `Required hardpoints are missing: ${missingIds.join(", ")}.`,
      pointIds: [...missingIds],
    });
    return diagnostics;
  }

  for (const point of project.suspension.hardpoints) {
    const values = Object.values(point.position);
    if (values.some((value) => !Number.isFinite(value))) {
      diagnostics.push({
        severity: "error",
        code: "NON_FINITE_COORDINATE",
        message: `${point.label} contains a non-finite coordinate.`,
        pointIds: [point.id],
      });
    }
  }

  for (const link of LINKS) {
    const start = points.get(link.start);
    const end = points.get(link.end);
    if (!start || !end) continue;
    const length = distance(start.position, end.position);
    if (length < MIN_LINK_LENGTH_M) {
      diagnostics.push({
        severity: "error",
        code: "DEGENERATE_LINK",
        message: `${link.label} is ${(length * 1000).toFixed(3)} mm; minimum is 1.000 mm.`,
        pointIds: [link.start, link.end],
      });
    }
  }

  const pivotChecks: Array<[string, string, string]> = [
    ["uca_front_inboard", "uca_rear_inboard", "upper wishbone inboard pivots"],
    ["lca_front_inboard", "lca_rear_inboard", "lower wishbone inboard pivots"],
  ];
  for (const [firstId, secondId, label] of pivotChecks) {
    const first = points.get(firstId);
    const second = points.get(secondId);
    if (!first || !second) continue;
    const separation = distance(first.position, second.position);
    if (separation < MIN_PIVOT_SEPARATION_M) {
      diagnostics.push({
        severity: "error",
        code: "COINCIDENT_PIVOTS",
        message: `The ${label} are only ${(separation * 1000).toFixed(3)} mm apart.`,
        pointIds: [firstId, secondId],
      });
    }
  }

  const upperOutboard = points.get("uca_outboard")!;
  const lowerOutboard = points.get("lca_outboard")!;
  const tieOutboard = points.get("tie_rod_outboard")!;
  const wheelCenter = points.get("wheel_center")!;

  if (upperOutboard.position.z <= lowerOutboard.position.z) {
    diagnostics.push({
      severity: "error",
      code: "UPRIGHT_ORDER",
      message: "Upper upright joint must be above the lower upright joint (+Z).",
      pointIds: ["uca_outboard", "lca_outboard"],
    });
  }

  const minimumOutboardY = Math.min(
    upperOutboard.position.y,
    lowerOutboard.position.y,
    tieOutboard.position.y,
  );
  const inboardIds = [
    "uca_front_inboard",
    "uca_rear_inboard",
    "lca_front_inboard",
    "lca_rear_inboard",
    "tie_rod_inboard",
  ];
  const misplaced = inboardIds.filter((id) => points.get(id)!.position.y >= minimumOutboardY);
  if (misplaced.length > 0) {
    diagnostics.push({
      severity: "error",
      code: "LEFT_CORNER_ORDER",
      message: "Front-left inboard joints must be inboard of the outboard joints (+Y is left).",
      pointIds: misplaced,
    });
  }

  if (wheelCenter.position.y < Math.max(upperOutboard.position.y, lowerOutboard.position.y)) {
    diagnostics.push({
      severity: "warning",
      code: "WHEEL_CENTER_INBOARD",
      message: "Wheel centre is inboard of an upright joint; verify wheel-offset convention.",
      pointIds: ["wheel_center", "uca_outboard", "lca_outboard"],
    });
  }

  const { radius, width } = project.suspension.wheel;
  if (!Number.isFinite(radius) || radius <= 0) {
    diagnostics.push({ severity: "error", code: "WHEEL_RADIUS", message: "Wheel radius must be positive and finite.", pointIds: [] });
  }
  if (!Number.isFinite(width) || width <= 0) {
    diagnostics.push({ severity: "error", code: "WHEEL_WIDTH", message: "Wheel width must be positive and finite.", pointIds: [] });
  }
  if (width >= 2 * radius) {
    diagnostics.push({ severity: "warning", code: "WHEEL_PROPORTION", message: "Wheel width is at least the wheel diameter; verify units.", pointIds: [] });
  }

  return diagnostics;
};

