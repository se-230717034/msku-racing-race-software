import { createDemoProject } from "@msku/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { deserializeProject, loadProjectLocally, saveProjectLocally, serializeProject } from "./projectStorage";

describe("project persistence", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips the versioned project through JSON", () => {
    const project = createDemoProject();
    expect(deserializeProject(serializeProject(project))).toEqual(project);
  });

  it("round-trips through browser local storage", () => {
    const project = createDemoProject();
    saveProjectLocally(project);
    expect(loadProjectLocally()).toEqual(project);
  });

  it("rejects an unsupported schema version", () => {
    const project = { ...createDemoProject(), schemaVersion: "2.0.0" };
    expect(() => deserializeProject(JSON.stringify(project))).toThrow();
  });

  it("accepts explicitly classified private team geometry", () => {
    const project = createDemoProject();
    project.dataClassification = "team_private";
    expect(deserializeProject(serializeProject(project)).dataClassification).toBe("team_private");
  });
});

