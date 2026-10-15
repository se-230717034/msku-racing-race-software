import type { Project, Vec3 } from "@msku/contracts";
import { createDemoProject } from "@msku/contracts";
import { create } from "zustand";

export type ModuleId = "workspace" | "geometry" | "kinematics" | "loads" | "dynamics" | "road" | "optimization" | "reports" | "validation";
export type CameraPreset = "perspective" | "front" | "side" | "top";

interface VisibilityState {
  upper: boolean;
  lower: boolean;
  steering: boolean;
  upright: boolean;
  wheel: boolean;
  hardpoints: boolean;
  mirror: boolean;
}

interface WorkspaceState {
  project: Project;
  activeModule: ModuleId;
  selectedHardpointId: string;
  cameraPreset: CameraPreset;
  visibility: VisibilityState;
  setActiveModule: (module: ModuleId) => void;
  setSelectedHardpoint: (id: string) => void;
  setCameraPreset: (preset: CameraPreset) => void;
  toggleVisibility: (key: keyof VisibilityState) => void;
  updateHardpoint: (id: string, axis: keyof Vec3, metres: number) => void;
  updateWheel: (field: keyof Project["suspension"]["wheel"], value: number) => void;
  renameProject: (name: string) => void;
  replaceProject: (project: Project) => void;
  resetDemo: (projectId?: string) => void;
}

const stamp = (project: Project): Project => ({ ...project, updatedAt: new Date().toISOString() });

export const useWorkspace = create<WorkspaceState>((set) => ({
  project: createDemoProject(),
  activeModule: "geometry",
  selectedHardpointId: "uca_outboard",
  cameraPreset: "perspective",
  visibility: {
    upper: true,
    lower: true,
    steering: true,
    upright: true,
    wheel: true,
    hardpoints: true,
    mirror: false,
  },
  setActiveModule: (activeModule) => set({ activeModule }),
  setSelectedHardpoint: (selectedHardpointId) => set({ selectedHardpointId }),
  setCameraPreset: (cameraPreset) => set({ cameraPreset }),
  toggleVisibility: (key) =>
    set((state) => ({ visibility: { ...state.visibility, [key]: !state.visibility[key] } })),
  updateHardpoint: (id, axis, metres) =>
    set((state) => ({
      project: stamp({
        ...state.project,
        suspension: {
          ...state.project.suspension,
          hardpoints: state.project.suspension.hardpoints.map((point) =>
            point.id === id
              ? { ...point, position: { ...point.position, [axis]: metres } }
              : point,
          ),
        },
      }),
    })),
  updateWheel: (field, value) =>
    set((state) => ({
      project: stamp({
        ...state.project,
        suspension: {
          ...state.project.suspension,
          wheel: { ...state.project.suspension.wheel, [field]: value },
        },
      }),
    })),
  renameProject: (name) => set((state) => ({ project: stamp({ ...state.project, name }) })),
  replaceProject: (project) => set({ project, selectedHardpointId: "uca_outboard", activeModule: "geometry" }),
  resetDemo: (projectId) => {
    const now = new Date().toISOString();
    set({
      project: {
        ...createDemoProject(projectId),
        name: "Untitled demonstration corner",
        createdAt: now,
        updatedAt: now,
      },
      selectedHardpointId: "uca_outboard",
      activeModule: "geometry",
    });
  },
}));

