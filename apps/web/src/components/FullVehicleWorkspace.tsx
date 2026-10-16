import type { CornerId, Vec3 } from "@msku/contracts";
import { Box, Camera, Eye, EyeOff, Play, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { integratedYawRad } from "../domain/vehicle";
import { useKinematics } from "../store/kinematics";
import {
  useWorkspace,
  type CameraPreset,
  type VehicleViewMode,
} from "../store/workspace";
import { FullVehicleViewport } from "./FullVehicleViewport";

const cameraPresets: Array<{ id: CameraPreset; label: string }> = [
  { id: "perspective", label: "Perspective" },
  { id: "isometric", label: "Isometric" },
  { id: "front", label: "Front" },
  { id: "rear", label: "Rear" },
  { id: "side", label: "Side" },
  { id: "top", label: "Top" },
];

const viewModes: Array<{ id: VehicleViewMode; label: string }> = [
  { id: "full_vehicle", label: "Full vehicle" },
  { id: "front_axle", label: "Front axle" },
  { id: "rear_axle", label: "Rear axle" },
  { id: "active_corner", label: "Individual corner" },
  { id: "chassis_cg", label: "Chassis / CG" },
  { id: "suspension", label: "Suspension" },
  { id: "kinematics", label: "Kinematics playback" },
  { id: "dynamics", label: "Dynamics playback" },
];

const cornerIds: CornerId[] = ["front_left", "front_right", "rear_left", "rear_right"];

function MetricField({ label, value, axis, onChange }: {
  label: string;
  value: number;
  axis?: keyof Vec3;
  onChange: (value: number) => void;
}) {
  return <label className="numeric-field">
    <span>{label}{axis ? ` ${axis.toUpperCase()}` : ""}</span>
    <input type="number" step="0.001" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    <em>m</em>
  </label>;
}

export function FullVehicleWorkspace() {
  const [dynamicPlayback, setDynamicPlayback] = useState({ runId: "", index: 0 });
  const project = useWorkspace((state) => state.project);
  const preset = useWorkspace((state) => state.cameraPreset);
  const setPreset = useWorkspace((state) => state.setCameraPreset);
  const viewMode = useWorkspace((state) => state.vehicleViewMode);
  const setViewMode = useWorkspace((state) => state.setVehicleViewMode);
  const visibility = useWorkspace((state) => state.visibility);
  const toggleVisibility = useWorkspace((state) => state.toggleVisibility);
  const setActiveCorner = useWorkspace((state) => state.setActiveCorner);
  const setActiveModule = useWorkspace((state) => state.setActiveModule);
  const updateDimension = useWorkspace((state) => state.updateVehicleDimension);
  const updateCg = useWorkspace((state) => state.updateCgPosition);
  const fullCarResult = useWorkspace((state) => state.latestFullCarResult);
  const bicycleResult = useWorkspace((state) => state.latestBicycleResult);
  const sweep = useKinematics((state) => state.sweep);
  const selectedKinematicsIndex = useKinematics((state) => state.selectedIndex);
  const setSelectedKinematicsIndex = useKinematics((state) => state.setSelectedIndex);
  const solvedCornerId = useKinematics((state) => state.solvedCornerId);
  const dynamicSamples = fullCarResult?.samples ?? bicycleResult?.samples ?? [];
  const dynamicsRunId = fullCarResult?.inputProvenance.inputSha256
    ?? bicycleResult?.inputProvenance.inputSha256
    ?? "";
  const safeDynamicIndex = dynamicPlayback.runId === dynamicsRunId
    ? Math.min(dynamicPlayback.index, Math.max(dynamicSamples.length - 1, 0))
    : 0;
  const currentFullCar = fullCarResult?.samples[safeDynamicIndex];
  const currentBicycle = bicycleResult?.samples[safeDynamicIndex];
  const bicycleYaw = bicycleResult ? integratedYawRad(bicycleResult.samples, safeDynamicIndex) : 0;
  const activeCorner = project.vehicle.corners[project.activeCornerId];
  const kinematicsAvailable = sweep && solvedCornerId === project.activeCornerId;

  return (
    <div className="vehicle-workspace">
      <header className="vehicle-toolbar">
        <div className="toolbar-group" aria-label="Vehicle display controls">
          <Box size={14} />
          <select aria-label="Vehicle view mode" value={viewMode} onChange={(event) => setViewMode(event.target.value as VehicleViewMode)}>
            {viewModes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>
        <div className="toolbar-divider" />
        <div className="toolbar-group" aria-label="Full vehicle camera presets">
          <Camera size={14} />
          {cameraPresets.map((item) => <button key={item.id} type="button" className={preset === item.id ? "active" : ""} onClick={() => setPreset(item.id)}>{item.label}</button>)}
        </div>
        <div className="toolbar-divider" />
        <div className="toolbar-group" aria-label="Full vehicle visibility">
          {(["wheel", "hardpoints", "chassis", "referencePlanes", "labels"] as const).map((key) => <button key={key} type="button" className={visibility[key] ? "active" : ""} onClick={() => toggleVisibility(key)}>{visibility[key] ? <Eye size={12} /> : <EyeOff size={12} />}{key.replace(/([A-Z])/g, " $1")}</button>)}
        </div>
      </header>

      <main className="vehicle-main">
        <FullVehicleViewport
          fullCarSample={currentFullCar}
          bicycleYawRad={bicycleYaw}
          steeringRad={currentBicycle?.steeringRad ?? 0}
          bicycleResultAvailable={Boolean(bicycleResult)}
        />
        {(viewMode === "kinematics" || viewMode === "dynamics") && (
          <div className="vehicle-playback">
            <Play size={13} />
            <span>{viewMode === "kinematics" ? "Solved wheel travel" : fullCarResult ? "7DOF time sample" : bicycleResult ? "Bicycle time sample" : "No supported result"}</span>
            {viewMode === "kinematics" ? (
              <input
                aria-label="Full vehicle kinematics playback"
                type="range"
                min="0"
                max={Math.max((sweep?.states.length ?? 1) - 1, 0)}
                value={selectedKinematicsIndex}
                disabled={!kinematicsAvailable}
                onChange={(event) => setSelectedKinematicsIndex(Number(event.target.value))}
              />
            ) : (
              <input
                aria-label="Full vehicle dynamics playback"
                type="range"
                min="0"
                max={Math.max(dynamicSamples.length - 1, 0)}
                value={safeDynamicIndex}
                disabled={dynamicSamples.length === 0}
                onChange={(event) => setDynamicPlayback({
                  runId: dynamicsRunId,
                  index: Number(event.target.value),
                })}
              />
            )}
            <b>{viewMode === "kinematics"
              ? kinematicsAvailable ? `${((sweep?.states[selectedKinematicsIndex]?.travelM ?? 0) * 1_000).toFixed(1)} mm` : "RUN REQUIRED"
              : currentFullCar ? `${currentFullCar.timeS.toFixed(3)} s` : currentBicycle ? `${currentBicycle.timeS.toFixed(3)} s` : "RUN REQUIRED"}</b>
          </div>
        )}
      </main>

      <aside className="vehicle-inspector">
        <section className="inspector-section">
          <div className="section-heading"><span className="eyebrow">FOUR-CORNER CONFIGURATION</span><span className="unit-chip">SI</span></div>
          <label className="select-field"><span>Active editable corner</span><select aria-label="Active vehicle corner" value={project.activeCornerId} onChange={(event) => setActiveCorner(event.target.value as CornerId)}>{cornerIds.map((id) => <option key={id} value={id}>{project.vehicle.corners[id].label}</option>)}</select></label>
          <p className="corner-source"><b>{activeCorner.geometrySource.replaceAll("_", " ")}</b>{activeCorner.derivedFrom ? ` · derived from ${activeCorner.derivedFrom.replace("_", " ")}` : ""}<span>{activeCorner.provenanceNote}</span></p>
          <button className="wide-action" type="button" onClick={() => setActiveModule("geometry")}><SlidersHorizontal size={13} />Edit active corner hardpoints</button>
        </section>
        <section className="inspector-section">
          <div className="section-heading"><span className="eyebrow">VEHICLE REFERENCES</span></div>
          <div className="vehicle-metric-grid">
            <MetricField label="Wheelbase" value={project.vehicle.wheelbaseM} onChange={(value) => updateDimension("wheelbaseM", value)} />
            <MetricField label="Front track" value={project.vehicle.frontTrackM} onChange={(value) => updateDimension("frontTrackM", value)} />
            <MetricField label="Rear track" value={project.vehicle.rearTrackM} onChange={(value) => updateDimension("rearTrackM", value)} />
          </div>
          <div className="coordinate-grid">
            {(["x", "y", "z"] as const).map((axis) => <MetricField key={axis} axis={axis} label="CG" value={project.vehicle.cgPositionM[axis]} onChange={(value) => updateCg(axis, value)} />)}
          </div>
          <p className="field-note">Wheelbase, track, and CG are configurable reference data. The wireframe chassis is a non-structural envelope and never creates suspension pickups.</p>
        </section>
        <section className="inspector-section grow">
          <div className="section-heading"><span className="eyebrow">MODEL AVAILABILITY</span></div>
          <dl className="solver-diagnostics quality-status">
            <div><dt>Kinematics</dt><dd>{kinematicsAvailable ? `SOLVED · ${project.activeCornerId}` : "ACTIVE CORNER NOT SOLVED"}</dd></div>
            <div><dt>Full-car ride</dt><dd>{fullCarResult ? "VERIFIED_NUMERICALLY" : "NO ACCEPTED RESULT"}</dd></div>
            <div><dt>Bicycle</dt><dd>{bicycleResult ? "VERIFIED_NUMERICALLY" : "NO ACCEPTED RESULT"}</dd></div>
            <div><dt>Physical status</dt><dd>{project.validation.physical}</dd></div>
          </dl>
          <p className="field-note">One solved corner is never copied to the other three. Unsupported coupling is blocked or left static with an explicit explanation.</p>
        </section>
      </aside>
    </div>
  );
}
