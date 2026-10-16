import { Camera, Eye, EyeOff, FlipHorizontal2, Layers3 } from "lucide-react";

import { useWorkspace, type CadViewMode, type CameraPreset } from "../store/workspace";

const presets: Array<{ id: CameraPreset; label: string }> = [
  { id: "perspective", label: "Perspektif" },
  { id: "isometric", label: "ISO" },
  { id: "front", label: "Ön" },
  { id: "rear", label: "Arka" },
  { id: "side", label: "Yan" },
  { id: "top", label: "Üst" },
];

const visibilityLabels = {
  upper: "üst kol",
  lower: "alt kol",
  steering: "direksiyon",
  upright: "taşıyıcı",
  wheel: "tekerlek montajı",
  tire: "lastik",
  rim: "jant",
  brake: "fren grubu",
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

export function GeometryToolbar() {
  const preset = useWorkspace((state) => state.cameraPreset);
  const setPreset = useWorkspace((state) => state.setCameraPreset);
  const visibility = useWorkspace((state) => state.visibility);
  const toggle = useWorkspace((state) => state.toggleVisibility);
  const cadMode = useWorkspace((state) => state.cadViewMode);
  const setCadMode = useWorkspace((state) => state.setCadViewMode);
  const inspectionOpen = !visibility.tire && !visibility.rim;

  const toggleAssemblyInspection = () => {
    if (inspectionOpen) {
      toggle("tire");
      toggle("rim");
      return;
    }
    if (visibility.tire) toggle("tire");
    if (visibility.rim) toggle("rim");
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
      <div className="toolbar-group" aria-label="Görünürlük kontrolleri">
        {(["upper", "lower", "steering", "upright", "wheel", "tire", "rim", "brake", "hardpoints", "chassis", "referencePlanes", "representativeActuation"] as const).map((key) => (
          <button key={key} type="button" className={visibility[key] ? "active" : ""} onClick={() => toggle(key)}>
            {visibility[key] ? <Eye size={13} /> : <EyeOff size={13} />}{visibilityLabels[key]}
          </button>
        ))}
        <button
          type="button"
          className={inspectionOpen ? "active" : ""}
          aria-label={inspectionOpen ? "Lastik ve jantı göster" : "Lastik ve jantı gizle"}
          onClick={toggleAssemblyInspection}
        >
          {inspectionOpen ? <Eye size={13} /> : <EyeOff size={13} />}montaj inceleme
        </button>
        <button type="button" className={visibility.mirror ? "active" : ""} onClick={() => toggle("mirror") }>
          <FlipHorizontal2 size={13} /> ayna
        </button>
      </div>
    </div>
  );
}

