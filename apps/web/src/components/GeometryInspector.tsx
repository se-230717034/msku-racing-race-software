import type { Vec3 } from "@msku/contracts";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useMemo, useState } from "react";

import { linkLengths, validateProjectGeometry } from "../domain/geometry";
import { useWorkspace } from "../store/workspace";
import { uiCorner, uiStatus } from "../lib/uiText";

function MillimetreField({
  id,
  label,
  valueMetres,
  onCommit,
}: {
  id: string;
  label: string;
  valueMetres: number;
  onCommit: (metres: number) => void;
}) {
  const [text, setText] = useState((valueMetres * 1000).toFixed(2));

  const commit = () => {
    const millimetres = Number(text);
    if (Number.isFinite(millimetres)) onCommit(millimetres / 1000);
    else setText((valueMetres * 1000).toFixed(2));
  };

  return (
    <label className="numeric-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="number"
        step="0.1"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setText((valueMetres * 1000).toFixed(2));
        }}
      />
      <em>mm</em>
    </label>
  );
}

function DegreeField({
  id,
  label,
  valueRadians,
  onCommit,
}: {
  id: string;
  label: string;
  valueRadians: number;
  onCommit: (radians: number) => void;
}) {
  const degrees = valueRadians * 180 / Math.PI;
  const [text, setText] = useState(degrees.toFixed(3));
  const commit = () => {
    const nextDegrees = Number(text);
    if (Number.isFinite(nextDegrees)) onCommit(nextDegrees * Math.PI / 180);
    else setText(degrees.toFixed(3));
  };
  return (
    <label className="numeric-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="number"
        step="0.05"
        min="-20"
        max="20"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setText(degrees.toFixed(3));
        }}
      />
      <em>deg</em>
    </label>
  );
}

export function GeometryInspector() {
  const project = useWorkspace((state) => state.project);
  const selectedId = useWorkspace((state) => state.selectedHardpointId);
  const select = useWorkspace((state) => state.setSelectedHardpoint);
  const updateHardpoint = useWorkspace((state) => state.updateHardpoint);
  const updateWheel = useWorkspace((state) => state.updateWheel);
  const selected = project.suspension.hardpoints.find((point) => point.id === selectedId) ?? project.suspension.hardpoints[0];
  const diagnostics = useMemo(() => validateProjectGeometry(project), [project]);
  const lengths = useMemo(() => {
    try {
      return linkLengths(project);
    } catch {
      return {};
    }
  }, [project]);

  return (
    <aside className="inspector">
      <section className="inspector-section">
        <div className="section-heading">
          <span className="eyebrow">GEOMETRİ GİRDİSİ</span>
          <span className="unit-chip">{uiCorner(project.activeCornerId)} · mm</span>
        </div>
        <p className="field-note">{uiStatus(project.vehicle.corners[project.activeCornerId].geometrySource)} · {project.vehicle.corners[project.activeCornerId].provenanceNote}</p>
        <label className="select-field" htmlFor="hardpoint-select">
          <span>Seçili bağlantı noktası</span>
          <select id="hardpoint-select" value={selected.id} onChange={(event) => select(event.target.value)}>
            {project.suspension.hardpoints.map((point) => (
              <option key={point.id} value={point.id}>{point.label}</option>
            ))}
          </select>
        </label>
        <div className="point-code">{selected.id}</div>
        <div className="coordinate-grid">
          {(["x", "y", "z"] as const).map((axis: keyof Vec3) => (
            <MillimetreField
              key={`${selected.id}-${axis}-${selected.position[axis]}`}
              id={`coordinate-${axis}`}
              label={axis.toUpperCase()}
              valueMetres={selected.position[axis]}
              onCommit={(value) => updateHardpoint(selected.id, axis, value)}
            />
          ))}
        </div>
      </section>

      <section className="inspector-section">
        <span className="eyebrow">TEKERLEK ZARFI</span>
        <div className="coordinate-grid two">
          <MillimetreField key={`radius-${project.suspension.wheel.radius}`} id="wheel-radius" label="Yarıçap" valueMetres={project.suspension.wheel.radius} onCommit={(value) => updateWheel("radius", value)} />
          <MillimetreField key={`width-${project.suspension.wheel.width}`} id="wheel-width" label="Genişlik" valueMetres={project.suspension.wheel.width} onCommit={(value) => updateWheel("width", value)} />
        </div>
        <div className="coordinate-grid two alignment-inputs">
          <DegreeField key={`camber-${project.suspension.wheel.staticCamberRad}`} id="static-camber" label="Statik kamber" valueRadians={project.suspension.wheel.staticCamberRad} onCommit={(value) => updateWheel("staticCamberRad", value)} />
          <DegreeField key={`toe-${project.suspension.wheel.staticToeRad}`} id="static-toe" label="Statik toe-in" valueRadians={project.suspension.wheel.staticToeRad} onCommit={(value) => updateWheel("staticToeRad", value)} />
        </div>
        <p className="field-note">Rot ayarı tekerlek referans yönelimini tanımlar. Pozitif toe içe bakışı, pozitif kamber tekerlek üstünün dışa yatmasını ifade eder.</p>
      </section>

      <section className="inspector-section grow">
        <div className="section-heading">
          <span className="eyebrow">MODEL TANILAMA</span>
          <span className={diagnostics.some((item) => item.severity === "error") ? "status-chip error" : "status-chip ok"}>
            {diagnostics.some((item) => item.severity === "error") ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
            {diagnostics.length === 0 ? "geçerli" : `${diagnostics.length} sorun`}
          </span>
        </div>
        {diagnostics.length === 0 ? (
          <p className="diagnostic-empty">Statik kontroller geçti. Bu sonuç kinematiği doğrulamaz.</p>
        ) : (
          <ul className="diagnostic-list">
            {diagnostics.map((item) => (
              <li key={`${item.code}-${item.pointIds.join("-")}`} className={item.severity}>
                <strong>{item.code}</strong>
                <span>{item.message}</span>
              </li>
            ))}
          </ul>
        )}
        <details className="length-list">
          <summary>Statik bağlantı uzunlukları</summary>
          {Object.entries(lengths).map(([id, length]) => (
            <div key={id}><span>{id.replaceAll("_", " ")}</span><b>{(length * 1000).toFixed(2)} mm</b></div>
          ))}
        </details>
      </section>
    </aside>
  );
}

