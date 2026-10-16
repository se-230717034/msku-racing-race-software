import { createDemoProject } from "@msku/contracts";
import { describe, expect, it } from "vitest";

import { buildEngineeringReport, engineeringReportCsv, engineeringReportPdf } from "./engineeringReport";

describe("Phase 6 engineering report", () => {
  it("includes project provenance, four corners, warnings, and a blocked approval state", () => {
    const project = createDemoProject();
    const report = buildEngineeringReport(project, {}, "2026-10-16T00:00:00.000Z");
    expect(Object.keys(report.project.vehicle.corners)).toHaveLength(4);
    expect(report.project.provenance.sourceLabel).toContain("sentetik");
    expect(report.limitations.join(" ")).toContain("Fiziksel araç korelasyonu");
    expect(report.limitations.join(" ")).toContain("mirrored_assumption");
    expect(report.approval.status).toBe("NOT_APPROVED");
  });

  it("generates traceable CSV and a structurally valid PDF payload", () => {
    const report = buildEngineeringReport(createDemoProject(), {}, "2026-10-16T00:00:00.000Z");
    const csv = engineeringReportCsv(report);
    expect(csv).toContain("wheelbase");
    expect(csv).toContain("front_left");
    expect(csv).toContain("NOT_APPROVED");
    const pdf = engineeringReportPdf(report);
    const text = new TextDecoder().decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("UNVALIDATED_PHYSICALLY");
    expect(text).toContain("startxref");
  });
});
