import { AlertTriangle, CheckCircle2, Cpu, KeyRound, PlugZap, Power, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";

import {
  ANSYS_BRIDGE_TOKEN_STORAGE_KEY,
  ANSYS_BRIDGE_URL,
  launchRealAnsysConnection,
  probeAnsysBridge,
  readStaticStructural,
  startStaticStructural,
  testRealAnsysConnection,
  type AnsysBridgeStatus,
  type AnsysConnectionState,
  type CompatibilityState,
  type ConnectionTestState,
  type StaticStructuralJob,
} from "../lib/ansysBridge";

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
  const [analysisJob, setAnalysisJob] = useState<StaticStructuralJob | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const activeJobId = analysisJob?.jobId;
  const activeJobState = analysisJob?.state;

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

  const runAnalysis = () => {
    const saved = persistToken();
    if (!saved) return;
    setAnalysisError(null);
    setAnalysisJob(null);
    void startStaticStructural(ANSYS_BRIDGE_URL, saved, {
      geometryPath: geometryPath.trim(),
      material: "Structural Steel",
      fixedNamedSelection: fixedName.trim(),
      forceNamedSelection: forceName.trim(),
      forceAxis,
      forceN: Number(forceN),
      meshSizeMm: Number(meshSizeMm),
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
    && analysisJob?.state !== "RUNNING";
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
            <div><span className="eyebrow">YALNIZCA BU BİLGİSAYAR · PHASE 4</span><h2>ANSYS Yerel Köprüsü</h2></div>
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
            <p>CAD dosyası bu bilgisayarda kalır. Mesnet ve kuvvet yüzeyleri CAD içindeki farklı named selection’lar olmalıdır.</p>
            <label>CAD yolu (.agdb, .pmdb, .step, .stp)
              <input value={geometryPath} onChange={(event) => setGeometryPath(event.target.value)} placeholder="C:\\…\\ornek.agdb" />
            </label>
            <div className="ansys-analysis-grid">
              <label>Sabit mesnet seçimi<input value={fixedName} onChange={(event) => setFixedName(event.target.value)} placeholder="NS_FIXED" /></label>
              <label>Kuvvet yüzeyi seçimi<input value={forceName} onChange={(event) => setForceName(event.target.value)} placeholder="NS_FORCE" /></label>
              <label>Kuvvet ekseni<select value={forceAxis} onChange={(event) => setForceAxis(event.target.value as "X" | "Y" | "Z")}><option>X</option><option>Y</option><option>Z</option></select></label>
              <label>Kuvvet (N)<input type="number" value={forceN} onChange={(event) => setForceN(event.target.value)} /></label>
              <label>Mesh boyutu (mm)<input type="number" min="0.1" value={meshSizeMm} onChange={(event) => setMeshSizeMm(event.target.value)} /></label>
              <label>Malzeme<input value="Structural Steel" readOnly /></label>
            </div>
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
                  <div><dt>Şekil denetimi</dt><dd>{analysisJob.result.shapeCheckInSolverInput ? "APDL girdisinde var" : "Doğrulanamadı"}</dd></div>
                </dl>}
                {analysisJob.result && <small>Sayısal sonuç; fiziksel olarak doğrulanmamıştır. CAD SHA-256: {analysisJob.result.geometrySha256}</small>}
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
