import type {
  BicycleSimulationResponse,
  CornerId,
  FullCarSimulationResponse,
  Project,
  ValidationEvidence,
  Vec3,
} from "@msku/contracts";
import { createDemoProject } from "@msku/contracts";
import { create } from "zustand";

export type ModuleId = "workspace" | "vehicle" | "geometry" | "kinematics" | "loads" | "dynamics" | "road" | "optimization" | "comparison" | "reports" | "validation";
export type CameraPreset = "perspective" | "isometric" | "front" | "rear" | "side" | "top";
export type VehicleViewMode = "full_vehicle" | "front_axle" | "rear_axle" | "active_corner" | "chassis_cg" | "suspension" | "kinematics" | "dynamics";
export type CadViewMode = "technical" | "detailed" | "hybrid";
export type VisualModelSource = "glb" | "procedural";

export interface AnsysWrenchInput {
  projectId: string;
  projectUpdatedAt: string;
  cornerId: CornerId;
  forceN: Vec3;
  momentNm: Vec3;
  applicationPointM: Vec3;
  sourceLabel: string;
  inputSha256: string;
  physicalStatus: "UNVALIDATED_PHYSICALLY";
}

export interface VisibilityState {
  upper: boolean;
  lower: boolean;
  steering: boolean;
  upright: boolean;
  wheel: boolean;
  tire: boolean;
  rim: boolean;
  brake: boolean;
  brakeDisc: boolean;
  caliper: boolean;
  hub: boolean;
  coilover: boolean;
  hardpoints: boolean;
  mirror: boolean;
  chassis: boolean;
  referencePlanes: boolean;
  labels: boolean;
  representativeActuation: boolean;
}

interface WorkspaceState {
  project: Project;
  activeModule: ModuleId;
  selectedHardpointId: string;
  cameraPreset: CameraPreset;
  vehicleViewMode: VehicleViewMode;
  cadViewMode: CadViewMode;
  visualModelSource: VisualModelSource;
  visibility: VisibilityState;
  latestFullCarResult: FullCarSimulationResponse | null;
  latestBicycleResult: BicycleSimulationResponse | null;
  latestAnsysWrench: AnsysWrenchInput | null;
  setActiveModule: (module: ModuleId) => void;
  setSelectedHardpoint: (id: string) => void;
  setCameraPreset: (preset: CameraPreset) => void;
  setVehicleViewMode: (mode: VehicleViewMode) => void;
  setCadViewMode: (mode: CadViewMode) => void;
  setVisualModelSource: (source: VisualModelSource) => void;
  setActiveCorner: (cornerId: CornerId) => void;
  toggleVisibility: (key: keyof VisibilityState) => void;
  setVisibility: (values: Partial<VisibilityState>) => void;
  updateHardpoint: (id: string, axis: keyof Vec3, metres: number) => void;
  applyHardpointOverrides: (overrides: Record<string, Vec3>) => void;
  updateWheel: (field: keyof Project["suspension"]["wheel"], value: number) => void;
  updateVehicleDimension: (field: "wheelbaseM" | "frontTrackM" | "rearTrackM", value: number) => void;
  updateCgPosition: (axis: keyof Vec3, value: number) => void;
  updateProvenance: (sourceLabel: string) => void;
  addValidationEvidence: (evidence: ValidationEvidence) => void;
  setLatestFullCarResult: (result: FullCarSimulationResponse | null) => void;
  setLatestBicycleResult: (result: BicycleSimulationResponse | null) => void;
  setLatestAnsysWrench: (value: AnsysWrenchInput | null) => void;
  renameProject: (name: string) => void;
  replaceProject: (project: Project) => void;
  resetDemo: (projectId?: string) => void;
}

const stamp = (project: Project): Project => ({ ...project, updatedAt: new Date().toISOString() });

const replaceActiveSuspension = (project: Project, suspension: Project["suspension"]): Project => ({
  ...project,
  suspension,
  vehicle: {
    ...project.vehicle,
    corners: {
      ...project.vehicle.corners,
      [project.activeCornerId]: {
        ...project.vehicle.corners[project.activeCornerId],
        suspension,
      },
    },
  },
});

export const useWorkspace = create<WorkspaceState>((set) => ({
  project: createDemoProject(),
  activeModule: "vehicle",
  selectedHardpointId: "uca_outboard",
  cameraPreset: "perspective",
  vehicleViewMode: "full_vehicle",
  cadViewMode: "detailed",
  visualModelSource: "glb",
  latestFullCarResult: null,
  latestBicycleResult: null,
  latestAnsysWrench: null,
  visibility: {
    upper: true,
    lower: true,
    steering: true,
    upright: true,
    wheel: true,
    tire: true,
    rim: true,
    brake: true,
    brakeDisc: true,
    caliper: true,
    hub: true,
    coilover: true,
    hardpoints: true,
    mirror: false,
    chassis: false,
    referencePlanes: false,
    labels: true,
    representativeActuation: false,
  },
  setActiveModule: (activeModule) => set({ activeModule }),
  setSelectedHardpoint: (selectedHardpointId) => set({ selectedHardpointId }),
  setCameraPreset: (cameraPreset) => set({ cameraPreset }),
  setVehicleViewMode: (vehicleViewMode) => set({ vehicleViewMode }),
  setCadViewMode: (cadViewMode) => set({ cadViewMode }),
  setVisualModelSource: (visualModelSource) => set({ visualModelSource }),
  setActiveCorner: (activeCornerId) => set((state) => ({
    project: stamp({
      ...state.project,
      activeCornerId,
      suspension: state.project.vehicle.corners[activeCornerId].suspension,
    }),
    selectedHardpointId: "uca_outboard",
  })),
  toggleVisibility: (key) =>
    set((state) => ({ visibility: { ...state.visibility, [key]: !state.visibility[key] } })),
  setVisibility: (values) =>
    set((state) => ({ visibility: { ...state.visibility, ...values } })),
  updateHardpoint: (id, axis, metres) =>
    set((state) => ({
      project: stamp(replaceActiveSuspension(state.project, {
          ...state.project.suspension,
          hardpoints: state.project.suspension.hardpoints.map((point) =>
            point.id === id
              ? { ...point, position: { ...point.position, [axis]: metres } }
              : point,
          ),
      })),
    })),
  applyHardpointOverrides: (overrides) =>
    set((state) => ({
      project: stamp(replaceActiveSuspension(state.project, {
          ...state.project.suspension,
          hardpoints: state.project.suspension.hardpoints.map((point) => ({
            ...point,
            position: overrides[point.id] ?? point.position,
          })),
      })),
    })),
  updateWheel: (field, value) =>
    set((state) => ({
      project: stamp(replaceActiveSuspension(state.project, {
          ...state.project.suspension,
          wheel: { ...state.project.suspension.wheel, [field]: value },
      })),
    })),
  updateVehicleDimension: (field, value) => set((state) => ({
    project: stamp({ ...state.project, vehicle: { ...state.project.vehicle, [field]: value } }),
  })),
  updateCgPosition: (axis, value) => set((state) => ({
    project: stamp({
      ...state.project,
      vehicle: {
        ...state.project.vehicle,
        cgPositionM: { ...state.project.vehicle.cgPositionM, [axis]: value },
      },
    }),
  })),
  updateProvenance: (sourceLabel) => set((state) => ({
    project: stamp({ ...state.project, provenance: { ...state.project.provenance, sourceLabel } }),
  })),
  addValidationEvidence: (evidence) => set((state) => ({
    project: stamp({
      ...state.project,
      validation: {
        ...state.project.validation,
        evidence: [...state.project.validation.evidence, evidence],
      },
    }),
  })),
  setLatestFullCarResult: (latestFullCarResult) => set({ latestFullCarResult }),
  setLatestBicycleResult: (latestBicycleResult) => set({ latestBicycleResult }),
  setLatestAnsysWrench: (latestAnsysWrench) => set({ latestAnsysWrench }),
  renameProject: (name) => set((state) => ({ project: stamp({ ...state.project, name }) })),
  replaceProject: (project) => set({
    project,
    selectedHardpointId: "uca_outboard",
    activeModule: "vehicle",
    latestFullCarResult: null,
    latestBicycleResult: null,
    latestAnsysWrench: null,
  }),
  resetDemo: (projectId) => {
    const now = new Date().toISOString();
    set({
      project: {
        ...createDemoProject(projectId),
        name: "Untitled demonstration vehicle",
        createdAt: now,
        updatedAt: now,
      },
      selectedHardpointId: "uca_outboard",
      activeModule: "vehicle",
      latestFullCarResult: null,
      latestBicycleResult: null,
      latestAnsysWrench: null,
    });
  },
}));

