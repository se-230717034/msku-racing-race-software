import { createDemoProject } from "@msku/contracts";
import { describe, expect, it } from "vitest";

import { buildStudioTransfer, frameDeterminant, parseVector3, vehicleToCadMm, vehicleVectorToCad } from "./ansysStudioTransfer";

describe("ANSYS Studio transfer", () => {
  it("converts right-handed vehicle metres into declared CAD millimetres", () => {
    expect(frameDeterminant(["+Y", "-X", "+Z"])).toBe(1);
    expect(frameDeterminant(["+X", "+Y", "-Z"])).toBe(-1);
    expect(vehicleToCadMm({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0 }, ["+Y", "-X", "+Z"]))
      .toEqual({ x: 2000, y: -1000, z: 3000 });
  });

  it("rotates force components without applying the coordinate origin or a length scale", () => {
    expect(vehicleVectorToCad({ x: 10, y: -20, z: 30 }, ["+Y", "-X", "+Z"]))
      .toEqual({ x: -20, y: -10, z: 30 });
    expect(() => vehicleVectorToCad({ x: 1, y: 0, z: 0 }, ["+X", "+Y", "-Z"]))
      .toThrow(/sağ elli/);
  });

  it("rejects missing or mismatched anchors rather than creating a false CAD link", () => {
    const project = createDemoProject();
    const origin = { x: 0, y: 0, z: 0 };
    expect(() => buildStudioTransfer(project, ["+X", "+Y", "+Z"], origin, {})).toThrow(/anchor/);
    const points = Object.fromEntries(project.suspension.hardpoints.map((point) => [point.id, point.position]));
    const anchors = Object.fromEntries(
      ["uca_outboard", "lca_outboard", "wheel_center"].map((id) => [id, vehicleToCadMm(points[id], origin, ["+X", "+Y", "+Z"])]),
    );
    const transfer = buildStudioTransfer(project, ["+X", "+Y", "+Z"], origin, anchors);
    expect(transfer.dataClassification).toBe("demonstration");
    expect(Object.keys(transfer.hardpointsM)).toHaveLength(9);
    anchors.wheel_center = { ...anchors.wheel_center, x: anchors.wheel_center.x + 1 };
    expect(() => buildStudioTransfer(project, ["+X", "+Y", "+Z"], origin, anchors)).toThrow(/0,5 mm/);
  });

  it("rejects ambiguous coordinate text", () => {
    expect(parseVector3("1, -2, 3", "CAD")).toEqual({ x: 1, y: -2, z: 3 });
    expect(() => parseVector3("1, 2", "CAD")).toThrow();
    expect(() => parseVector3("1, NaN, 3", "CAD")).toThrow();
  });
});
