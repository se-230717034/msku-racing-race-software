import { AlertTriangle, CheckCircle2, Cpu, KeyRound, PlugZap, Power, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";

import {
  ANSYS_BRIDGE_TOKEN_STORAGE_KEY,
  ANSYS_BRIDGE_URL,
  launchRealAnsysConnection,
  probeAnsysBridge,
  readModalAnalysis,
  readStaticStructural,
  startModalAnalysis,
  startStaticStructural,
  testRealAnsysConnection,
  type AnsysBridgeStatus,
  type AnsysConnectionState,
  type CompatibilityState,
  type ConnectionTestState,
  type ModalAnalysisJob,
  type StaticStructuralJob,
} from "../lib/ansysBridge";
import {
  buildStudioTransfer, CAD_ANCHOR_IDS, frameDeterminant, parseVector3, vehicleToCadMm, vehicleVectorToCad,
  type SignedAxis,
} from "../lib/ansysStudioTransfer";
import { useWorkspace, type AnsysWrenchInput } from "../store/workspace";

const labels: Record<AnsysConnectionState["kind"], string> = {
  checking: "kontrol ediliyor",
  offline: "çevrimdışı",
  token_required: "token gerekli",
  unconfigured: "güvensiz yapılandırma",
  unauthorized: "yetki reddedildi",
  bridge_ready: "köprü hazır",
  connection_verified: "proses doğrulandı",
  error: "hata",
};

const compatibilityLabels: Record<CompatibilityState, string> = {
  COMPATIBLE: "Uyumlu",
  NOT_EVALUATED: "Değerlendirilemedi",
  PYMECHANICAL_NOT_INSTALLED: "PyMechanical kurulu değil",
  MECHANICAL_VERSION_UNSUPPORTED: "Mechanical sürümü desteklenmiyor",
  PYTHON_VERSION_UNSUPPORTED: "Python sürümü desteklenmiyor",
};

const connectionLabels: Record<ConnectionTestState, string> = {
  NOT_TESTED: "Test edilmedi",
  VERIFIED: "Gerçek proses doğrulandı",
  TEST_IN_PROGRESS: "Test devam ediyor",
  LAUNCH_IN_PROGRESS: "Mechanical başlatılıyor",
  INSTALLATION_NOT_FOUND: "Kurulum bulunamadı",
  INCOMPATIBLE: "Uyumsuz",
  PROCESS_NOT_REACHABLE: "Mechanical prosesi erişilemiyor",
  PROCESS_START_FAILED: "Mechanical başlatılamadı",
  AUTHENTICATION_FAILED: "Windows kimlik doğrulaması başarısız",
  LICENSE_ERROR: "Lisans hatası",
  VERIFICATION_FAILED: "Proses doğrulanamadı",
};

function initialToken(): string {
  try {
    return window.sessionStorage.getItem(ANSYS_BRIDGE_TOKEN_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function statusFrom(state: AnsysConnectionState): AnsysBridgeStatus | undefined {
  return state.kind === "bridge_ready" || state.kind === "connection_verified"
    ? state.status
    : undefined;
}

export function AnsysConnectionPanel() {
  const project = useWorkspace((workspace) => workspace.project);
  const latestAnsysWrench = useWorkspace((workspace) => workspace.latestAnsysWrench);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState(initialToken);
  const [state, setState] = useState<AnsysConnectionState>({ kind: "checking" });
  const [geometryPath, setGeometryPath] = useState("");
  const [fixedName, setFixedName] = useState("");
  const [forceName, setForceName] = useState("");
  const [forceAxis, setForceAxis] = useState<"X" | "Y" | "Z">("Z");
  const [forceN, setForceN] = useState("100");
  const [meshSizeMm, setMeshSizeMm] = useState("25");
  const [meshStudy, setMeshStudy] = useState(false);
  const [studioTransferEnabled, setStudioTransferEnabled] = useState(false);
  const [cadAxes, setCadAxes] = useState<[SignedAxis, SignedAxis, SignedAxis]>(["+X", "+Y", "+Z"]);
  const [cadOriginText, setCadOriginText] = useState("0, 0, 0");
  const [cadAnchorTexts, setCadAnchorTexts] = useState<Record<string, string>>({});
  const [importedWrench, setImportedWrench] = useState<AnsysWrenchInput | null>(null);
  const [modeCount, setModeCount] = useState("3");
  const [modalJob, setModalJob] = useState<ModalAnalysisJob | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [analysisJob, setAnalysisJob] = useState<StaticStructuralJob | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const activeJobId = analysisJob?.jobId;
  const activeJobState = analysisJob?.state;
  const activeModalJobId = modalJob?.jobId;
  const activeModalState = modalJob?.state;

  const checkBridge = async (candidateToken: string) => {
    setState({ kind: "checking" });
    setState(await probeAnsysBridge(ANSYS_BRIDGE_URL, candidateToken));
  };

  useEffect(() => {
    let active = true;
    void probeAnsysBridge(ANSYS_BRIDGE_URL, initialToken()).then((nextState) => {
      if (active) setState(nextState);
    });
    return () => { active = false; };
  }, []); // Probe once; real-process testing is always an explicit user action.

  useEffect(() => {
    if (!activeJobId || !activeJobState || !["QUEUED", "RUNNING"].includes(activeJobState)) return;
    let active = true;
    const timer = window.setInterval(() => {
      void readStaticStructural(ANSYS_BRIDGE_URL, token, activeJobId)
        .then((next) => { if (active) setAnalysisJob(next); })
        .catch((error: unknown) => {
          if (active) setAnalysisError(error instanceof Error ? error.message : "Analiz durumu alınamadı.");
        });
    }, 2_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [activeJobId, activeJobState, token]);

  useEffect(() => {
    if (!activeModalJobId || !activeModalState || !["QUEUED", "RUNNING"].includes(activeModalState)) return;
    let active = true;
    const timer = window.setInterval(() => {
      void readModalAnalysis(ANSYS_BRIDGE_URL, token, activeModalJobId)
        .then((next) => { if (active) setModalJob(next); })
        .catch((error: unknown) => {
          if (active) setModalError(error instanceof Error ? error.message : "Modal durum alınamadı.");
        });
    }, 2_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [activeModalJobId, activeModalState, token]);

  const persistToken = (): string | null => {
    const trimmed = token.trim();
    try {
      if (trimmed) window.sessionStorage.setItem(ANSYS_BRIDGE_TOKEN_STORAGE_KEY, trimmed);
      else window.sessionStorage.removeItem(ANSYS_BRIDGE_TOKEN_STORAGE_KEY);
    } catch {
      setState({ kind: "error", message: "Token bu tarayıcı oturumunda saklanamadı." });
      return null;
    }
    return trimmed;
  };

  const connectBridge = () => {
    const saved = persistToken();
    if (saved !== null) void checkBridge(saved);
  };

  const testConnection = () => {
    const saved = persistToken();
    if (saved === null) return;
    setState({ kind: "checking" });
    void testRealAnsysConnection(ANSYS_BRIDGE_URL, saved).then(setState);
  };

  const launchConnection = () => {
    const saved = persistToken();
    if (saved === null) return;
    setState({ kind: "checking" });
    void launchRealAnsysConnection(ANSYS_BRIDGE_URL, saved).then(setState);
  };

  const clearToken = () => {
    setToken("");
    try {
      window.sessionStorage.removeItem(ANSYS_BRIDGE_TOKEN_STORAGE_KEY);
    } catch {
      // Connection can still be checked without persistence.
    }
    void checkBridge("");
  };

  const studioContext = () => {
    if (!studioTransferEnabled) return undefined;
    const origin = parseVector3(cadOriginText, "CAD orijini (araç metre)");
    const anchors = Object.fromEntries(CAD_ANCHOR_IDS.map((id) => [
      id, parseVector3(cadAnchorTexts[id] ?? "", `${id} CAD anchor (mm)`),
    ]));
    return buildStudioTransfer(project, cadAxes, origin, anchors);
  };

  const loadAcceptedWrench = () => {
    setAnalysisError(null);
    if (!studioTransferEnabled) {
      setAnalysisError("Studio kuvvetini CAD eksenlerine çevirmek için CAD koordinat kaydını etkinleştirin.");
      return;
    }
    if (!latestAnsysWrench || latestAnsysWrench.projectId !== project.projectId
      || latestAnsysWrench.projectUpdatedAt !== project.updatedAt
      || latestAnsysWrench.cornerId !== project.activeCornerId) {
      setAnalysisError("Bu köşe ve proje revizyonu için kabul edilmiş quasi-static yük girdisi yok.");
      return;
    }
    if (Object.values(latestAnsysWrench.momentNm).some((value) => Math.abs(value) > 1e-9)) {
      setAnalysisError("Quasi-static girdi moment içeriyor; mevcut Static Structural yüzey kuvveti momenti aktaramaz.");
      return;
    }
    const magnitude = Math.hypot(...Object.values(latestAnsysWrench.forceN));
    if (!Number.isFinite(magnitude) || magnitude <= 0 || magnitude > 1_000_000) {
      setAnalysisError("Aktarılacak kuvvet vektörü geçersiz veya sınır dışında.");
      return;
    }
    setImportedWrench(latestAnsysWrench);
    setForceN(String(magnitude));
  };

  const runAnalysis = () => {
    const saved = persistToken();
    if (!saved) return;
    setAnalysisError(null);
    setAnalysisJob(null);
    let transfer;
    try {
      transfer = studioContext();
      if (importedWrench && !transfer) {
        throw new Error("Studio kuvveti için CAD koordinat kaydı gerekli.");
      }
      if (importedWrench && (importedWrench.projectUpdatedAt !== project.updatedAt
        || importedWrench.cornerId !== project.activeCornerId)) {
        throw new Error("Studio yükü proje/köşe değişikliği nedeniyle eskidi; yeniden içe aktarın.");
      }
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Studio aktarımı geçersiz.");
      return;
    }
    void startStaticStructural(ANSYS_BRIDGE_URL, saved, {
      geometryPath: geometryPath.trim(),
      material: "Structural Steel",
      fixedNamedSelection: fixedName.trim(),
      forceNamedSelection: forceName.trim(),
      forceAxis,
      forceN: Number(forceN),
      ...(importedWrench ? {
        forceComponentsN: vehicleVectorToCad(importedWrench.forceN, cadAxes),
        forceInputSha256: importedWrench.inputSha256,
      } : {}),
      meshSizeMm: Number(meshSizeMm),
      ...(transfer ? { studioTransfer: transfer } : {}),
      ...(meshStudy ? {
        meshConvergenceSizesMm: [
          Number(meshSizeMm) * 1.6,
          Number(meshSizeMm) * 1.25,
          Number(meshSizeMm),
        ] as [number, number, number],
      } : {}),
    }).then(setAnalysisJob).catch((error: unknown) => {
      setAnalysisError(error instanceof Error ? error.message : "Analiz başlatılamadı.");
    });
  };

  const runModal = () => {
    const saved = persistToken();
    if (!saved) return;
    setModalError(null);
    setModalJob(null);
    let transfer;
    try {
      transfer = studioContext();
    } catch (error) {
      setModalError(error instanceof Error ? error.message : "Studio aktarımı geçersiz.");
      return;
    }
    void startModalAnalysis(ANSYS_BRIDGE_URL, saved, {
      geometryPath: geometryPath.trim(),
      material: "Structural Steel",
      fixedNamedSelection: fixedName.trim(),
      meshSizeMm: Number(meshSizeMm),
      modeCount: Number(modeCount),
      ...(transfer ? { studioTransfer: transfer } : {}),
    }).then(setModalJob).catch((error: unknown) => {
      setModalError(error instanceof Error ? error.message : "Modal analiz başlatılamadı.");
    });
  };

  const status = statusFrom(state);
  const verified = state.kind === "connection_verified";
  const selected = status?.adapter.installation.selected;
  const connection = status?.adapter.connection;
  const canTest = status?.adapter.state === "READY_FOR_CONNECTION_TEST" && state.kind !== "checking";
  const canLaunch = canTest && !verified;
  const canAnalyze = verified && connection?.startedByBridge === true
    && geometryPath.trim().length > 0 && fixedName.trim().length > 0
    && forceName.trim().length > 0 && Number.isFinite(Number(forceN))
    && Number(forceN) !== 0 && Number.isFinite(Number(meshSizeMm))
    && Number(meshSizeMm) > 0 && analysisJob?.state !== "QUEUED"
    && (!meshStudy || (Number(meshSizeMm) >= 0.1 && Number(meshSizeMm) * 1.6 <= 1_000))
    && analysisJob?.state !== "RUNNING"
    && modalJob?.state !== "QUEUED" && modalJob?.state !== "RUNNING";
  const canModal = verified && connection?.startedByBridge === true
    && geometryPath.trim().length > 0 && fixedName.trim().length > 0
    && Number.isFinite(Number(meshSizeMm)) && Number(meshSizeMm) >= 0.1
    && Number(meshSizeMm) <= 1000 && Number.isInteger(Number(modeCount))
    && Number(modeCount) >= 1 && Number(modeCount) <= 6
    && modalJob?.state !== "QUEUED" && modalJob?.state !== "RUNNING"
    && analysisJob?.state !== "QUEUED" && analysisJob?.state !== "RUNNING";
  const message = "message" in state ? state.message : undefined;

  return (
    <div className="ansys-connection">
      <button
        type="button"
        className={`ansys-trigger ${state.kind}`}
        aria-expanded={open}
        aria-controls="ansys-connection-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <Cpu size={13} />
        <span>ANSYS YEREL</span>
        <i />
      </button>
      {open && (
        <section id="ansys-connection-panel" className="ansys-panel" aria-label="ANSYS yerel bağlantı durumu">
          <header>
            <div><span className="eyebrow">YALNIZCA BU BİLGİSAYAR · PHASE 5</span><h2>ANSYS Yerel Köprüsü</h2></div>
            <button type="button" aria-label="Paneli kapat" onClick={() => setOpen(false)}><X size={16} /></button>
          </header>

          <div className={`ansys-panel-state ${verified ? "ready" : state.kind}`} role="status">
            {verified ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <div><strong>{labels[state.kind]}</strong><span>{message ?? "Yerel servis denetleniyor…"}</span></div>
          </div>

          <dl className="ansys-connection-details">
            <div><dt>Köprü</dt><dd>{status ? `v${status.version} · WNUA` : ANSYS_BRIDGE_URL}</dd></div>
            <div><dt>Windows kurulumu</dt><dd>{selected ? `${selected.release} · ${selected.productKind === "student" ? "Student" : "Diğer"}` : status ? "Bulunamadı" : "—"}</dd></div>
            {selected && <div><dt>Çalıştırılabilir dosya</dt><dd title={selected.executablePath}>{selected.executablePath}</dd></div>}
            <div><dt>PyMechanical</dt><dd>{status ? `${status.adapter.compatibility.pymechanicalVersion ?? "yok"} · ${compatibilityLabels[status.adapter.compatibility.state]}` : "—"}</dd></div>
            <div><dt>Gerçek Mechanical</dt><dd>{connection ? connectionLabels[connection.state] : "—"}</dd></div>
            <div><dt>Lisans</dt><dd>{connection?.licenseVerified ? "Aktif ve yazılabilir" : "Doğrulanmadı"}</dd></div>
            <div><dt>Başlatma</dt><dd>{connection?.startedByBridge ? "Açık yoldan yerel bridge" : "Harici veya başlatılmadı"}</dd></div>
            <div><dt>gRPC hedefi</dt><dd>{connection ? `${connection.host}:${connection.port}` : "127.0.0.1:10000"}</dd></div>
            <div><dt>Simülasyon</dt><dd>Yalnızca açık kullanıcı eylemiyle</dd></div>
          </dl>

          {connection && connection.state !== "NOT_TESTED" && (
            <p className={`ansys-test-result ${verified ? "verified" : "failed"}`}>
              <strong>{connectionLabels[connection.state]}</strong>
              <span>{connection.message}</span>
              {connection.checkedAt && <small>{new Date(connection.checkedAt).toLocaleString("tr-TR")}</small>}
              {connection.productInfo && <small>{connection.productInfo}</small>}
            </p>
          )}

          <label className="ansys-token-field">
            <span><KeyRound size={12} /> Oturum tokenı</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              placeholder="Bridge konsolundaki token"
              onChange={(event) => setToken(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") connectBridge(); }}
            />
          </label>
          <div className="ansys-panel-actions">
            <button type="button" onClick={connectBridge} disabled={state.kind === "checking"}><RefreshCw size={13} /> Durumu yenile</button>
            <button type="button" onClick={launchConnection} disabled={!canLaunch}><Power size={13} /> Mechanical'ı başlat</button>
            <button type="button" onClick={testConnection} disabled={!canTest}><PlugZap size={13} /> Gerçek bağlantıyı test et</button>
            <button type="button" onClick={clearToken}>Tokenı unut</button>
          </div>

          <section className="ansys-analysis" aria-label="Static Structural analizi">
            <h3>Static Structural · yerel analiz</h3>
            <p>CAD dosyası bu bilgisayarda kalır. Görsel GLB modeller katı analiz CAD’i değildir. Mesnet ve kuvvet yüzeyleri CAD içindeki farklı named selection’lar olmalıdır.</p>
            <label>CAD yolu (.agdb, .pmdb, .step, .stp)
              <input value={geometryPath} onChange={(event) => setGeometryPath(event.target.value)} placeholder="C:\\…\\ornek.agdb" />
            </label>
            <div className="ansys-analysis-grid">
              <label>Sabit mesnet seçimi<input value={fixedName} onChange={(event) => setFixedName(event.target.value)} placeholder="NS_FIXED" /></label>
              <label>Kuvvet yüzeyi seçimi<input value={forceName} onChange={(event) => setForceName(event.target.value)} placeholder="NS_FORCE" /></label>
              <label>Kuvvet ekseni<select value={forceAxis} disabled={!!importedWrench} onChange={(event) => setForceAxis(event.target.value as "X" | "Y" | "Z")}><option>X</option><option>Y</option><option>Z</option></select></label>
              <label>{importedWrench ? "Vektör büyüklüğü (N)" : "Kuvvet (N)"}<input type="number" value={forceN} readOnly={!!importedWrench} onChange={(event) => setForceN(event.target.value)} /></label>
              <label>Mesh boyutu (mm)<input type="number" min="0.1" value={meshSizeMm} onChange={(event) => setMeshSizeMm(event.target.value)} /></label>
              <label>Malzeme<input value="Structural Steel (ANSYS kütüphane varsayımı)" readOnly /></label>
            </div>
            <div className="ansys-panel-actions">
              <button type="button" onClick={loadAcceptedWrench}>Quasi-static dış kuvvet girdisini al</button>
              {importedWrench && <button type="button" onClick={() => setImportedWrench(null)}>Vektörü kaldır</button>}
            </div>
            {importedWrench && <p>Studio vektörü: ({importedWrench.forceN.x}, {importedWrench.forceN.y}, {importedWrench.forceN.z}) N · {importedWrench.sourceLabel}. Beyan edilen CAD eksenlerine döndürülerek yüzey named selection’ına uygulanır; uygulama noktası CAD’de doğrulanmadı.</p>}
            <label><input type="checkbox" checked={studioTransferEnabled} onChange={(event) => setStudioTransferEnabled(event.target.checked)} />Studio köşe/hardpoint bağlamını ekle</label>
            {studioTransferEnabled && <div className="ansys-studio-transfer">
              <strong>CAD koordinat kaydı · {project.vehicle.corners[project.activeCornerId].label}</strong>
              <p>Studio: +X ileri, +Y sol, +Z yukarı; metre. CAD: mm. CAD’de bağımsız ölçülmüş üç anchor girilmeden kayıt kabul edilmez. Bu eşleşme CAD topolojisini veya malzemeyi doğrulamaz.</p>
              <div className="ansys-analysis-grid">
                {([0, 1, 2] as const).map((index) => <label key={index}>CAD {"XYZ"[index]} ekseninin araç yönü
                  <select value={cadAxes[index]} onChange={(event) => setCadAxes((previous) => {
                    const next = [...previous] as [SignedAxis, SignedAxis, SignedAxis];
                    next[index] = event.target.value as SignedAxis;
                    return next;
                  })}>
                    {["+X", "-X", "+Y", "-Y", "+Z", "-Z"].map((axis) => <option key={axis}>{axis}</option>)}
                  </select>
                </label>)}
                <label>CAD orijini (araç x,y,z metre)
                  <input value={cadOriginText} onChange={(event) => setCadOriginText(event.target.value)} placeholder="0, 0, 0" />
                </label>
              </div>
              <p>Sağ elli dönüşüm: {frameDeterminant(cadAxes) === 1 ? "evet" : "hayır · analiz engellenir"}.</p>
              {CAD_ANCHOR_IDS.map((id) => {
                const point = project.suspension.hardpoints.find((item) => item.id === id)?.position;
                let expected = "—";
                try {
                  if (point) {
                    const value = vehicleToCadMm(point, parseVector3(cadOriginText, "orijin"), cadAxes);
                    expected = `${value.x.toFixed(2)}, ${value.y.toFixed(2)}, ${value.z.toFixed(2)} mm`;
                  }
                } catch { /* Invalid frame is shown above and rejected on submit. */ }
                return <label key={id}>{id} · dönüştürülmüş Studio: {expected}
                  <input value={cadAnchorTexts[id] ?? ""} onChange={(event) => setCadAnchorTexts((previous) => ({ ...previous, [id]: event.target.value }))} placeholder="CAD anchor x, y, z (mm)" />
                </label>;
              })}
            </div>}
            <label>
              <input type="checkbox" checked={meshStudy} onChange={(event) => setMeshStudy(event.target.checked)} />
              Üç kademeli mesh yakınsama taraması (1,6× / 1,25× / 1×; üç gerçek çözüm)
            </label>
            <p>Direct/Sparse çözücü ve eleman şekli denetimi istenir. %5 fark yalnızca seçilen küresel sonuçlar için sayısal taramadır; fiziksel onay değildir.</p>
            <button type="button" onClick={runAnalysis} disabled={!canAnalyze}>Analizi açıkça başlat</button>
            {analysisError && <p className="ansys-analysis-error" role="alert">{analysisError}</p>}
            {analysisJob && (
              <div className="ansys-analysis-result" role="status">
                <strong>{analysisJob.state} · {analysisJob.stage}</strong>
                <span>{analysisJob.message}</span>
                {analysisJob.errorCode && <small>Hata kodu: {analysisJob.errorCode}</small>}
                {analysisJob.result && <dl>
                  <div><dt>Maks. von Mises</dt><dd>{(analysisJob.result.maximumVonMisesStressPa / 1e6).toPrecision(5)} MPa</dd></div>
                  <div><dt>Maks. deformasyon</dt><dd>{(analysisJob.result.maximumTotalDeformationM * 1e3).toPrecision(5)} mm</dd></div>
                  <div><dt>Çözücü</dt><dd>{analysisJob.result.solverStatus}</dd></div>
                  <div><dt>Mesh</dt><dd>{analysisJob.result.meshNodes} düğüm · {analysisJob.result.meshElements} eleman</dd></div>
                  <div><dt>Eleman kalitesi</dt><dd>{analysisJob.result.meshQuality?.status === "MEASURED_BY_MECHANICAL" ? `min ${analysisJob.result.meshQuality.minimum?.toPrecision(3)} · ort ${analysisJob.result.meshQuality.average?.toPrecision(3)}` : "ölçülemedi"}</dd></div>
                  <div><dt>Şekil denetimi</dt><dd>{analysisJob.result.shapeCheckInSolverInput ? "APDL girdisinde var" : "Doğrulanamadı"}</dd></div>
                </dl>}
                {analysisJob.result && <small>Sayısal sonuç; fiziksel olarak doğrulanmamıştır. CAD SHA-256: {analysisJob.result.geometrySha256}</small>}
                {analysisJob.result && <small>Gerilme ve deformasyon yalnızca Mechanical’dan okunan küresel maksimumlardır; alan konturu veya parça bazlı dağılım aktarılmadı.</small>}
                {analysisJob.result?.studioTransfer && <small>Studio aktarımı: {analysisJob.result.studioTransfer.cornerId} · {analysisJob.result.studioTransfer.status} · beyan edilen anchor artığı {analysisJob.result.studioTransfer.maxDeclaredAnchorResidualMm.toPrecision(3)} mm. CAD topolojisi doğrulanmadı.</small>}
                {analysisJob.result?.meshConvergence && (
                  <div className="ansys-result-warnings" role="note" aria-label="Mesh yakınsama değerlendirmesi">
                    <strong>Mesh yakınsaması: {analysisJob.result.meshConvergence.status === "PASSED_NUMERICALLY" ? "sayısal ölçüt karşılandı" : "yakınsama gösterilemedi"}</strong>
                    <p>Kaba → orta / orta → ince farkları: gerilme %{(analysisJob.result.meshConvergence.coarseToMediumStressChangeRelative * 100).toPrecision(3)} / %{(analysisJob.result.meshConvergence.stressChangeRelative * 100).toPrecision(3)}; deformasyon %{(analysisJob.result.meshConvergence.coarseToMediumDeformationChangeRelative * 100).toPrecision(3)} / %{(analysisJob.result.meshConvergence.deformationChangeRelative * 100).toPrecision(3)}. Son farklar azalmalı ve %{(analysisJob.result.meshConvergence.toleranceRelative * 100).toPrecision(3)} sınırının altında kalmalı. Eleman/düğüm sayısı artışı: {analysisJob.result.meshConvergence.meshCountsIncrease ? "evet" : "hayır"}.</p>
                    <ul>{analysisJob.result.meshConvergence.points.map((point) => (
                      <li key={point.meshSizeMm}>{point.meshSizeMm} mm · {point.meshNodes} düğüm · {point.meshElements} eleman · {(point.maximumVonMisesStressPa / 1e6).toPrecision(5)} MPa · {(point.maximumTotalDeformationM * 1e3).toPrecision(5)} mm</li>
                    ))}</ul>
                  </div>
                )}
                {analysisJob.result && analysisJob.result.warnings.length > 0 && (
                  <div className="ansys-result-warnings" role="note" aria-label="Analiz uyarıları">
                    <strong>Mühendislik uyarıları</strong>
                    <ul>{analysisJob.result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="ansys-analysis" aria-label="Modal analiz">
            <h3>Modal Analysis · doğal frekanslar</h3>
            <p>Yukarıdaki yerel katı CAD, sabit mesnet, malzeme ve mesh boyutu kullanılır. Static Structural kuvveti modal analize taşınmaz. Modal şekil ölçeği fiziksel deformasyon değildir.</p>
            <label>İstenen mod sayısı (1–6)<input type="number" min="1" max="6" step="1" value={modeCount} onChange={(event) => setModeCount(event.target.value)} /></label>
            <button type="button" onClick={runModal} disabled={!canModal}>Modal analizi açıkça başlat</button>
            {modalError && <p className="ansys-analysis-error" role="alert">{modalError}</p>}
            {modalJob && <div className="ansys-analysis-result" role="status">
              <strong>{modalJob.state} · {modalJob.stage}</strong>
              <span>{modalJob.message}</span>
              {modalJob.errorCode && <small>Hata kodu: {modalJob.errorCode}</small>}
              {modalJob.result && <>
                <small>Sayısal modal sonuç; fiziksel olarak doğrulanmamıştır. Mesh yakınsaması değerlendirilmedi.</small>
                <dl>
                  <div><dt>Mesh</dt><dd>{modalJob.result.meshNodes} düğüm · {modalJob.result.meshElements} eleman</dd></div>
                  <div><dt>Eleman kalitesi</dt><dd>{modalJob.result.meshQuality.status === "MEASURED_BY_MECHANICAL" ? `min ${modalJob.result.meshQuality.minimum?.toPrecision(3)} · ort ${modalJob.result.meshQuality.average?.toPrecision(3)}` : "ölçülemedi"}</dd></div>
                  <div><dt>Şekil denetimi</dt><dd>{modalJob.result.shapeCheckInSolverInput ? "APDL girdisinde var" : "Doğrulanamadı"}</dd></div>
                </dl>
                <div className="ansys-frequency-chart" aria-label="Doğal frekanslar">
                  {modalJob.result.modes.map((mode) => <div key={mode.modeNumber}>
                    <span>Mod {mode.modeNumber}</span>
                    <i style={{ width: `${100 * mode.frequencyHz / modalJob.result!.modes.at(-1)!.frequencyHz}%` }} />
                    <b>{mode.frequencyHz.toPrecision(6)} Hz</b>
                  </div>)}
                </div>
                {modalJob.result.studioTransfer && <small>Studio köşesi: {modalJob.result.studioTransfer.cornerId} · beyan edilmiş CAD anchor kaydı; topoloji doğrulanmadı.</small>}
                <div className="ansys-result-warnings" role="note" aria-label="Modal mühendislik uyarıları">
                  <strong>Modal uyarılar</strong>
                  <ul>{modalJob.result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                </div>
              </>}
            </div>}
          </section>

          <p className="ansys-security-note">
            Başlatma yalnızca kullanıcı düğmeye bastığında, keşfedilmiş <code>AnsysWBU.exe</code> ve sürümlü
            <code> AWP_ROOT</code> ile yapılır. WNUA, normal ANSYS lisans kontrolü ve Student limitleri korunur;
            analiz yalnızca yukarıdaki düğmeyle başlatılır. Token ve CAD dosyası Vercel’e gönderilmez.
          </p>
        </section>
      )}
    </div>
  );
}
