import { AlertTriangle, CheckCircle2, Cpu, KeyRound, PlugZap, X } from "lucide-react";
import { useEffect, useState } from "react";

import {
  ANSYS_BRIDGE_TOKEN_STORAGE_KEY,
  ANSYS_BRIDGE_URL,
  probeAnsysBridge,
  type AnsysConnectionState,
} from "../lib/ansysBridge";

const labels: Record<AnsysConnectionState["kind"], string> = {
  checking: "kontrol ediliyor",
  offline: "çevrimdışı",
  token_required: "token gerekli",
  unconfigured: "güvensiz yapılandırma",
  unauthorized: "yetki reddedildi",
  mock_ready: "mock hazır",
  error: "hata",
};

function initialToken(): string {
  try {
    return window.sessionStorage.getItem(ANSYS_BRIDGE_TOKEN_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function AnsysConnectionPanel() {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState(initialToken);
  const [state, setState] = useState<AnsysConnectionState>({ kind: "checking" });

  const checkConnection = async (candidateToken: string) => {
    setState({ kind: "checking" });
    setState(await probeAnsysBridge(ANSYS_BRIDGE_URL, candidateToken));
  };

  useEffect(() => {
    let active = true;
    void probeAnsysBridge(ANSYS_BRIDGE_URL, initialToken()).then((nextState) => {
      if (active) setState(nextState);
    });
    return () => { active = false; };
  }, []); // Probe once; repeated checks are explicit so the local service is never polled silently.

  const connect = () => {
    const trimmed = token.trim();
    try {
      if (trimmed) window.sessionStorage.setItem(ANSYS_BRIDGE_TOKEN_STORAGE_KEY, trimmed);
      else window.sessionStorage.removeItem(ANSYS_BRIDGE_TOKEN_STORAGE_KEY);
    } catch {
      setState({ kind: "error", message: "Token bu tarayıcı oturumunda saklanamadı." });
      return;
    }
    void checkConnection(trimmed);
  };

  const clearToken = () => {
    setToken("");
    try {
      window.sessionStorage.removeItem(ANSYS_BRIDGE_TOKEN_STORAGE_KEY);
    } catch {
      // Connection can still be checked without persistence.
    }
    void checkConnection("");
  };

  const ready = state.kind === "mock_ready";
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
            <div><span className="eyebrow">YALNIZCA BU BİLGİSAYAR</span><h2>ANSYS Yerel Köprüsü</h2></div>
            <button type="button" aria-label="Paneli kapat" onClick={() => setOpen(false)}><X size={16} /></button>
          </header>

          <div className={`ansys-panel-state ${ready ? "ready" : state.kind}`} role="status">
            {ready ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <div><strong>{labels[state.kind]}</strong><span>{message ?? "Yerel servis denetleniyor…"}</span></div>
          </div>

          <dl className="ansys-connection-details">
            <div><dt>Köprü adresi</dt><dd>{ANSYS_BRIDGE_URL}</dd></div>
            <div><dt>Adapter</dt><dd>{ready ? "Mock (Phase 1)" : "—"}</dd></div>
            <div><dt>Gerçek ANSYS</dt><dd>{ready ? "Bağlı değil" : "—"}</dd></div>
            <div><dt>Simülasyon</dt><dd>{ready ? "Devre dışı" : "—"}</dd></div>
            <div><dt>Sürüm</dt><dd>{ready ? state.status.version : state.kind === "token_required" ? state.version : "—"}</dd></div>
          </dl>

          <label className="ansys-token-field">
            <span><KeyRound size={12} /> Oturum tokenı</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              placeholder="Bridge konsolundaki token"
              onChange={(event) => setToken(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") connect(); }}
            />
          </label>
          <div className="ansys-panel-actions">
            <button type="button" onClick={connect} disabled={state.kind === "checking"}><PlugZap size={13} /> Bağlantıyı denetle</button>
            <button type="button" onClick={clearToken}>Tokenı unut</button>
          </div>

          <p className="ansys-security-note">
            Token yalnızca bu tarayıcı sekmesinde tutulur ve doğrudan <code>127.0.0.1</code> adresine gönderilir.
            Vercel ANSYS çalıştırmaz ve tokenı almaz. Bu fazda gerçek analiz endpoint’i yoktur.
          </p>
        </section>
      )}
    </div>
  );
}
