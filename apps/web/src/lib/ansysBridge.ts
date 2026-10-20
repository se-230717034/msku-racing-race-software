export const ANSYS_BRIDGE_URL = "http://127.0.0.1:8765";
export const ANSYS_BRIDGE_TOKEN_STORAGE_KEY = "msku.ansysBridge.token";

export interface AnsysBridgeLiveHealth {
  status: "ok";
  service: "msku-ansys-local-bridge";
  version: string;
  scope: "localhost_only";
  tokenConfigured: boolean;
}

export interface AnsysBridgeStatus {
  status: "ready";
  service: "msku-ansys-local-bridge";
  version: string;
  transport: "localhost_token";
  adapter: {
    adapter: "mock";
    state: "MOCK_READY";
    ansysConnected: false;
    simulationsEnabled: false;
    capabilities: string[];
    message: string;
  };
  warnings: string[];
}

export type AnsysConnectionState =
  | { kind: "checking" }
  | { kind: "offline"; message: string }
  | { kind: "token_required"; version: string; message: string }
  | { kind: "unconfigured"; message: string }
  | { kind: "unauthorized"; message: string }
  | { kind: "mock_ready"; status: AnsysBridgeStatus }
  | { kind: "error"; message: string };

export function normalizeLoopbackBridgeUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Geçerli bir yerel köprü adresi girilmedi.");
  }
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (url.protocol !== "http:" || !loopbackHosts.has(url.hostname)) {
    throw new Error("ANSYS köprüsü yalnızca HTTP loopback adresinde çalışabilir.");
  }
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new Error("Köprü adresi kimlik bilgisi, sorgu veya ek yol içeremez.");
  }
  return url.origin;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 2_500);
  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function probeAnsysBridge(
  baseUrl: string,
  token: string,
): Promise<AnsysConnectionState> {
  let normalized: string;
  try {
    normalized = normalizeLoopbackBridgeUrl(baseUrl);
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : "Geçersiz adres." };
  }

  try {
    const liveResponse = await fetchWithTimeout(`${normalized}/bridge/v1/health/live`);
    if (!liveResponse.ok) {
      return { kind: "offline", message: `Yerel köprü HTTP ${liveResponse.status} döndürdü.` };
    }
    const live = await liveResponse.json() as AnsysBridgeLiveHealth;
    if (live.service !== "msku-ansys-local-bridge" || live.scope !== "localhost_only") {
      return { kind: "error", message: "Yanıt beklenen MSKU yerel köprüsüne ait değil." };
    }
    if (!live.tokenConfigured) {
      return { kind: "unconfigured", message: "Yerel köprü güvenlik tokenı olmadan başlatılmış." };
    }
    if (!token.trim()) {
      return {
        kind: "token_required",
        version: live.version,
        message: "Konsolda gösterilen oturum tokenını girin.",
      };
    }

    const statusResponse = await fetchWithTimeout(`${normalized}/bridge/v1/status`, {
      headers: { "X-MSKU-Bridge-Token": token.trim() },
    });
    if (statusResponse.status === 401) {
      return { kind: "unauthorized", message: "Token geçersiz veya bu bridge oturumuna ait değil." };
    }
    if (statusResponse.status === 503) {
      return { kind: "unconfigured", message: "Yerel köprü güvenli kullanıma hazır değil." };
    }
    if (!statusResponse.ok) {
      return { kind: "error", message: `Durum sorgusu HTTP ${statusResponse.status} döndürdü.` };
    }
    const status = await statusResponse.json() as AnsysBridgeStatus;
    if (
      status.service !== "msku-ansys-local-bridge"
      || status.transport !== "localhost_token"
      || status.adapter?.adapter !== "mock"
      || status.adapter.state !== "MOCK_READY"
      || status.adapter.ansysConnected !== false
      || status.adapter.simulationsEnabled !== false
    ) {
      return { kind: "error", message: "Köprü yanıtı Phase 1 güvenlik sözleşmesiyle uyuşmuyor." };
    }
    return { kind: "mock_ready", status };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return {
      kind: "offline",
      message: timedOut
        ? "Yerel köprü zaman aşımına uğradı."
        : "Yerel köprüye ulaşılamadı; bilgisayarınızda çalıştığını kontrol edin.",
    };
  }
}
