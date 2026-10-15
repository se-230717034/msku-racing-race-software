import type { KinematicsSweepResponse } from "@msku/contracts";
import { create } from "zustand";

export type KinematicsStatus = "idle" | "loading" | "ready" | "error";

interface KinematicsStore {
  status: KinematicsStatus;
  sweep: KinematicsSweepResponse | null;
  selectedIndex: number;
  error: string | null;
  setLoading: () => void;
  setSweep: (sweep: KinematicsSweepResponse) => void;
  setError: (message: string) => void;
  setSelectedIndex: (index: number) => void;
  clear: () => void;
}

export const useKinematics = create<KinematicsStore>((set) => ({
  status: "idle",
  sweep: null,
  selectedIndex: 0,
  error: null,
  setLoading: () => set({ status: "loading", sweep: null, selectedIndex: 0, error: null }),
  setSweep: (sweep) => {
    const selectedIndex = sweep.states.reduce(
      (closest, state, index) =>
        Math.abs(state.travelM) < Math.abs(sweep.states[closest].travelM) ? index : closest,
      0,
    );
    set({ status: "ready", sweep, selectedIndex, error: null });
  },
  setError: (error) => set({ status: "error", sweep: null, selectedIndex: 0, error }),
  setSelectedIndex: (selectedIndex) => set({ selectedIndex }),
  clear: () => set({ status: "idle", sweep: null, selectedIndex: 0, error: null }),
}));
