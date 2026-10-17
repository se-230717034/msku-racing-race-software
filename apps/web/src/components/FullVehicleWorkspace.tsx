import type { CornerId, Vec3 } from "@msku/contracts";
import { Box, Camera, Eye, EyeOff, Layers3, Play, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { integratedYawRad } from "../domain/vehicle";
import { uiCorner, uiStatus } from "../lib/uiText";
import { useKinematics } from "../store/kinematics";
import {
  useWorkspace,
  type CadViewMode,
  type CameraPreset,
  type VehicleViewMode,
} from "../store/workspace";
import { FullVehicleViewport } from "./FullVehicleViewport";

const cameraPresets: Array<{ id: CameraPreset; label: string }> = [
  { id: "perspective", label: "Perspektif" },
  { id: "isometric", label: "İzometrik" },
  { id: "front", label: "Ön" },
  { id: "rear", label: "Arka" },
  { id: "side", label: "Yan" },
  { id: "top", label: "Üst" },
];

const viewModes: Array<{ id: VehicleViewMode; label: string }> = [
  { id: "full_vehicle", label: "Tam araç" },
  { id: "front_axle", label: "Ön aks" },
  { id: "rear_axle", label: "Arka aks" },
  { id: "active_corner", label: "Tek köşe" },
  { id: "chassis_cg", label: "Şasi / Ağırlık merkezi" },
  { id: "suspension", label: "Süspansiyon" },
  { id: "kinematics", label: "Kinematik oynatma" },
  { id: "dynamics", label: "Dinamik oynatma" },
];

const cadModes: Array<{ id: CadViewMode; label: string; ariaLabel: string }> = [
  { id: "technical", label: "Teknik", ariaLabel: "Teknik görünüm" },
  { id: "detailed", label: "Detaylı", ariaLabel: "Detaylı görünüm" },
  { id: "hybrid", label: "Karma", ariaLabel: "Karma görünüm" },
];

const visibilityLabels = {
  wheel: "tekerlek",
  hardpoints: "bağlantı noktaları",
  chassis: "şasi",
  referencePlanes: "referans düzlemleri",
  labels: "etiketler",
  coilover: "coilover",
  representativeActuation: "temsili çalıştırma",
};

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
  const cadMode = useWorkspace((state) => state.cadViewMode);
  const setCadMode = useWorkspace((state) => state.setCadViewMode);
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
        <div className="toolbar-group" aria-label="Araç görünüm kontrolleri">
          <Box size={14} />
          <select aria-label="Araç görünüm modu" value={viewMode} onChange={(event) => setViewMode(event.target.value as VehicleViewMode)}>
            {viewModes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>
        <div className="toolbar-divider" />
        <div className="toolbar-group cad-mode-control" aria-label="CAD görünüm biçimi">
          <Layers3 size={14} />
          {cadModes.map((item) => <button
            key={item.id}
            type="button"
            aria-label={item.ariaLabel}
            aria-pressed={cadMode === item.id}
            className={cadMode === item.id ? "active" : ""}
            onClick={() => setCadMode(item.id)}
          >{item.label}</button>)}
        </div>
        <div className="toolbar-divider" />
        <div className="toolbar-group" aria-label="Tam araç kamera görünümleri">
          <Camera size={14} />
          {cameraPresets.map((item) => <button key={item.id} type="button" className={preset === item.id ? "active" : ""} onClick={() => setPreset(item.id)}>{item.label}</button>)}
        </div>
        <div className="toolbar-divider" />
        <div className="toolbar-group" aria-label="Tam araç görünürlüğü">
          {(["wheel", "coilover", "hardpoints", "chassis", "referencePlanes", "labels", "representativeActuation"] as const).map((key) => <button key={key} type="button" className={visibility[key] ? "active" : ""} onClick={() => toggleVisibility(key)}>{visibility[key] ? <Eye size={12} /> : <EyeOff size={12} />}{visibilityLabels[key]}</button>)}
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
            <span>{viewMode === "kinematics" ? "Çözülmüş tekerlek hareketi" : fullCarResult ? "7SD zaman örneği" : bicycleResult ? "Bisiklet modeli zaman örneği" : "Desteklenen sonuç yok"}</span>
            {viewMode === "kinematics" ? (
              <input
                aria-label="Tam araç kinematik oynatma"
                type="range"
                min="0"
                max={Math.max((sweep?.states.length ?? 1) - 1, 0)}
                value={selectedKinematicsIndex}
                disabled={!kinematicsAvailable}
                onChange={(event) => setSelectedKinematicsIndex(Number(event.target.value))}
              />
            ) : (
              <input
                aria-label="Tam araç dinamik oynatma"
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
              ? kinematicsAvailable ? `${((sweep?.states[selectedKinematicsIndex]?.travelM ?? 0) * 1_000).toFixed(1)} mm` : "ÇALIŞTIRMA GEREKLİ"
              : currentFullCar ? `${currentFullCar.timeS.toFixed(3)} s` : currentBicycle ? `${currentBicycle.timeS.toFixed(3)} s` : "ÇALIŞTIRMA GEREKLİ"}</b>
          </div>
        )}
      </main>

      <aside className="vehicle-inspector">
        <section className="inspector-section">
          <div className="section-heading"><span className="eyebrow">DÖRT KÖŞE YAPILANDIRMASI</span><span className="unit-chip">SI</span></div>
          <label className="select-field"><span>Düzenlenen etkin köşe</span><select aria-label="Etkin araç köşesi" value={project.activeCornerId} onChange={(event) => setActiveCorner(event.target.value as CornerId)}>{cornerIds.map((id) => <option key={id} value={id}>{uiCorner(id)}</option>)}</select></label>
          <p className="corner-source"><b>{uiStatus(activeCorner.geometrySource)}</b>{activeCorner.derivedFrom ? ` · ${uiCorner(activeCorner.derivedFrom)} köşesinden türetildi` : ""}<span>{activeCorner.provenanceNote}</span></p>
          <button className="wide-action" type="button" onClick={() => setActiveModule("geometry")}><SlidersHorizontal size={13} />Etkin köşe bağlantı noktalarını düzenle</button>
        </section>
        <section className="inspector-section">
          <div className="section-heading"><span className="eyebrow">ARAÇ REFERANSLARI</span></div>
          <div className="vehicle-metric-grid">
            <MetricField label="Dingil mesafesi" value={project.vehicle.wheelbaseM} onChange={(value) => updateDimension("wheelbaseM", value)} />
            <MetricField label="Ön iz genişliği" value={project.vehicle.frontTrackM} onChange={(value) => updateDimension("frontTrackM", value)} />
            <MetricField label="Arka iz genişliği" value={project.vehicle.rearTrackM} onChange={(value) => updateDimension("rearTrackM", value)} />
          </div>
          <div className="coordinate-grid">
            {(["x", "y", "z"] as const).map((axis) => <MetricField key={axis} axis={axis} label="Ağırlık merkezi" value={project.vehicle.cgPositionM[axis]} onChange={(value) => updateCg(axis, value)} />)}
          </div>
          <p className="field-note">Dingil mesafesi, iz genişliği ve ağırlık merkezi yapılandırılabilir referans verileridir. Tel kafes şasi yapısal olmayan bir zarftır ve süspansiyon bağlantı noktası üretmez.</p>
        </section>
        <section className="inspector-section grow">
          <div className="section-heading"><span className="eyebrow">MODEL KULLANILABİLİRLİĞİ</span></div>
          <dl className="solver-diagnostics quality-status">
            <div><dt>Kinematik</dt><dd>{kinematicsAvailable ? `ÇÖZÜLDÜ · ${uiCorner(project.activeCornerId)}` : "ETKİN KÖŞE ÇÖZÜLMEDİ"}</dd></div>
            <div><dt>Tam araç sürüşü</dt><dd>{fullCarResult ? uiStatus("VERIFIED_NUMERICALLY") : "KABUL EDİLMİŞ SONUÇ YOK"}</dd></div>
            <div><dt>Bisiklet modeli</dt><dd>{bicycleResult ? uiStatus("VERIFIED_NUMERICALLY") : "KABUL EDİLMİŞ SONUÇ YOK"}</dd></div>
            <div><dt>Fiziksel durum</dt><dd>{uiStatus(project.validation.physical)}</dd></div>
          </dl>
          <p className="field-note">Çözülmüş bir köşe diğer üç köşeye hiçbir zaman kopyalanmaz. Desteklenmeyen bağlantılar engellenir veya açık bir açıklamayla statik bırakılır.</p>
        </section>
      </aside>
    </div>
  );
}
