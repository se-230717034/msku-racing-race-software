import type {
  BicycleSimulationResponse,
  FullCarSimulationResponse,
  KinematicsSweepResponse,
  Project,
} from "@msku/contracts";

export const PHASE_6_REPORT_VERSION = "6.0.0";
export const APPLICATION_VERSION = "0.6.0";

export interface EngineeringReport {
  reportVersion: string;
  applicationVersion: string;
  generatedAt: string;
  title: string;
  project: Project;
  coordinateFrame: string;
  units: Record<string, string>;
  resultInventory: Array<{
    model: string;
    solverVersion: string;
    numericalStatus: string;
    physicalStatus: string;
    approvalStatus: string;
    inputSha256: string;
    warnings: string[];
  }>;
  limitations: string[];
  approval: {
    status: "NOT_APPROVED";
    reason: string;
  };
}

export const buildEngineeringReport = (
  project: Project,
  results: {
    kinematics?: KinematicsSweepResponse | null;
    fullCar?: FullCarSimulationResponse | null;
    bicycle?: BicycleSimulationResponse | null;
  },
  generatedAt = new Date().toISOString(),
): EngineeringReport => {
  const resultInventory: EngineeringReport["resultInventory"] = [];
  if (results.kinematics) resultInventory.push({
    model: `Rigid-upright kinematics · ${project.activeCornerId}`,
    solverVersion: results.kinematics.solver.version,
    numericalStatus: results.kinematics.validationStatus.numerical,
    physicalStatus: results.kinematics.validationStatus.physical,
    approvalStatus: results.kinematics.validationStatus.engineeringApproval,
    inputSha256: results.kinematics.inputProvenance.projectInputSha256,
    warnings: results.kinematics.warnings,
  });
  for (const result of [results.fullCar, results.bicycle]) {
    if (!result) continue;
    resultInventory.push({
      model: result.modelName,
      solverVersion: result.solverVersion,
      numericalStatus: result.validationStatus.numerical,
      physicalStatus: result.validationStatus.physical,
      approvalStatus: result.validationStatus.engineeringApproval,
      inputSha256: result.inputProvenance.inputSha256,
      warnings: result.warnings,
    });
  }
  const assumedCorners = Object.values(project.vehicle.corners)
    .filter((corner) => corner.geometrySource !== "independent")
    .map((corner) => `${corner.id}: ${corner.geometrySource}`);
  return {
    reportVersion: PHASE_6_REPORT_VERSION,
    applicationVersion: APPLICATION_VERSION,
    generatedAt,
    title: `${project.name} — Engineering report`,
    project,
    coordinateFrame: "Right-handed vehicle frame: +X forward, +Y left, +Z up",
    units: { length: "m", angle: "rad", force: "N", mass: "kg", time: "s" },
    resultInventory,
    limitations: [
      "Physical vehicle correlation has not been established; numerical verification is not physical validation.",
      "The chassis wireframe is a reference envelope, not structural or suspension attachment geometry.",
      "A solved corner is never inferred for an unsolved corner.",
      "The linear 7DOF ride model does not solve suspension-link closure; its visualization hides moving links.",
      "The planar bicycle model excludes nonlinear tires, load sensitivity, combined slip, compliance, and transient tire dynamics.",
      assumedCorners.length ? `Non-independent corner definitions: ${assumedCorners.join(", ")}.` : "All four corner definitions are declared independent.",
    ],
    approval: {
      status: "NOT_APPROVED",
      reason: "Approval requires reviewed CAD/benchmark evidence and independent physical measurement correlation outside the software.",
    },
  };
};

const safeName = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "msku-report";

const downloadBlob = (contents: BlobPart, type: string, filename: string): void => {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const downloadEngineeringJson = (report: EngineeringReport): void => {
  downloadBlob(JSON.stringify(report, null, 2), "application/json", `${safeName(report.project.name)}-engineering-report.json`);
};

const csvCell = (value: string | number): string => `"${String(value).replaceAll('"', '""')}"`;

export const engineeringReportCsv = (report: EngineeringReport): string => {
  const rows: Array<Array<string | number>> = [[
    "record_type", "corner", "item", "x_m", "y_m", "z_m", "value", "units", "source", "status",
  ]];
  rows.push(["vehicle", "", "wheelbase", "", "", "", report.project.vehicle.wheelbaseM, "m", report.project.provenance.sourceLabel, report.approval.status]);
  rows.push(["vehicle", "front", "track", "", "", "", report.project.vehicle.frontTrackM, "m", report.project.provenance.sourceLabel, report.approval.status]);
  rows.push(["vehicle", "rear", "track", "", "", "", report.project.vehicle.rearTrackM, "m", report.project.provenance.sourceLabel, report.approval.status]);
  for (const [cornerId, corner] of Object.entries(report.project.vehicle.corners)) {
    for (const point of corner.suspension.hardpoints) rows.push([
      "hardpoint", cornerId, point.id, point.position.x, point.position.y, point.position.z, "", "m", corner.provenanceNote, corner.geometrySource,
    ]);
  }
  for (const result of report.resultInventory) rows.push([
    "result", "", result.model, "", "", "", result.inputSha256, "sha256", result.solverVersion, result.numericalStatus,
  ]);
  rows.push(["approval", "", "engineering_approval", "", "", "", report.approval.reason, "", "", report.approval.status]);
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
};

export const downloadEngineeringCsv = (report: EngineeringReport): void => {
  downloadBlob(engineeringReportCsv(report), "text/csv;charset=utf-8", `${safeName(report.project.name)}-engineering-report.csv`);
};

const ascii = (value: string): string => value.normalize("NFKD").replace(/[^\x20-\x7e]/g, "?");
const pdfEscape = (value: string): string => ascii(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");

export const engineeringReportPdf = (report: EngineeringReport): Uint8Array => {
  const lines = [
    "MSKU Racing Dynamics Studio — Engineering Report",
    `Report version: ${report.reportVersion}`,
    `Application version: ${report.applicationVersion}`,
    `Generated: ${report.generatedAt}`,
    `Project: ${report.project.name}`,
    `Project ID: ${report.project.projectId}`,
    `Project schema: ${report.project.schemaVersion}`,
    `Classification: ${report.project.dataClassification}`,
    `Declared model status: ${report.project.modelStatus}`,
    `Numerical validation: ${report.project.validation.numerical}`,
    `Reference validation: ${report.project.validation.reference}`,
    `Physical validation: ${report.project.validation.physical}`,
    `Engineering approval: ${report.project.validation.engineeringApproval}`,
    `Frame: ${report.coordinateFrame}`,
    `Source: ${report.project.provenance.sourceLabel}`,
    `Wheelbase: ${report.project.vehicle.wheelbaseM} m`,
    `Tracks: front ${report.project.vehicle.frontTrackM} m / rear ${report.project.vehicle.rearTrackM} m`,
    `CG: (${report.project.vehicle.cgPositionM.x}, ${report.project.vehicle.cgPositionM.y}, ${report.project.vehicle.cgPositionM.z}) m`,
    "",
    "CORNER DEFINITIONS",
    ...Object.values(report.project.vehicle.corners).flatMap((corner) => [
      `${corner.id}: ${corner.geometrySource}${corner.derivedFrom ? ` from ${corner.derivedFrom}` : ""}`,
      `  ${corner.provenanceNote}`,
      ...corner.suspension.hardpoints.map((point) => `  ${point.id}: ${point.position.x}, ${point.position.y}, ${point.position.z} m`),
    ]),
    "",
    "RESULT INVENTORY",
    ...(report.resultInventory.length ? report.resultInventory.flatMap((result) => [
      `${result.model} / solver ${result.solverVersion}`,
      `  numerical=${result.numericalStatus}; physical=${result.physicalStatus}; approval=${result.approvalStatus}`,
      `  input SHA-256=${result.inputSha256}`,
      ...result.warnings.map((warning) => `  warning: ${warning}`),
    ]) : ["No accepted solver result was attached to this report."]),
    "",
    "VALIDATION EVIDENCE",
    ...(report.project.validation.evidence.length ? report.project.validation.evidence.map((item) => `${item.kind}: ${item.title} / ${item.status} / ${item.source}`) : ["No project-specific evidence records supplied."]),
    "",
    "LIMITATIONS",
    ...report.limitations.map((item) => `- ${item}`),
    "",
    `ENGINEERING APPROVAL: ${report.approval.status}`,
    report.approval.reason,
  ];
  const pageLines = 56;
  const pages = Array.from({ length: Math.ceil(lines.length / pageLines) }, (_, page) => lines.slice(page * pageLines, (page + 1) * pageLines));
  const objects: string[] = [];
  const pageObjectIds = pages.map((_, index) => 4 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((page, index) => {
    const pageId = pageObjectIds[index];
    const contentId = pageId + 1;
    const content = `BT /F1 9 Tf 12 TL 48 805 Td ${page.map((line, lineIndex) => `${lineIndex ? "T* " : ""}(${pdfEscape(line)}) Tj`).join(" ")} ET`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}\nendstream`;
  });
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = new TextEncoder().encode(body).length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = new TextEncoder().encode(body).length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(body);
};

export const downloadEngineeringPdf = (report: EngineeringReport): void => {
  const bytes = engineeringReportPdf(report);
  const contents = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  downloadBlob(contents, "application/pdf", `${safeName(report.project.name)}-engineering-report.pdf`);
};
