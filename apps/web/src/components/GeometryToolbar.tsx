import { Camera, Eye, EyeOff, FlipHorizontal2, Layers3 } from "lucide-react";

import { useWorkspace, type CadViewMode, type CameraPreset, type VisualModelSource } from "../store/workspace";

const presets: Array<{ id: CameraPreset; label: string }> = [
  { id: "perspective", label: "Perspektif" },
  { id: "isometric", label: "ISO" },
  { id: "front", label: "Ön" },
  { id: "rear", label: "Arka" },
  { id: "side", label: "Yan" },
  { id: "top", label: "Üst" },
];

const visibilityLabels = {
  upper: "üst salıncak",
  lower: "alt salıncak",
  steering: "rot kolu",
  upright: "taşıyıcı",
  wheel: "tekerlek montajı",
  tire: "lastik",
  rim: "jant",
  brakeDisc: "fren diski",
  caliper: "kaliper",
  hub: "porya",
  coilover: "coilover önizlemesi",
  hardpoints: "bağlantı noktaları",
  chassis: "şasi referansı",
  referencePlanes: "referans düzlemi",
  representativeActuation: "temsili çalıştırma",
};

const cadModes: Array<{ id: CadViewMode; label: string; ariaLabel: string }> = [
  { id: "technical", label: "Teknik", ariaLabel: "Teknik görünüm" },
  { id: "detailed", label: "Detaylı", ariaLabel: "Detaylı görünüm" },
  { id: "hybrid", label: "Karma", ariaLabel: "Karma görünüm" },
];

const modelSources: Array<{ id: VisualModelSource; label: string; ariaLabel: string }> = [
  { id: "glb", label: "GLB modeller", ariaLabel: "Hazır GLB modellerini kullan" },
  { id: "procedural", label: "Prosedürel", ariaLabel: "Prosedürel modelleri kullan" },
];

export function GeometryToolbar() {
  const preset = useWorkspace((state) => state.cameraPreset);
  const setPreset = useWorkspace((state) => state.setCameraPreset);
  const visibility = useWorkspace((state) => state.visibility);
  const toggle = useWorkspace((state) => state.toggleVisibility);
  const setVisibility = useWorkspace((state) => state.setVisibility);
  const cadMode = useWorkspace((state) => state.cadViewMode);
  const setCadMode = useWorkspace((state) => state.setCadViewMode);
  const visualModelSource = useWorkspace((state) => state.visualModelSource);
  const setVisualModelSource = useWorkspace((state) => state.setVisualModelSource);
  const mechanicalAssemblyActive = !visibility.tire
    && !visibility.rim
    && visibility.upright
    && visibility.upper
    && visibility.lower
    && visibility.steering
    && visibility.brakeDisc
    && visibility.caliper
    && visibility.hub;

  const toggleMechanicalAssembly = () => {
    if (mechanicalAssemblyActive) {
      setVisibility({ tire: true, rim: true });
      return;
    }
    setVisibility({
      wheel: true,
      tire: false,
      rim: false,
      upright: true,
      upper: true,
      lower: true,
      steering: true,
      brake: true,
      brakeDisc: true,
      caliper: true,
      hub: true,
      coilover: true,
      hardpoints: false,
      chassis: false,
      referencePlanes: false,
      representativeActuation: false,
      mirror: false,
    });
    setPreset("perspective");
  };

  return (
    <div className="geometry-toolbar">
      <div className="toolbar-group" aria-label="Kamera görünümleri">
        <Camera size={15} />
        {presets.map((item) => (
          <button key={item.id} type="button" className={preset === item.id ? "active" : ""} onClick={() => setPreset(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="toolbar-divider" />
      <div className="toolbar-group cad-mode-control" aria-label="CAD görünüm biçimi">
        <Layers3 size={15} />
        {cadModes.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-label={item.ariaLabel}
            aria-pressed={cadMode === item.id}
            className={cadMode === item.id ? "active" : ""}
            onClick={() => setCadMode(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="toolbar-divider" />
      <div className="toolbar-group model-source-control" aria-label="3B model kaynağı">
        <Layers3 size={15} />
        {modelSources.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-label={item.ariaLabel}
            aria-pressed={visualModelSource === item.id}
            className={visualModelSource === item.id ? "active" : ""}
            onClick={() => setVisualModelSource(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="toolbar-divider" />
      <div className="toolbar-group" aria-label="Görünürlük kontrolleri">
        {(["upper", "lower", "steering", "upright", "wheel", "tire", "rim", "brakeDisc", "caliper", "hub", "coilover", "hardpoints", "chassis", "referencePlanes", "representativeActuation"] as const).map((key) => (
          <button key={key} type="button" className={visibility[key] ? "active" : ""} onClick={() => toggle(key)}>
            {visibility[key] ? <Eye size={13} /> : <EyeOff size={13} />}{visibilityLabels[key]}
          </button>
        ))}
        <button
          type="button"
          className={mechanicalAssemblyActive ? "active" : ""}
          aria-label="Mekanik Montaj"
          aria-pressed={mechanicalAssemblyActive}
          onClick={toggleMechanicalAssembly}
        >
          <Layers3 size={13} />Mekanik Montaj
        </button>
        <button type="button" className={visibility.mirror ? "active" : ""} onClick={() => toggle("mirror") }>
          <FlipHorizontal2 size={13} /> ayna
        </button>
      </div>
    </div>
  );
}

