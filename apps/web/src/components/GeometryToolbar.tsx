import { Camera, Eye, EyeOff, FlipHorizontal2 } from "lucide-react";

import { useWorkspace, type CameraPreset } from "../store/workspace";

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
  wheel: "tekerlek",
  hardpoints: "bağlantı noktaları",
};

export function GeometryToolbar() {
  const preset = useWorkspace((state) => state.cameraPreset);
  const setPreset = useWorkspace((state) => state.setCameraPreset);
  const visibility = useWorkspace((state) => state.visibility);
  const toggle = useWorkspace((state) => state.toggleVisibility);

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
      <div className="toolbar-group" aria-label="Görünürlük kontrolleri">
        {(["upper", "lower", "steering", "upright", "wheel", "hardpoints"] as const).map((key) => (
          <button key={key} type="button" className={visibility[key] ? "active" : ""} onClick={() => toggle(key)}>
            {visibility[key] ? <Eye size={13} /> : <EyeOff size={13} />}{visibilityLabels[key]}
          </button>
        ))}
        <button type="button" className={visibility.mirror ? "active" : ""} onClick={() => toggle("mirror") }>
          <FlipHorizontal2 size={13} /> ayna
        </button>
      </div>
    </div>
  );
}

