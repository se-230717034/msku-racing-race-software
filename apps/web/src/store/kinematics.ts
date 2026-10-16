import type { CornerId, KinematicsSweepResponse } from "@msku/contracts";
import { create } from "zustand";

export type KinematicsStatus = "idle" | "loading" | "ready" | "error";

interface KinematicsStore {
  status: KinematicsStatus;
  sweep: KinematicsSweepResponse | null;
  selectedIndex: number;
  error: string | null;
  solvedCornerId: CornerId | null;
  setLoading: (cornerId?: CornerId) => void;
  setSweep: (sweep: KinematicsSweepResponse, cornerId?: CornerId) => void;
  setError: (message: string) => void;
  setSelectedIndex: (index: number) => void;
  clear: () => void;
}

export const useKinematics = create<KinematicsStore>((set) => ({
  status: "idle",
  sweep: null,
  selectedIndex: 0,
  error: null,
  solvedCornerId: null,
  setLoading: (solvedCornerId) => set({ status: "loading", sweep: null, selectedIndex: 0, error: null, solvedCornerId: solvedCornerId ?? null }),
  setSweep: (sweep, solvedCornerId) => {
    const selectedIndex = sweep.states.reduce(
      (closest, state, index) =>
        Math.abs(state.travelM) < Math.abs(sweep.states[closest].travelM) ? index : closest,
      0,
    );
    set({ status: "ready", sweep, selectedIndex, error: null, solvedCornerId: solvedCornerId ?? null });
  },
  setError: (error) => set({ status: "error", sweep: null, selectedIndex: 0, error, solvedCornerId: null }),
  setSelectedIndex: (selectedIndex) => set({ selectedIndex }),
  clear: () => set({ status: "idle", sweep: null, selectedIndex: 0, error: null, solvedCornerId: null }),
}));
