import type { CornerId, Suspension } from "@msku/contracts";
import { GitCompareArrows } from "lucide-react";
import { useMemo, useState } from "react";

import { LINKS } from "../domain/geometry";
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
      <div><span className="eyebrow">PHASE 6 · INPUT COMPARISON</span><h1>Corner comparison</h1></div>
      <p>Exact stored inputs only. A result from one corner is never treated as a solution for another corner.</p>
    </header>
    <section className="comparison-selectors">
      <label className="select-field"><span>Baseline corner</span><select aria-label="Baseline comparison corner" value={baselineId} onChange={(event) => setBaselineId(event.target.value as CornerId)}>{cornerIds.map((id) => <option key={id} value={id}>{project.vehicle.corners[id].label}</option>)}</select></label>
      <GitCompareArrows />
      <label className="select-field"><span>Candidate corner</span><select aria-label="Candidate comparison corner" value={candidateId} onChange={(event) => setCandidateId(event.target.value as CornerId)}>{cornerIds.map((id) => <option key={id} value={id}>{project.vehicle.corners[id].label}</option>)}</select></label>
    </section>
    <div className="comparison-grid">
      <section className="validation-card">
        <h2>Definition provenance</h2>
        <table className="report-table"><thead><tr><th>Field</th><th>{baseline.label}</th><th>{candidate.label}</th></tr></thead><tbody>
          <tr><td>Source</td><td>{baseline.geometrySource}</td><td>{candidate.geometrySource}</td></tr>
          <tr><td>Derived from</td><td>{baseline.derivedFrom ?? "—"}</td><td>{candidate.derivedFrom ?? "—"}</td></tr>
          <tr><td>Wheel radius</td><td>{baseline.suspension.wheel.radius.toFixed(6)} m</td><td>{candidate.suspension.wheel.radius.toFixed(6)} m</td></tr>
          <tr><td>Static camber</td><td>{(baseline.suspension.wheel.staticCamberRad * 180 / Math.PI).toFixed(4)}°</td><td>{(candidate.suspension.wheel.staticCamberRad * 180 / Math.PI).toFixed(4)}°</td></tr>
          <tr><td>Static toe</td><td>{(baseline.suspension.wheel.staticToeRad * 180 / Math.PI).toFixed(4)}°</td><td>{(candidate.suspension.wheel.staticToeRad * 180 / Math.PI).toFixed(4)}°</td></tr>
        </tbody></table>
        <p className="field-note">{candidate.provenanceNote}</p>
      </section>
      <section className="validation-card">
        <h2>Rigid-link length comparison</h2>
        <table className="report-table"><thead><tr><th>Link</th><th>Baseline mm</th><th>Candidate mm</th><th>Δ mm</th></tr></thead><tbody>{LINKS.map((link) => <tr key={link.id}><td>{link.id}</td><td>{(baselineLengths[link.id] * 1_000).toFixed(3)}</td><td>{(candidateLengths[link.id] * 1_000).toFixed(3)}</td><td>{((candidateLengths[link.id] - baselineLengths[link.id]) * 1_000).toFixed(3)}</td></tr>)}</tbody></table>
      </section>
      <section className="validation-card comparison-points">
        <h2>Hardpoint coordinate differences</h2>
        <table className="report-table"><thead><tr><th>Hardpoint</th><th>ΔX mm</th><th>ΔY mm</th><th>ΔZ mm</th></tr></thead><tbody>{candidate.suspension.hardpoints.map((point) => {
          const source = baselinePoints.get(point.id)!;
          return <tr key={point.id}><td>{point.id}</td><td>{((point.position.x - source.x) * 1_000).toFixed(3)}</td><td>{((point.position.y - source.y) * 1_000).toFixed(3)}</td><td>{((point.position.z - source.z) * 1_000).toFixed(3)}</td></tr>;
        })}</tbody></table>
      </section>
      <section className="validation-card">
        <h2>Calculated-result availability</h2>
        {sweep && solvedCornerId ? <><p>One accepted/attempted kinematics sweep is currently stored for <b>{solvedCornerId.replace("_", " ")}</b>.</p><p className="solver-failure">No cross-corner result comparison is shown because the other selected corner was not independently solved and retained.</p></> : <p className="diagnostic-empty">No corner sweep is available. Run each required corner independently before comparing calculated results.</p>}
        <p className="field-note">This guard prevents a mirrored or synthetic input definition from becoming fabricated solver evidence.</p>
      </section>
    </div>
  </main>;
}
