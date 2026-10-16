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
      visibility: {
        ...useWorkspace.getState().visibility,
        wheel: true,
        tire: true,
        rim: true,
        brake: true,
        brakeDisc: true,
        caliper: true,
        hub: true,
        chassis: false,
        referencePlanes: false,
        representativeActuation: false,
      },
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
    useWorkspace.getState().toggleVisibility("tire");
    useWorkspace.getState().toggleVisibility("rim");
    useWorkspace.getState().toggleVisibility("brake");
    useWorkspace.getState().toggleVisibility("brakeDisc");
    useWorkspace.getState().setVisibility({ tire: false, rim: false, caliper: false, hub: false });
    useWorkspace.getState().toggleVisibility("representativeActuation");
    useWorkspace.getState().setVehicleViewMode("rear_axle");
    expect(JSON.stringify(useWorkspace.getState().project)).toBe(before);
    expect(useWorkspace.getState().cadViewMode).toBe("detailed");
    expect(useWorkspace.getState().visibility.tire).toBe(false);
    expect(useWorkspace.getState().visibility.rim).toBe(false);
    expect(useWorkspace.getState().visibility.brake).toBe(false);
    expect(useWorkspace.getState().visibility.brakeDisc).toBe(false);
    expect(useWorkspace.getState().visibility.caliper).toBe(false);
    expect(useWorkspace.getState().visibility.hub).toBe(false);
    expect(useWorkspace.getState().visibility.representativeActuation).toBe(true);
  });
});
