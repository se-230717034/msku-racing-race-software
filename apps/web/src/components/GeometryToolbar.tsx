import { Camera, Eye, EyeOff, FlipHorizontal2 } from "lucide-react";

import { useWorkspace, type CameraPreset } from "../store/workspace";

const presets: Array<{ id: CameraPreset; label: string }> = [
  { id: "perspective", label: "Perspective" },
  { id: "isometric", label: "ISO" },
  { id: "front", label: "Front" },
  { id: "rear", label: "Rear" },
  { id: "side", label: "Side" },
  { id: "top", label: "Top" },
];

export function GeometryToolbar() {
  const preset = useWorkspace((state) => state.cameraPreset);
  const setPreset = useWorkspace((state) => state.setCameraPreset);
  const visibility = useWorkspace((state) => state.visibility);
  const toggle = useWorkspace((state) => state.toggleVisibility);

  return (
    <div className="geometry-toolbar">
      <div className="toolbar-group" aria-label="Camera presets">
        <Camera size={15} />
        {presets.map((item) => (
          <button key={item.id} type="button" className={preset === item.id ? "active" : ""} onClick={() => setPreset(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="toolbar-divider" />
      <div className="toolbar-group" aria-label="Visibility controls">
        {(["upper", "lower", "steering", "upright", "wheel", "hardpoints"] as const).map((key) => (
          <button key={key} type="button" className={visibility[key] ? "active" : ""} onClick={() => toggle(key)}>
            {visibility[key] ? <Eye size={13} /> : <EyeOff size={13} />}{key}
          </button>
        ))}
        <button type="button" className={visibility.mirror ? "active" : ""} onClick={() => toggle("mirror") }>
          <FlipHorizontal2 size={13} /> mirror
        </button>
      </div>
    </div>
  );
}

