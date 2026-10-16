import { describe, expect, it } from "vitest";
import {
  createDemoProject,
  independentVerificationSchema,
  projectSchema,
  vehicleParameterManifestSchema,
} from "@msku/contracts";

describe("vehicle parameter manifest", () => {
  it("keeps every packaged demonstration value explicitly synthetic", () => {
    const project = projectSchema.parse(createDemoProject());
    expect(project.parameterManifest?.schemaVersion).toBe("1.0.0");
    expect(project.parameterManifest?.parameters.length).toBeGreaterThan(0);
    expect(project.parameterManifest?.parameters.every(
      (parameter) => parameter.measurementStatus === "SYNTHETIC"
        && parameter.source.kind === "synthetic_assumption",
    )).toBe(true);
    expect(project.verification?.physical.status).toBe("UNVALIDATED_PHYSICALLY");
  });

  it("rejects a synthetic assumption presented as a measurement", () => {
    const manifest = structuredClone(createDemoProject().parameterManifest!);
    manifest.parameters[0].measurementStatus = "MEASURED";
    expect(() => vehicleParameterManifestSchema.parse(manifest)).toThrow(
      /cannot be presented as measured/,
    );
  });

  it("rejects an empty manifest", () => {
    const manifest = structuredClone(createDemoProject().parameterManifest!);
    manifest.parameters = [];
    expect(() => vehicleParameterManifestSchema.parse(manifest)).toThrow();
  });

  it("does not let numerical evidence promote physical correlation", () => {
    const verification = {
      declared: { status: "NOT_DECLARED", evidenceIds: [] },
      numerical: { status: "UNVERIFIED", evidenceIds: [] },
      reference: { status: "NOT_BENCHMARKED", evidenceIds: [] },
      physical: { status: "PHYSICALLY_CORRELATED", evidenceIds: ["numeric"] },
      evidence: [{
        id: "numeric",
        kind: "numerical_benchmark",
        title: "Regression suite",
        source: "repository tests",
        reviewStatus: "accepted",
        notes: "",
      }],
    };
    expect(() => independentVerificationSchema.parse(verification)).toThrow(
      /Invalid evidence numeric for physical verification/,
    );
  });

  it("accepts physical correlation only with separately accepted evidence", () => {
    const verification = {
      declared: { status: "NOT_DECLARED", evidenceIds: [] },
      numerical: { status: "UNVERIFIED", evidenceIds: [] },
      reference: { status: "NOT_BENCHMARKED", evidenceIds: [] },
      physical: { status: "PHYSICALLY_CORRELATED", evidenceIds: ["rig-17"] },
      evidence: [{
        id: "rig-17",
        kind: "physical_correlation",
        title: "Four-post correlation run 17",
        source: "four-post-run-17.csv",
        reviewStatus: "accepted",
        notes: "Independent reviewed evidence.",
      }],
    };
    expect(independentVerificationSchema.parse(verification).physical.status).toBe(
      "PHYSICALLY_CORRELATED",
    );
  });
});
