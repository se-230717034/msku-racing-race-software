import { createDemoProject, parseProject } from "@msku/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { useWorkspace } from "./workspace";

describe("Phase 6 four-corner workspace", () => {
  beforeEach(() => {
    useWorkspace.setState({
      project: createDemoProject(),
      activeModule: "vehicle",
      selectedHardpointId: "uca_outboard",
      vehicleViewMode: "full_vehicle",
      cadViewMode: "hybrid",
    });
  });

  it("persists independent corner edits while switching views", () => {
    useWorkspace.getState().updateHardpoint("uca_outboard", "x", 0.019);
    useWorkspace.getState().setActiveCorner("rear_left");
    useWorkspace.getState().updateHardpoint("uca_outboard", "x", 0.027);
    useWorkspace.getState().setVehicleViewMode("front_axle");
    useWorkspace.getState().setActiveCorner("front_left");
    const project = useWorkspace.getState().project;
    expect(project.suspension.hardpoints.find((point) => point.id === "uca_outboard")?.position.x).toBe(0.019);
    expect(project.vehicle.corners.rear_left.suspension.hardpoints.find((point) => point.id === "uca_outboard")?.position.x).toBe(0.027);
    expect(project.vehicle.corners.front_right.suspension.hardpoints.find((point) => point.id === "uca_outboard")?.position.x).toBe(0.01);
    expect(() => parseProject(project)).not.toThrow();
  });

  it("does not mutate engineering data when changing camera or visibility", () => {
    const before = JSON.stringify(useWorkspace.getState().project);
    useWorkspace.getState().setCameraPreset("rear");
    useWorkspace.getState().setCadViewMode("detailed");
    useWorkspace.getState().toggleVisibility("chassis");
    useWorkspace.getState().setVehicleViewMode("rear_axle");
    expect(JSON.stringify(useWorkspace.getState().project)).toBe(before);
    expect(useWorkspace.getState().cadViewMode).toBe("detailed");
  });
});
