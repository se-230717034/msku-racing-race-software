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
  { id: "uca_front_leg", label: "Üst ön kol", start: "uca_front_inboard", end: "uca_outboard", group: "upper" },
  { id: "uca_rear_leg", label: "Üst arka kol", start: "uca_rear_inboard", end: "uca_outboard", group: "upper" },
  { id: "lca_front_leg", label: "Alt ön kol", start: "lca_front_inboard", end: "lca_outboard", group: "lower" },
  { id: "lca_rear_leg", label: "Alt arka kol", start: "lca_rear_inboard", end: "lca_outboard", group: "lower" },
  { id: "tie_rod", label: "Rot kolu", start: "tie_rod_inboard", end: "tie_rod_outboard", group: "steering" },
  { id: "upright", label: "Taşıyıcı referansı", start: "lca_outboard", end: "uca_outboard", group: "upright" },
  { id: "wheel_reference", label: "Tekerlek merkezi referansı", start: "lca_outboard", end: "wheel_center", group: "wheel" },
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

export const staticWheelAxis = (
  corner: Project["suspension"]["corner"],
  camberRad: number,
  toeRad: number,
): Vec3 => {
  const side = corner.endsWith("left") ? 1 : -1;
  const afterCamber = {
    x: 0,
    y: side * Math.cos(camberRad),
    z: -Math.sin(camberRad),
  };
  const toeRotation = -side * toeRad;
  return {
    x: Math.cos(toeRotation) * afterCamber.x - Math.sin(toeRotation) * afterCamber.y,
    y: Math.sin(toeRotation) * afterCamber.x + Math.cos(toeRotation) * afterCamber.y,
    z: afterCamber.z,
  };
};

export const validateProjectGeometry = (project: Project): GeometryDiagnostic[] => {
  const diagnostics: GeometryDiagnostic[] = [];
  const points = pointMap(project.suspension.hardpoints);
  const ids = project.suspension.hardpoints.map((point) => point.id);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];

  if (duplicateIds.length > 0) {
    diagnostics.push({
      severity: "error",
      code: "DUPLICATE_HARDPOINT",
      message: `Bağlantı noktası kimlikleri benzersiz olmalıdır: ${duplicateIds.join(", ")}.`,
      pointIds: duplicateIds,
    });
  }

  const missingIds = REQUIRED_HARDPOINT_IDS.filter((id) => !points.has(id));
  if (missingIds.length > 0) {
    diagnostics.push({
      severity: "error",
      code: "MISSING_HARDPOINT",
      message: `Zorunlu bağlantı noktaları eksik: ${missingIds.join(", ")}.`,
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
        message: `${point.label} sonlu olmayan bir koordinat içeriyor.`,
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
        message: `${link.label} ${(length * 1000).toFixed(3)} mm; en az 1.000 mm olmalıdır.`,
        pointIds: [link.start, link.end],
      });
    }
  }

  const pivotChecks: Array<[string, string, string]> = [
    ["uca_front_inboard", "uca_rear_inboard", "üst salıncak iç pivotları"],
    ["lca_front_inboard", "lca_rear_inboard", "alt salıncak iç pivotları"],
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
        message: `${label} arasındaki mesafe yalnızca ${(separation * 1000).toFixed(3)} mm.`,
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
      message: "Üst taşıyıcı mafsalı, alt taşıyıcı mafsalının üzerinde (+Z) olmalıdır.",
      pointIds: ["uca_outboard", "lca_outboard"],
    });
  }

  const outboardY = [upperOutboard.position.y, lowerOutboard.position.y, tieOutboard.position.y];
  const inboardIds = [
    "uca_front_inboard",
    "uca_rear_inboard",
    "lca_front_inboard",
    "lca_rear_inboard",
    "tie_rod_inboard",
  ];
  const isLeft = project.suspension.corner.endsWith("left");
  const boundary = isLeft ? Math.min(...outboardY) : Math.max(...outboardY);
  const misplaced = inboardIds.filter((id) =>
    isLeft ? points.get(id)!.position.y >= boundary : points.get(id)!.position.y <= boundary,
  );
  if (misplaced.length > 0) {
    diagnostics.push({
      severity: "error",
      code: "CORNER_ORDER",
      message: "İç mafsallar araç merkez çizgisine dış mafsallardan daha yakın olmalıdır.",
      pointIds: misplaced,
    });
  }

  const wheelIsInboard = isLeft
    ? wheelCenter.position.y < Math.max(upperOutboard.position.y, lowerOutboard.position.y)
    : wheelCenter.position.y > Math.min(upperOutboard.position.y, lowerOutboard.position.y);
  if (wheelIsInboard) {
    diagnostics.push({
      severity: "warning",
      code: "WHEEL_CENTER_INBOARD",
      message: "Tekerlek merkezi bir taşıyıcı mafsalının iç tarafında; tekerlek ofseti kabulünü doğrulayın.",
      pointIds: ["wheel_center", "uca_outboard", "lca_outboard"],
    });
  }

  const { radius, width } = project.suspension.wheel;
  if (!Number.isFinite(radius) || radius <= 0) {
    diagnostics.push({ severity: "error", code: "WHEEL_RADIUS", message: "Tekerlek yarıçapı pozitif ve sonlu olmalıdır.", pointIds: [] });
  }
  if (!Number.isFinite(width) || width <= 0) {
    diagnostics.push({ severity: "error", code: "WHEEL_WIDTH", message: "Tekerlek genişliği pozitif ve sonlu olmalıdır.", pointIds: [] });
  }
  if (width >= 2 * radius) {
    diagnostics.push({ severity: "warning", code: "WHEEL_PROPORTION", message: "Tekerlek genişliği en az tekerlek çapı kadar; birimleri doğrulayın.", pointIds: [] });
  }
  if (!Number.isFinite(project.suspension.wheel.staticCamberRad) || Math.abs(project.suspension.wheel.staticCamberRad) > 0.35) {
    diagnostics.push({ severity: "error", code: "STATIC_CAMBER_RANGE", message: "Statik kamber sonlu ve ±20,05 derece aralığında olmalıdır.", pointIds: [] });
  }
  if (!Number.isFinite(project.suspension.wheel.staticToeRad) || Math.abs(project.suspension.wheel.staticToeRad) > 0.35) {
    diagnostics.push({ severity: "error", code: "STATIC_TOE_RANGE", message: "Statik toe sonlu ve ±20,05 derece aralığında olmalıdır.", pointIds: [] });
  }

  return diagnostics;
};

