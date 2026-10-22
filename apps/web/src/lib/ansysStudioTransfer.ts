import type { CornerId, Project, Vec3 } from "@msku/contracts";

export type SignedAxis = "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";
export const CAD_ANCHOR_IDS = ["uca_outboard", "lca_outboard", "wheel_center"] as const;

export interface StudioTransferInput {
  projectId: string;
  projectName: string;
  cornerId: CornerId;
  dataClassification: "demonstration" | "team_private";
  geometrySource: "independent" | "mirrored_assumption" | "synthetic_demo";
  sourceLabel: string;
  hardpointsM: Record<string, Vec3>;
  cadFrame: {
    cadAxesFromVehicle: [SignedAxis, SignedAxis, SignedAxis];
    cadOriginVehicleM: Vec3;
    anchorsCadMm: Record<string, Vec3>;
    anchorToleranceMm: number;
  };
}

const axisIndex = (axis: SignedAxis): number => ({ X: 0, Y: 1, Z: 2 })[axis[1] as "X" | "Y" | "Z"];

export function frameDeterminant(axes: [SignedAxis, SignedAxis, SignedAxis]): number {
  const permutation = axes.map(axisIndex);
  if (new Set(permutation).size !== 3) return 0;
  const inversions = permutation.reduce((total, value, index) =>
    total + permutation.slice(index + 1).filter((later) => value > later).length, 0);
  const sign = axes.reduce((product, axis) => product * (axis[0] === "+" ? 1 : -1), 1);
  return (inversions % 2 === 0 ? 1 : -1) * sign;
}

export function vehicleToCadMm(point: Vec3, origin: Vec3, axes: [SignedAxis, SignedAxis, SignedAxis]): Vec3 {
  if (frameDeterminant(axes) !== 1) throw new Error("CAD eksenleri sağ elli bir dönüşüm oluşturmalı.");
  const relative = [point.x - origin.x, point.y - origin.y, point.z - origin.z];
  const mapped = axes.map((axis) => 1000 * (axis[0] === "+" ? 1 : -1) * relative[axisIndex(axis)]);
  if (mapped.some((value) => !Number.isFinite(value))) throw new Error("CAD koordinat dönüşümü sonlu değil.");
  return { x: mapped[0], y: mapped[1], z: mapped[2] };
}

export function vehicleVectorToCad(vector: Vec3, axes: [SignedAxis, SignedAxis, SignedAxis]): Vec3 {
  if (frameDeterminant(axes) !== 1) throw new Error("CAD eksenleri sağ elli bir dönüşüm oluşturmalı.");
  const components = [vector.x, vector.y, vector.z];
  const mapped = axes.map((axis) => (axis[0] === "+" ? 1 : -1) * components[axisIndex(axis)]);
  if (mapped.some((value) => !Number.isFinite(value))) throw new Error("CAD kuvvet dönüşümü sonlu değil.");
  return { x: mapped[0], y: mapped[1], z: mapped[2] };
}

export function parseVector3(text: string, label: string): Vec3 {
  const parts = text.split(",").map((part) => part.trim());
  if (parts.length !== 3 || parts.some((part) => part === "" || !Number.isFinite(Number(part)))) {
    throw new Error(`${label}: x, y, z biçiminde üç sonlu sayı gerekli.`);
  }
  return { x: Number(parts[0]), y: Number(parts[1]), z: Number(parts[2]) };
}

export function buildStudioTransfer(
  project: Project,
  axes: [SignedAxis, SignedAxis, SignedAxis],
  originVehicleM: Vec3,
  anchorsCadMm: Record<string, Vec3>,
): StudioTransferInput {
  if (frameDeterminant(axes) !== 1) throw new Error("CAD eksenleri yansıtma içeremez.");
  const corner = project.vehicle.corners[project.activeCornerId];
  const hardpoints = Object.fromEntries(corner.suspension.hardpoints.map((point) => [point.id, point.position]));
  if (Object.keys(hardpoints).length !== 9 || CAD_ANCHOR_IDS.some((id) => !hardpoints[id] || !anchorsCadMm[id])) {
    throw new Error("Üç CAD anchor ve dokuz Studio hardpoint gerekli.");
  }
  const [first, second, third] = CAD_ANCHOR_IDS.map((id) => hardpoints[id]);
  const a = [second.x - first.x, second.y - first.y, second.z - first.z];
  const b = [third.x - first.x, third.y - first.y, third.z - first.z];
  if (Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]) <= 1e-8) {
    throw new Error("CAD kaydı için üç doğrusal olmayan anchor gerekli.");
  }
  for (const id of CAD_ANCHOR_IDS) {
    const predicted = vehicleToCadMm(hardpoints[id], originVehicleM, axes);
    const actual = anchorsCadMm[id];
    if (Math.hypot(predicted.x - actual.x, predicted.y - actual.y, predicted.z - actual.z) > 0.5) {
      throw new Error(`${id} CAD anchor farkı 0,5 mm toleransını aşıyor.`);
    }
  }
  return {
    projectId: project.projectId,
    projectName: project.name,
    cornerId: project.activeCornerId,
    dataClassification: project.dataClassification,
    geometrySource: corner.geometrySource,
    sourceLabel: project.provenance.sourceLabel,
    hardpointsM: hardpoints,
    cadFrame: {
      cadAxesFromVehicle: axes,
      cadOriginVehicleM: originVehicleM,
      anchorsCadMm,
      anchorToleranceMm: 0.5,
    },
  };
}
