import { AlertTriangle, CheckCircle2, Cpu, KeyRound, PlugZap, Power, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";

import {
  ANSYS_BRIDGE_TOKEN_STORAGE_KEY,
  ANSYS_BRIDGE_URL,
  launchRealAnsysConnection,
  probeAnsysBridge,
  testRealAnsysConnection,
  type AnsysBridgeStatus,
  type AnsysConnectionState,
  type CompatibilityState,
  type ConnectionTestState,
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

  const status = statusFrom(state);
  const verified = state.kind === "connection_verified";
  const selected = status?.adapter.installation.selected;
  const connection = status?.adapter.connection;
  const canTest = status?.adapter.state === "READY_FOR_CONNECTION_TEST" && state.kind !== "checking";
  const canLaunch = canTest && !verified;
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
            <div><span className="eyebrow">YALNIZCA BU BİLGİSAYAR · PHASE 2</span><h2>ANSYS Yerel Köprüsü</h2></div>
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
            <div><dt>Simülasyon</dt><dd>Devre dışı</dd></div>
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

          <p className="ansys-security-note">
            Başlatma yalnızca kullanıcı düğmeye bastığında, keşfedilmiş <code>AnsysWBU.exe</code> ve sürümlü
            <code> AWP_ROOT</code> ile yapılır. WNUA, normal ANSYS lisans kontrolü ve Student limitleri korunur;
            analiz çalıştırılmaz. Token Vercel’e gönderilmez.
          </p>
        </section>
      )}
    </div>
  );
}
