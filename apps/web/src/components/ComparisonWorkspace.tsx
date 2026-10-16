import type { CornerId, Suspension } from "@msku/contracts";
import { GitCompareArrows } from "lucide-react";
import { useMemo, useState } from "react";

import { LINKS } from "../domain/geometry";
import { uiCorner, uiStatus } from "../lib/uiText";
import { useKinematics } from "../store/kinematics";
import { useWorkspace } from "../store/workspace";

const cornerIds: CornerId[] = ["front_left", "front_right", "rear_left", "rear_right"];

const lengths = (suspension: Suspension): Record<string, number> => {
  const points = new Map(suspension.hardpoints.map((point) => [point.id, point.position]));
  return Object.fromEntries(LINKS.map((link) => {
    const start = points.get(link.start)!; const end = points.get(link.end)!;
    return [link.id, Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z)];
  }));
};

export function ComparisonWorkspace() {
  const project = useWorkspace((state) => state.project);
  const sweep = useKinematics((state) => state.sweep);
  const solvedCornerId = useKinematics((state) => state.solvedCornerId);
  const [baselineId, setBaselineId] = useState<CornerId>("front_left");
  const [candidateId, setCandidateId] = useState<CornerId>("rear_left");
  const baseline = project.vehicle.corners[baselineId];
  const candidate = project.vehicle.corners[candidateId];
  const baselineLengths = useMemo(() => lengths(baseline.suspension), [baseline.suspension]);
  const candidateLengths = useMemo(() => lengths(candidate.suspension), [candidate.suspension]);
  const baselinePoints = new Map(baseline.suspension.hardpoints.map((point) => [point.id, point.position]));

  return <main className="comparison-workspace">
    <header className="comparison-header">
      <div><span className="eyebrow">FAZ 6 · GİRDİ KARŞILAŞTIRMASI</span><h1>Köşe karşılaştırması</h1></div>
      <p>Yalnızca kaydedilmiş kesin girdiler kullanılır. Bir köşenin sonucu başka bir köşenin çözümü olarak kabul edilmez.</p>
    </header>
    <section className="comparison-selectors">
      <label className="select-field"><span>Referans köşe</span><select aria-label="Referans karşılaştırma köşesi" value={baselineId} onChange={(event) => setBaselineId(event.target.value as CornerId)}>{cornerIds.map((id) => <option key={id} value={id}>{uiCorner(id)}</option>)}</select></label>
      <GitCompareArrows />
      <label className="select-field"><span>Aday köşe</span><select aria-label="Aday karşılaştırma köşesi" value={candidateId} onChange={(event) => setCandidateId(event.target.value as CornerId)}>{cornerIds.map((id) => <option key={id} value={id}>{uiCorner(id)}</option>)}</select></label>
    </section>
    <div className="comparison-grid">
      <section className="validation-card">
        <h2>Tanım kaynağı</h2>
        <table className="report-table"><thead><tr><th>Alan</th><th>{uiCorner(baselineId)}</th><th>{uiCorner(candidateId)}</th></tr></thead><tbody>
          <tr><td>Kaynak</td><td>{uiStatus(baseline.geometrySource)}</td><td>{uiStatus(candidate.geometrySource)}</td></tr>
          <tr><td>Türetildiği köşe</td><td>{baseline.derivedFrom ? uiCorner(baseline.derivedFrom) : "—"}</td><td>{candidate.derivedFrom ? uiCorner(candidate.derivedFrom) : "—"}</td></tr>
          <tr><td>Tekerlek yarıçapı</td><td>{baseline.suspension.wheel.radius.toFixed(6)} m</td><td>{candidate.suspension.wheel.radius.toFixed(6)} m</td></tr>
          <tr><td>Statik kamber</td><td>{(baseline.suspension.wheel.staticCamberRad * 180 / Math.PI).toFixed(4)}°</td><td>{(candidate.suspension.wheel.staticCamberRad * 180 / Math.PI).toFixed(4)}°</td></tr>
          <tr><td>Statik toe</td><td>{(baseline.suspension.wheel.staticToeRad * 180 / Math.PI).toFixed(4)}°</td><td>{(candidate.suspension.wheel.staticToeRad * 180 / Math.PI).toFixed(4)}°</td></tr>
        </tbody></table>
        <p className="field-note">{candidate.provenanceNote}</p>
      </section>
      <section className="validation-card">
        <h2>Rijit bağlantı uzunluğu karşılaştırması</h2>
        <table className="report-table"><thead><tr><th>Bağlantı</th><th>Referans mm</th><th>Aday mm</th><th>Δ mm</th></tr></thead><tbody>{LINKS.map((link) => <tr key={link.id}><td>{link.label}</td><td>{(baselineLengths[link.id] * 1_000).toFixed(3)}</td><td>{(candidateLengths[link.id] * 1_000).toFixed(3)}</td><td>{((candidateLengths[link.id] - baselineLengths[link.id]) * 1_000).toFixed(3)}</td></tr>)}</tbody></table>
      </section>
      <section className="validation-card comparison-points">
        <h2>Bağlantı noktası koordinat farkları</h2>
        <table className="report-table"><thead><tr><th>Bağlantı noktası</th><th>ΔX mm</th><th>ΔY mm</th><th>ΔZ mm</th></tr></thead><tbody>{candidate.suspension.hardpoints.map((point) => {
          const source = baselinePoints.get(point.id)!;
          return <tr key={point.id}><td>{point.id}</td><td>{((point.position.x - source.x) * 1_000).toFixed(3)}</td><td>{((point.position.y - source.y) * 1_000).toFixed(3)}</td><td>{((point.position.z - source.z) * 1_000).toFixed(3)}</td></tr>;
        })}</tbody></table>
      </section>
      <section className="validation-card">
        <h2>Hesaplanan sonuç kullanılabilirliği</h2>
        {sweep && solvedCornerId ? <><p><b>{uiCorner(solvedCornerId)}</b> için kabul edilmiş/denenmiş bir kinematik tarama saklanıyor.</p><p className="solver-failure">Diğer seçili köşe bağımsız olarak çözülüp saklanmadığı için köşeler arası sonuç karşılaştırması gösterilmiyor.</p></> : <p className="diagnostic-empty">Köşe taraması yok. Hesaplanan sonuçları karşılaştırmadan önce gerekli her köşeyi bağımsız olarak çalıştırın.</p>}
        <p className="field-note">Bu koruma, aynalanmış veya sentetik bir girdi tanımının uydurma çözücü kanıtına dönüşmesini önler.</p>
      </section>
    </div>
  </main>;
}
