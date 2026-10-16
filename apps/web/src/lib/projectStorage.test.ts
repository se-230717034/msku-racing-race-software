import { createDemoProject } from "@msku/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import {
  deserializeProject,
  LEGACY_PROJECT_STORAGE_KEY,
  loadProjectLocally,
  saveProjectLocally,
  serializeProject,
} from "./projectStorage";

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

  it("rejects an unsupported future schema version", () => {
    const project = { ...createDemoProject(), schemaVersion: "99.0.0" };
    expect(() => deserializeProject(JSON.stringify(project))).toThrow();
  });

  it("migrates a legacy single-corner project without changing its source corner", () => {
    const current = createDemoProject();
    const legacy = {
      schemaVersion: "1.0.0",
      projectId: current.projectId,
      name: "Legacy measured corner",
      description: current.description,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
      dataClassification: "team_private",
      modelStatus: "unvalidated",
      units: current.units,
      coordinateSystem: current.coordinateSystem,
      suspension: current.suspension,
    };
    localStorage.setItem(LEGACY_PROJECT_STORAGE_KEY, JSON.stringify(legacy));
    const migrated = loadProjectLocally();
    expect(migrated?.schemaVersion).toBe("2.0.0");
    expect(migrated?.suspension).toEqual(legacy.suspension);
    expect(migrated?.vehicle.corners.front_left.suspension).toEqual(legacy.suspension);
    expect(migrated?.vehicle.corners.front_right.geometrySource).toBe("mirrored_assumption");
    expect(migrated?.vehicle.corners.rear_left.geometrySource).toBe("synthetic_demo");
    expect(migrated?.provenance.migratedFromSchemaVersion).toBe("1.0.0");
    expect(localStorage.getItem(LEGACY_PROJECT_STORAGE_KEY)).toBe(JSON.stringify(legacy));
  });

  it("accepts explicitly classified private team geometry", () => {
    const project = createDemoProject();
    project.dataClassification = "team_private";
    expect(deserializeProject(serializeProject(project)).dataClassification).toBe("team_private");
  });
});

