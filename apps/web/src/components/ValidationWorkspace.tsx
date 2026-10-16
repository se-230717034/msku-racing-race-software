import type { ValidationEvidence } from "@msku/contracts";
import { AlertTriangle, CheckCircle2, ClipboardCheck, LockKeyhole, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { useWorkspace } from "../store/workspace";

const evidenceLabels: Record<ValidationEvidence["kind"], string> = {
  numerical_benchmark: "Numerical benchmark",
  cad_comparison: "CAD / motion-study comparison",
  physical_measurement: "Physical measurement",
  input_provenance: "Input provenance",
};

export function ValidationWorkspace() {
  const project = useWorkspace((state) => state.project);
  const updateProvenance = useWorkspace((state) => state.updateProvenance);
  const addEvidence = useWorkspace((state) => state.addValidationEvidence);
  const [kind, setKind] = useState<ValidationEvidence["kind"]>("input_provenance");
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");
  const [reviewStatus, setReviewStatus] = useState<ValidationEvidence["status"]>("pending_review");
  const acceptedKinds = useMemo(() => new Set(project.validation.evidence.filter((item) => item.status === "accepted").map((item) => item.kind)), [project.validation.evidence]);
  const gaps = [
    !acceptedKinds.has("input_provenance") && "Reviewed source/provenance record missing",
    !acceptedKinds.has("cad_comparison") && "Independent CAD or motion-study comparison missing",
    !acceptedKinds.has("physical_measurement") && "Physical rig/vehicle measurement correlation missing",
    Object.values(project.vehicle.corners).some((corner) => corner.geometrySource !== "independent") && "One or more corners use synthetic or mirrored assumptions",
  ].filter(Boolean) as string[];

  const submit = () => {
    if (!title.trim() || !source.trim()) return;
    addEvidence({
      id: globalThis.crypto?.randomUUID?.() ?? `evidence-${Date.now()}`,
      kind,
      title: title.trim(),
      source: source.trim(),
      recordedAt: new Date().toISOString(),
      status: reviewStatus,
      notes: notes.trim(),
    });
    setTitle(""); setSource(""); setNotes(""); setReviewStatus("pending_review");
  };

  return <main className="validation-workspace">
    <header className="validation-header">
      <span className="eyebrow">PHASE 6 · ENGINEERING SAFETY GATE</span>
      <h1>Validation & evidence</h1>
      <p>Evidence records are traceability inputs, not automatic proof. This software does not promote a project to physical validation or engineering approval.</p>
    </header>
    <div className="validation-layout">
      <section className="validation-column">
        <div className="validation-status-grid">
          <article><span>Numerical</span><strong>{project.validation.numerical}</strong><small>Solver/regression scope only</small></article>
          <article><span>Reference</span><strong>{project.validation.reference}</strong><small>Published internal benchmarks</small></article>
          <article className="warning"><span>Physical</span><strong>{project.validation.physical}</strong><small>Independent vehicle evidence required</small></article>
          <article className="warning"><span>Approval</span><strong>{project.validation.engineeringApproval}</strong><small>Human engineering review required</small></article>
        </div>
        <div className="validation-card">
          <div className="section-heading"><span className="eyebrow">INPUT PROVENANCE</span></div>
          <label className="text-field"><span>Project source label</span><input value={project.provenance.sourceLabel} onChange={(event) => updateProvenance(event.target.value)} /></label>
          {project.provenance.migratedFromSchemaVersion && <p className="field-note">Migrated from schema {project.provenance.migratedFromSchemaVersion}: {project.provenance.migrationNote}</p>}
          <table className="report-table"><thead><tr><th>Corner</th><th>Geometry source</th><th>Derivation</th></tr></thead><tbody>{Object.values(project.vehicle.corners).map((corner) => <tr key={corner.id}><td>{corner.label}</td><td>{corner.geometrySource}</td><td>{corner.derivedFrom ?? "independent definition"}</td></tr>)}</tbody></table>
        </div>
        <div className="validation-card">
          <div className="section-heading"><span className="eyebrow">VALIDATION GAPS</span><span className={`status-chip ${gaps.length ? "error" : "ok"}`}>{gaps.length ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}{gaps.length} OPEN</span></div>
          {gaps.length ? <ul className="validation-gaps">{gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul> : <p className="diagnostic-empty">Evidence checklist is complete, but independent human review and sign-off are still required.</p>}
          <button className="approval-disabled" type="button" disabled><LockKeyhole size={14} />Engineering approval unavailable in software</button>
        </div>
      </section>

      <section className="validation-column">
        <div className="validation-card">
          <div className="section-heading"><span className="eyebrow">ADD EVIDENCE RECORD</span><ClipboardCheck size={15} /></div>
          <label className="select-field"><span>Evidence type</span><select value={kind} onChange={(event) => setKind(event.target.value as ValidationEvidence["kind"])}>{Object.entries(evidenceLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label className="text-field"><span>Record title</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. CAD motion study comparison rev B" /></label>
          <label className="text-field"><span>Independent source / file reference</span><input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Controlled path, drawing ID, test ID, or URI" /></label>
          <label className="select-field evidence-status"><span>Review state</span><select value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value as ValidationEvidence["status"])}><option value="pending_review">Pending review</option><option value="accepted">Accepted evidence record</option><option value="rejected">Rejected</option></select></label>
          <label className="text-field"><span>Method, discrepancy, and reviewer notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          <button className="wide-action" type="button" disabled={!title.trim() || !source.trim()} onClick={submit}><Plus size={13} />Add traceability record</button>
          <p className="field-note">Accepted evidence remains a record only. It never changes {project.validation.physical} or {project.validation.engineeringApproval} automatically.</p>
        </div>
        <div className="validation-card grow">
          <div className="section-heading"><span className="eyebrow">EVIDENCE REGISTER</span><span className="unit-chip">{project.validation.evidence.length} RECORDS</span></div>
          {project.validation.evidence.length ? <ol className="evidence-list">{project.validation.evidence.map((item) => <li key={item.id}><div><strong>{item.title}</strong><span>{evidenceLabels[item.kind]} · {item.status.replace("_", " ")}</span></div><p>{item.source}</p><small>{item.recordedAt}{item.notes ? ` · ${item.notes}` : ""}</small></li>)}</ol> : <p className="diagnostic-empty">No project-specific CAD, measurement, benchmark, or provenance evidence has been recorded.</p>}
        </div>
      </section>
    </div>
  </main>;
}
