import type { ValidationEvidence } from "@msku/contracts";
import { AlertTriangle, CheckCircle2, ClipboardCheck, LockKeyhole, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { useWorkspace } from "../store/workspace";
import { uiCorner, uiStatus } from "../lib/uiText";

const evidenceLabels: Record<ValidationEvidence["kind"], string> = {
  numerical_benchmark: "Sayısal referans testi",
  cad_comparison: "CAD / hareket analizi karşılaştırması",
  physical_measurement: "Fiziksel ölçüm",
  input_provenance: "Girdi kaynağı",
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
  const verification = project.verification;
  const manifest = project.parameterManifest;
  const acceptedKinds = useMemo(() => new Set(project.validation.evidence.filter((item) => item.status === "accepted").map((item) => item.kind)), [project.validation.evidence]);
  const gaps = [
    !acceptedKinds.has("input_provenance") && "İncelenmiş kaynak/köken kaydı eksik",
    !acceptedKinds.has("cad_comparison") && "Bağımsız CAD veya hareket analizi karşılaştırması eksik",
    !acceptedKinds.has("physical_measurement") && "Fiziksel test düzeneği/araç ölçüm korelasyonu eksik",
    Object.values(project.vehicle.corners).some((corner) => corner.geometrySource !== "independent") && "Bir veya daha fazla köşede sentetik ya da ayna varsayımı kullanılıyor",
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
      <span className="eyebrow">FAZ 6 · MÜHENDİSLİK GÜVENLİK KAPISI</span>
      <h1>Doğrulama ve kanıt</h1>
      <p>Kanıt kayıtları izlenebilirlik girdileridir; otomatik ispat değildir. Bu yazılım bir projeyi fiziksel olarak doğrulanmış veya mühendislik açısından onaylanmış duruma getirmez.</p>
    </header>
    <div className="validation-layout">
      <section className="validation-column">
        <div className="validation-status-grid">
          <article><span>Beyan</span><strong>{uiStatus(verification?.declared.status ?? "NOT_DECLARED")}</strong><small>{verification?.declared.evidenceIds.length ?? 0} ayrı kanıt bağı</small></article>
          <article><span>Sayısal</span><strong>{uiStatus(verification?.numerical.status ?? project.validation.numerical)}</strong><small>Yalnızca çözücü/regresyon kapsamı</small></article>
          <article><span>Referans</span><strong>{uiStatus(verification?.reference.status ?? project.validation.reference)}</strong><small>İç referans testleri; araç korelasyonu değildir</small></article>
          <article className="warning"><span>Fiziksel korelasyon</span><strong>{uiStatus(verification?.physical.status ?? project.validation.physical)}</strong><small>Bağımsız ölçüm kanıtı gerekli</small></article>
          <article className="warning"><span>Onay</span><strong>{uiStatus(project.validation.engineeringApproval)}</strong><small>İnsan mühendislik incelemesi gerekli</small></article>
        </div>
        <div className="validation-card">
          <div className="section-heading"><span className="eyebrow">ARAÇ PARAMETRE MANİFESTOSU</span><span className="unit-chip">{manifest ? `REV ${manifest.revision}` : "YOK"}</span></div>
          {manifest ? <dl className="solver-diagnostics compact">
            <div><dt>Konfigürasyon</dt><dd>{manifest.configurationLabel}</dd></div>
            <div><dt>Manifest</dt><dd>{manifest.manifestId}</dd></div>
            <div><dt>Parametre</dt><dd>{manifest.parameters.length}</dd></div>
            <div><dt>Sentetik</dt><dd>{manifest.parameters.filter((item) => item.measurementStatus === "SYNTHETIC").length}</dd></div>
            <div><dt>Ölçülmüş</dt><dd>{manifest.parameters.filter((item) => item.measurementStatus === "MEASURED").length}</dd></div>
          </dl> : <p className="solver-failure">Sürümlenmiş araç parametre manifestosu bağlı değil.</p>}
          <p className="field-note">Sentetik veya beyan edilmiş değerler, fiziksel ölçüm olarak değerlendirilmez.</p>
        </div>
        <div className="validation-card">
          <div className="section-heading"><span className="eyebrow">GİRDİ KAYNAĞI</span></div>
          <label className="text-field"><span>Proje kaynak etiketi</span><input value={project.provenance.sourceLabel} onChange={(event) => updateProvenance(event.target.value)} /></label>
          {project.provenance.migratedFromSchemaVersion && <p className="field-note">{project.provenance.migratedFromSchemaVersion} şemasından taşındı: {project.provenance.migrationNote}</p>}
          <table className="report-table"><thead><tr><th>Köşe</th><th>Geometri kaynağı</th><th>Türetme</th></tr></thead><tbody>{Object.values(project.vehicle.corners).map((corner) => <tr key={corner.id}><td>{uiCorner(corner.id)}</td><td>{uiStatus(corner.geometrySource)}</td><td>{corner.derivedFrom ? uiCorner(corner.derivedFrom) : "bağımsız tanım"}</td></tr>)}</tbody></table>
        </div>
        <div className="validation-card">
          <div className="section-heading"><span className="eyebrow">DOĞRULAMA EKSİKLERİ</span><span className={`status-chip ${gaps.length ? "error" : "ok"}`}>{gaps.length ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}{gaps.length} AÇIK</span></div>
          {gaps.length ? <ul className="validation-gaps">{gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul> : <p className="diagnostic-empty">Kanıt kontrol listesi tamamlandı; ancak bağımsız insan incelemesi ve onayı hâlâ gereklidir.</p>}
          <button className="approval-disabled" type="button" disabled><LockKeyhole size={14} />Mühendislik onayı yazılım üzerinden verilemez</button>
        </div>
      </section>

      <section className="validation-column">
        <div className="validation-card">
          <div className="section-heading"><span className="eyebrow">KANIT KAYDI EKLE</span><ClipboardCheck size={15} /></div>
          <label className="select-field"><span>Kanıt türü</span><select value={kind} onChange={(event) => setKind(event.target.value as ValidationEvidence["kind"])}>{Object.entries(evidenceLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label className="text-field"><span>Kayıt başlığı</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="ör. CAD hareket analizi karşılaştırması rev B" /></label>
          <label className="text-field"><span>Bağımsız kaynak / dosya referansı</span><input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Kontrollü yol, çizim kimliği, test kimliği veya URI" /></label>
          <label className="select-field evidence-status"><span>İnceleme durumu</span><select value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value as ValidationEvidence["status"])}><option value="pending_review">İnceleme bekliyor</option><option value="accepted">Kanıt kaydı kabul edildi</option><option value="rejected">Reddedildi</option></select></label>
          <label className="text-field"><span>Yöntem, fark ve inceleyen notları</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          <button className="wide-action" type="button" disabled={!title.trim() || !source.trim()} onClick={submit}><Plus size={13} />İzlenebilirlik kaydı ekle</button>
          <p className="field-note">Kabul edilmiş kanıt yalnızca kayıt olarak kalır. {uiStatus(project.validation.physical)} veya {uiStatus(project.validation.engineeringApproval)} durumlarını otomatik değiştirmez.</p>
        </div>
        <div className="validation-card grow">
          <div className="section-heading"><span className="eyebrow">KANIT KAYITLARI</span><span className="unit-chip">{project.validation.evidence.length} KAYIT</span></div>
          {project.validation.evidence.length ? <ol className="evidence-list">{project.validation.evidence.map((item) => <li key={item.id}><div><strong>{item.title}</strong><span>{evidenceLabels[item.kind]} · {uiStatus(item.status)}</span></div><p>{item.source}</p><small>{item.recordedAt}{item.notes ? ` · ${item.notes}` : ""}</small></li>)}</ol> : <p className="diagnostic-empty">Projeye özel CAD, ölçüm, referans test veya kaynak kanıtı kaydedilmedi.</p>}
        </div>
      </section>
    </div>
  </main>;
}
