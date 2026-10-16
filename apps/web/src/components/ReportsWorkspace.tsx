import type { Suspension } from "@msku/contracts";
import { Download, FileJson, FileText, Printer } from "lucide-react";
import { useMemo } from "react";

import { LINKS } from "../domain/geometry";
import {
  buildEngineeringReport,
  downloadEngineeringCsv,
  downloadEngineeringJson,
  downloadEngineeringPdf,
} from "../lib/engineeringReport";
import { useKinematics } from "../store/kinematics";
import { useWorkspace } from "../store/workspace";

function CornerDiagram({ suspension, label }: { suspension: Suspension; label: string }) {
  const map = new Map(suspension.hardpoints.map((point) => [point.id, point.position]));
  const xs = suspension.hardpoints.map((point) => point.position.y);
  const ys = suspension.hardpoints.map((point) => point.position.z);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const x = (value: number) => 18 + (value - minX) / Math.max(maxX - minX, 1e-6) * 184;
  const y = (value: number) => 132 - (value - minY) / Math.max(maxY - minY, 1e-6) * 108;
  return <figure className="report-diagram">
    <figcaption>{label} · front projection · stored SI coordinates</figcaption>
    <svg viewBox="0 0 220 150" role="img" aria-label={`${label} suspension geometry diagram`}>
      <rect x="1" y="1" width="218" height="148" fill="#0b0e13" stroke="#313946" />
      {LINKS.map((link) => {
        const start = map.get(link.start); const end = map.get(link.end);
        return start && end ? <line key={link.id} x1={x(start.y)} y1={y(start.z)} x2={x(end.y)} y2={y(end.z)} stroke={link.group === "steering" ? "#ef233c" : "#aab4c1"} strokeWidth="1.5" /> : null;
      })}
      {suspension.hardpoints.map((point) => <circle key={point.id} cx={x(point.position.y)} cy={y(point.position.z)} r="2.2" fill="#f4f6f9"><title>{point.id}</title></circle>)}
      <text x="8" y="144" fill="#6f7988" fontSize="7">+Y left → · +Z up ↑</text>
    </svg>
  </figure>;
}

function ResultPlot({ values, label }: { values: Array<{ x: number; y: number }>; label: string }) {
  if (values.length < 2) return <div className="report-plot empty">No accepted samples</div>;
  const minX = Math.min(...values.map((item) => item.x)); const maxX = Math.max(...values.map((item) => item.x));
  const minY = Math.min(...values.map((item) => item.y)); const maxY = Math.max(...values.map((item) => item.y));
  const points = values.map((item) => `${12 + (item.x - minX) / Math.max(maxX - minX, 1e-12) * 196},${115 - (item.y - minY) / Math.max(maxY - minY, 1e-12) * 95}`).join(" ");
  return <figure className="report-diagram"><figcaption>{label}</figcaption><svg viewBox="0 0 220 130" role="img" aria-label={label}><rect x="1" y="1" width="218" height="128" fill="#0b0e13" stroke="#313946" /><polyline points={points} fill="none" stroke="#ef233c" strokeWidth="2" /><text x="8" y="124" fill="#6f7988" fontSize="7">computed samples · unvalidated</text></svg></figure>;
}

export function ReportsWorkspace() {
  const project = useWorkspace((state) => state.project);
  const fullCar = useWorkspace((state) => state.latestFullCarResult);
  const bicycle = useWorkspace((state) => state.latestBicycleResult);
  const kinematics = useKinematics((state) => state.sweep);
  const report = useMemo(() => buildEngineeringReport(project, { kinematics, fullCar, bicycle }), [project, kinematics, fullCar, bicycle]);
  const plotValues = kinematics?.states.flatMap((state) => state.metrics ? [{ x: state.travelM * 1_000, y: state.metrics.camberChangeRad * 180 / Math.PI }] : [])
    ?? fullCar?.samples.map((sample) => ({ x: sample.timeS, y: sample.bodyHeaveM * 1_000 }))
    ?? [];

  return <main className="reports-workspace">
    <header className="reports-toolbar">
      <div><span className="eyebrow">PHASE 6 · TRACEABLE DELIVERABLES</span><strong>Engineering report package</strong></div>
      <span>Every export remains {report.approval.status}. No numerical result is presented as physical validation.</span>
      <button type="button" onClick={() => downloadEngineeringPdf(report)}><FileText size={13} />Download PDF</button>
      <button type="button" onClick={() => downloadEngineeringCsv(report)}><Download size={13} />CSV</button>
      <button type="button" onClick={() => downloadEngineeringJson(report)}><FileJson size={13} />JSON</button>
      <button type="button" onClick={() => window.print()}><Printer size={13} />Print diagrams</button>
    </header>
    <article className="engineering-report" id="engineering-report">
      <section className="report-cover">
        <span className="eyebrow">MSKU RACING DYNAMICS STUDIO</span>
        <h1>{report.title}</h1>
        <p>Generated {report.generatedAt} · app {report.applicationVersion} · report {report.reportVersion} · project schema {project.schemaVersion}</p>
        <strong>{report.approval.status}</strong>
      </section>
      <section className="report-section report-grid">
        <div><h2>Project metadata</h2><dl className="report-dl"><div><dt>Project ID</dt><dd>{project.projectId}</dd></div><div><dt>Classification</dt><dd>{project.dataClassification}</dd></div><div><dt>Model status</dt><dd>{project.modelStatus}</dd></div><div><dt>Input source</dt><dd>{project.provenance.sourceLabel}</dd></div></dl></div>
        <div><h2>Units and frame</h2><p>{report.coordinateFrame}</p><p>{Object.entries(report.units).map(([quantity, unit]) => `${quantity}: ${unit}`).join(" · ")}</p></div>
      </section>
      <section className="report-section"><h2>Four-corner geometry diagrams</h2><div className="report-diagram-grid">{Object.values(project.vehicle.corners).map((corner) => <CornerDiagram key={corner.id} suspension={corner.suspension} label={`${corner.label} · ${corner.geometrySource.replaceAll("_", " ")}`} />)}</div></section>
      <section className="report-section report-grid"><div><h2>Latest calculated plot</h2><ResultPlot values={plotValues} label={kinematics ? "Camber change vs wheel travel (deg/mm axes)" : "Body heave vs time (mm/s axes)"} /></div><div><h2>Solver and provenance inventory</h2>{report.resultInventory.length ? <table className="report-table"><thead><tr><th>Model</th><th>Solver</th><th>Status</th></tr></thead><tbody>{report.resultInventory.map((result) => <tr key={`${result.model}-${result.inputSha256}`}><td>{result.model}<small>{result.inputSha256}</small></td><td>{result.solverVersion}</td><td>{result.numericalStatus}<small>{result.physicalStatus}</small></td></tr>)}</tbody></table> : <p>No accepted solver response is attached. Geometry-only reporting is still permitted with an explicit unapproved state.</p>}</div></section>
      <section className="report-section report-grid"><div><h2>Assumptions and limitations</h2><ul>{report.limitations.map((item) => <li key={item}>{item}</li>)}</ul></div><div><h2>Validation and approval</h2><dl className="report-dl"><div><dt>Numerical</dt><dd>{project.validation.numerical}</dd></div><div><dt>Reference</dt><dd>{project.validation.reference}</dd></div><div><dt>Physical</dt><dd>{project.validation.physical}</dd></div><div><dt>Approval</dt><dd>{project.validation.engineeringApproval}</dd></div></dl><p>{report.approval.reason}</p></div></section>
    </article>
  </main>;
}
