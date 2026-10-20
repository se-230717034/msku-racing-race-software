export const ANSYS_BRIDGE_URL = "http://127.0.0.1:8765";
export const ANSYS_BRIDGE_TOKEN_STORAGE_KEY = "msku.ansysBridge.token";

export interface AnsysBridgeLiveHealth {
  status: "ok";
  service: "msku-ansys-local-bridge";
  version: string;
  scope: "localhost_only";
  tokenConfigured: boolean;
}

export type InstallationState = "FOUND" | "NOT_FOUND" | "UNSUPPORTED_PLATFORM";
export type CompatibilityState =
  | "COMPATIBLE"
  | "NOT_EVALUATED"
  | "PYMECHANICAL_NOT_INSTALLED"
  | "MECHANICAL_VERSION_UNSUPPORTED"
  | "PYTHON_VERSION_UNSUPPORTED";
export type ConnectionTestState =
  | "NOT_TESTED"
  | "VERIFIED"
  | "TEST_IN_PROGRESS"
  | "LAUNCH_IN_PROGRESS"
  | "INSTALLATION_NOT_FOUND"
  | "INCOMPATIBLE"
  | "PROCESS_NOT_REACHABLE"
  | "PROCESS_START_FAILED"
  | "AUTHENTICATION_FAILED"
  | "LICENSE_ERROR"
  | "VERIFICATION_FAILED";

export interface AnsysInstallation {
  versionCode: number;
  release: string;
  productKind: "student" | "other";
  executablePath: string;
  source: string;
}

export interface AnsysConnectionTest {
  state: ConnectionTestState;
  processVerified: boolean;
  licenseVerified: boolean;
  startedByBridge: boolean;
  host: "127.0.0.1";
  port: number;
  checkedAt: string | null;
  mechanicalVersion: string | null;
  productInfo: string | null;
  errorCode: string | null;
  message: string;
}

export interface AnsysBridgeStatus {
  status: "ready";
  service: "msku-ansys-local-bridge";
  version: string;
  transport: "localhost_token_wnua";
  adapter: {
    adapter: "pymechanical";
    state: "READY_FOR_CONNECTION_TEST" | "INSTALLATION_NOT_FOUND" | "INCOMPATIBLE" | "UNSUPPORTED_PLATFORM";
    ansysConnected: boolean;
    simulationsEnabled: false;
    capabilities: string[];
    message: string;
    installation: {
      platform: string;
      state: InstallationState;
      selected: AnsysInstallation | null;
      installations: AnsysInstallation[];
      warnings: string[];
    };
    compatibility: {
      state: CompatibilityState;
      pymechanicalVersion: string | null;
      pythonVersion: string;
      minimumMechanicalVersionCode: number;
      message: string;
    };
    connection: AnsysConnectionTest;
  };
  warnings: string[];
}

export type AnsysConnectionState =
  | { kind: "checking" }
  | { kind: "offline"; message: string }
  | { kind: "token_required"; version: string; message: string }
  | { kind: "unconfigured"; message: string }
  | { kind: "unauthorized"; message: string }
  | { kind: "bridge_ready"; status: AnsysBridgeStatus; message: string }
  | { kind: "connection_verified"; status: AnsysBridgeStatus; message: string }
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

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMilliseconds = 2_500,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMilliseconds);
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

function validateStatus(status: AnsysBridgeStatus): string | null {
  if (
    status.service !== "msku-ansys-local-bridge"
    || status.transport !== "localhost_token_wnua"
    || status.adapter?.adapter !== "pymechanical"
    || status.adapter.simulationsEnabled !== false
  ) {
    return "Köprü yanıtı Phase 2 güvenlik sözleşmesiyle uyuşmuyor.";
  }
  const connection = status.adapter.connection;
  if (connection.state === "VERIFIED" && (
    connection.processVerified !== true
    || connection.licenseVerified !== true
    || status.adapter.ansysConnected !== true
    || !connection.mechanicalVersion
    || !connection.productInfo?.toLocaleLowerCase("en-US").includes("ansys mechanical")
  )) {
    return "Köprü, gerçek Mechanical proses kanıtı olmadan bağlantı başarısı bildirdi.";
  }
  if (connection.state !== "VERIFIED" && status.adapter.ansysConnected) {
    return "Köprü bağlantı durumu kendi doğrulama kaydıyla tutarsız.";
  }
  return null;
}

async function fetchBridgeStatus(
  normalized: string,
  token: string,
): Promise<AnsysConnectionState> {
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
  const contractError = validateStatus(status);
  if (contractError) return { kind: "error", message: contractError };
  if (status.adapter.connection.state === "VERIFIED") {
    return {
      kind: "connection_verified",
      status,
      message: "Gerçek Mechanical prosesi son bağlantı testinde doğrulandı.",
    };
  }
  return { kind: "bridge_ready", status, message: status.adapter.message };
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
    return await fetchBridgeStatus(normalized, token);
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

export async function testRealAnsysConnection(
  baseUrl: string,
  token: string,
): Promise<AnsysConnectionState> {
  let normalized: string;
  try {
    normalized = normalizeLoopbackBridgeUrl(baseUrl);
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : "Geçersiz adres." };
  }
  if (!token.trim()) {
    return { kind: "unauthorized", message: "Gerçek bağlantı testi için bridge tokenı gerekli." };
  }
  try {
    const response = await fetchWithTimeout(`${normalized}/bridge/v1/connection/test`, {
      method: "POST",
      headers: { "X-MSKU-Bridge-Token": token.trim() },
    }, 35_000);
    if (response.status === 401) {
      return { kind: "unauthorized", message: "Token geçersiz veya bu bridge oturumuna ait değil." };
    }
    if (!response.ok) {
      return { kind: "error", message: `Bağlantı testi HTTP ${response.status} döndürdü.` };
    }
    const result = await response.json() as AnsysConnectionTest;
    if (result.state === "VERIFIED" && (
      result.processVerified !== true
      || result.licenseVerified !== true
      || !result.mechanicalVersion
      || !result.productInfo?.toLocaleLowerCase("en-US").includes("ansys mechanical")
    )) {
      return { kind: "error", message: "Gerçek proses kanıtı eksik bağlantı yanıtı reddedildi." };
    }
    return await fetchBridgeStatus(normalized, token);
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return {
      kind: "offline",
      message: timedOut
        ? "Mechanical bağlantı testi zaman aşımına uğradı."
        : "Yerel bağlantı testi tamamlanamadı.",
    };
  }
}

export async function launchRealAnsysConnection(
  baseUrl: string,
  token: string,
): Promise<AnsysConnectionState> {
  let normalized: string;
  try {
    normalized = normalizeLoopbackBridgeUrl(baseUrl);
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : "Geçersiz adres." };
  }
  if (!token.trim()) {
    return { kind: "unauthorized", message: "Mechanical başlatmak için bridge tokenı gerekli." };
  }
  try {
    const response = await fetchWithTimeout(`${normalized}/bridge/v1/connection/launch`, {
      method: "POST",
      headers: { "X-MSKU-Bridge-Token": token.trim() },
    }, 210_000);
    if (response.status === 401) {
      return { kind: "unauthorized", message: "Token geçersiz veya bu bridge oturumuna ait değil." };
    }
    if (!response.ok) {
      return { kind: "error", message: `Mechanical başlatma HTTP ${response.status} döndürdü.` };
    }
    const result = await response.json() as AnsysConnectionTest;
    if (result.state === "VERIFIED" && (
      result.processVerified !== true
      || result.licenseVerified !== true
      || result.startedByBridge !== true
      || !result.mechanicalVersion
      || !result.productInfo?.toLocaleLowerCase("en-US").includes("ansys mechanical")
    )) {
      return { kind: "error", message: "Başlatılan prosesin bağlantı veya lisans kanıtı eksik." };
    }
    return await fetchBridgeStatus(normalized, token);
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return {
      kind: "offline",
      message: timedOut
        ? "Mechanical başlatma ve doğrulama işlemi zaman aşımına uğradı."
        : "Mechanical güvenli açık-yol başlatması tamamlanamadı.",
    };
  }
}
