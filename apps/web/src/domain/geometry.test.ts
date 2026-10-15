import { createDemoProject } from "@msku/contracts";
import { describe, expect, it } from "vitest";

import { linkLengths, mirrorAcrossVehicleCentreline, toThreePosition, validateProjectGeometry } from "./geometry";

describe("static geometry", () => {
  it("accepts the labeled demonstration fixture", () => {
    expect(validateProjectGeometry(createDemoProject())).toEqual([]);
  });

  it("calculates deterministic Euclidean link lengths", () => {
    const project = createDemoProject();
    const first = linkLengths(project);
    const second = linkLengths(project);
    expect(first).toEqual(second);
    // Independent baseline: sqrt(0.01^2 + (-0.04)^2 + 0.23^2).
    expect(first.upright).toBeCloseTo(Math.sqrt(0.0546), 12);
  });

  it("mirrors only the lateral coordinate", () => {
    expect(mirrorAcrossVehicleCentreline({ x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: -2, z: 3 });
  });

  it("maps the vehicle frame into Three.js without mutating data", () => {
    const point = { x: 1, y: 2, z: 3 };
    expect(toThreePosition(point)).toEqual([1, 3, -2]);
    expect(point).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("flags impossible upright ordering", () => {
    const project = createDemoProject();
    const upper = project.suspension.hardpoints.find((point) => point.id === "uca_outboard")!;
    upper.position.z = 0.1;
    expect(validateProjectGeometry(project).map((item) => item.code)).toContain("UPRIGHT_ORDER");
  });

  it("flags duplicate required identifiers", () => {
    const project = createDemoProject();
    project.suspension.hardpoints[1].id = project.suspension.hardpoints[0].id;
    const codes = validateProjectGeometry(project).map((item) => item.code);
    expect(codes).toContain("DUPLICATE_HARDPOINT");
    expect(codes).toContain("MISSING_HARDPOINT");
  });
});

