import type { Vec3 } from "@msku/contracts";

import type { StudioTransferInput } from "./ansysStudioTransfer";

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

export interface StaticStructuralInput {
  geometryPath: string;
  material: "Structural Steel";
  fixedNamedSelection: string;
  forceNamedSelection: string;
  forceAxis: "X" | "Y" | "Z";
  forceN: number;
  forceComponentsN?: Vec3;
  forceInputSha256?: string;
  forceApplicationPointVehicleM?: Vec3;
  meshSizeMm: number;
  meshConvergenceSizesMm?: [number, number, number];
  studioTransfer?: StudioTransferInput;
}

export interface MeshQualityEvidence {
  status: "MEASURED_BY_MECHANICAL" | "UNAVAILABLE";
  metric: "ElementQuality";
  minimum: number | null;
  average: number | null;
  maximum: number | null;
}

export interface StudioTransferEvidence {
  projectId: string;
  cornerId: "front_left" | "front_right" | "rear_left" | "rear_right";
  dataClassification: "demonstration" | "team_private";
  geometrySource: "independent" | "mirrored_assumption" | "synthetic_demo";
  sourceLabel: string;
  hardpointsCadMm: Record<string, Vec3>;
  maxDeclaredAnchorResidualMm: number;
  status: "DECLARED_ANCHORS_MATCHED_NOT_CAD_VERIFIED";
}

export interface StaticStructuralJob {
  jobId: string;
  state: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  stage: "queued" | "importing" | "meshing" | "solving" | "extracting" | "done";
  message: string;
  startedAt: string;
  completedAt: string | null;
  errorCode: string | null;
  result: null | {
    solverStatus: string;
    maximumVonMisesStressPa: number;
    maximumTotalDeformationM: number;
    meshNodes: number;
    meshElements: number;
    geometrySha256: string;
    material: string;
    fixedNamedSelection: string;
    forceNamedSelection: string;
    forceAxis: "X" | "Y" | "Z";
    forceN: number;
    forceComponentsN?: Vec3 | null;
    forceInputSha256?: string | null;
    forceApplicationPointVehicleM?: Vec3 | null;
    resultFileBytes: number;
    bodyCount: number;
    fixedScopeEntityCount: number;
    forceScopeEntityCount: number;
    meshSizeMm: number;
    mechanicalVersion: string;
    productInfo: string;
    units: "SI";
    validationStatus: "NUMERIC_RESULT_UNVALIDATED_PHYSICALLY";
    shapeCheckInSolverInput: boolean;
    meshQuality?: MeshQualityEvidence;
    studioTransfer?: StudioTransferEvidence | null;
    meshConvergence: null | {
      status: "PASSED_NUMERICALLY" | "NOT_CONVERGED";
      toleranceRelative: number;
      coarseToMediumStressChangeRelative: number;
      coarseToMediumDeformationChangeRelative: number;
      stressChangeRelative: number;
      deformationChangeRelative: number;
      meshCountsIncrease: boolean;
      points: Array<{
        meshSizeMm: number;
        meshNodes: number;
        meshElements: number;
        maximumVonMisesStressPa: number;
        maximumTotalDeformationM: number;
        solverStatus: "Done";
        resultFileBytes: number;
        warnings: string[];
      }>;
    };
    warnings: string[];
  };
}

export interface ModalAnalysisInput {
  geometryPath: string;
  material: "Structural Steel";
  fixedNamedSelection: string;
  meshSizeMm: number;
  modeCount: number;
  studioTransfer?: StudioTransferInput;
}

export interface ModalAnalysisJob {
  jobId: string;
  state: StaticStructuralJob["state"];
  stage: StaticStructuralJob["stage"];
  message: string;
  startedAt: string;
  completedAt: string | null;
  errorCode: string | null;
  result: null | {
    solverStatus: "Done";
    modes: Array<{ modeNumber: number; frequencyHz: number }>;
    meshNodes: number;
    meshElements: number;
    resultFileBytes: number;
    bodyCount: number;
    fixedScopeEntityCount: number;
    meshSizeMm: number;
    meshQuality: MeshQualityEvidence;
    geometrySha256: string;
    material: string;
    fixedNamedSelection: string;
    mechanicalVersion: string;
    productInfo: string;
    shapeCheckInSolverInput: boolean;
    studioTransfer: StudioTransferEvidence | null;
    units: "SI";
    validationStatus: "NUMERIC_RESULT_UNVALIDATED_PHYSICALLY";
    meshConvergenceStatus: "NOT_ASSESSED";
    warnings: string[];
  };
}

export interface AnsysTechnicalReport {
  schemaVersion: "1.0";
  reportType: "LOCAL_ANSYS_NUMERICAL_EVIDENCE";
  analysisType: "STATIC_STRUCTURAL" | "MODAL";
  generatedAt: string;
  jobId: string;
  releaseReadiness: "BLOCKED";
  physicalValidation: "UNVERIFIED";
  approvedForEngineeringUse: false;
  inputProvenance: Record<string, unknown>;
  solverResult: Record<string, unknown>;
  checks: Array<{
    code: string;
    status: "VERIFIED" | "UNVERIFIED" | "BLOCKED";
    observation: string;
    limitation: string | null;
  }>;
  unresolvedItems: string[];
  warnings: string[];
}

export async function readAnsysTechnicalReport(
  baseUrl: string,
  token: string,
  analysis: "static-structural" | "modal",
  jobId: string,
): Promise<AnsysTechnicalReport> {
  if (!/^[a-f0-9-]{36}$/.test(jobId)) throw new Error("Geçersiz analiz iş kimliği.");
  if (!token.trim()) throw new Error("Teknik rapor için yerel köprü tokenı gerekli.");
  const normalized = normalizeLoopbackBridgeUrl(baseUrl);
  const response = await fetchWithTimeout(
    `${normalized}/bridge/v1/analyses/${analysis}/${jobId}/report`,
    { headers: { "X-MSKU-Bridge-Token": token.trim() } },
    12_000,
  );
  if (!response.ok) throw new Error(`Teknik rapor HTTP ${response.status} döndürdü.`);
  const report = await response.json() as AnsysTechnicalReport;
  if (report.schemaVersion !== "1.0"
    || report.reportType !== "LOCAL_ANSYS_NUMERICAL_EVIDENCE"
    || report.analysisType !== (analysis === "modal" ? "MODAL" : "STATIC_STRUCTURAL")
    || report.jobId !== jobId
    || report.releaseReadiness !== "BLOCKED"
    || report.physicalValidation !== "UNVERIFIED"
    || report.approvedForEngineeringUse !== false
    || !Array.isArray(report.checks)
    || !report.checks.every((check) => ["VERIFIED", "UNVERIFIED", "BLOCKED"].includes(check.status)
      && typeof check.observation === "string" && typeof check.code === "string")
    || !Array.isArray(report.unresolvedItems)
    || !Array.isArray(report.warnings)
    || Object.hasOwn(report.inputProvenance ?? {}, "geometryPath")) {
    throw new Error("Teknik raporun kanıt veya gizlilik sözleşmesi geçersiz.");
  }
  return report;
}

function validateStaticJob(job: StaticStructuralJob): StaticStructuralJob {
  if (!job.jobId || !["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"].includes(job.state)) {
    throw new Error("Mechanical analiz yanıtı geçersiz.");
  }
  if (job.state === "SUCCEEDED") {
    const result = job.result;
    if (
      !result || result.solverStatus.split(".").at(-1) !== "Done"
      || result.units !== "SI"
      || result.validationStatus !== "NUMERIC_RESULT_UNVALIDATED_PHYSICALLY"
      || !Number.isFinite(result.maximumVonMisesStressPa)
      || !Number.isFinite(result.maximumTotalDeformationM)
      || result.maximumVonMisesStressPa < 0
      || result.maximumTotalDeformationM < 0
      || result.meshNodes <= 0 || result.meshElements <= 0
      || result.resultFileBytes <= 0 || result.bodyCount <= 0
      || result.fixedScopeEntityCount <= 0 || result.forceScopeEntityCount <= 0
      || !/^[a-f0-9]{64}$/.test(result.geometrySha256)
      || !Array.isArray(result.warnings)
      || !result.warnings.every((warning) => typeof warning === "string")
      || !result.mechanicalVersion
      || !result.productInfo.toLocaleLowerCase("en-US").includes("ansys mechanical")
      || (result.meshConvergence != null && (
        !["PASSED_NUMERICALLY", "NOT_CONVERGED"].includes(result.meshConvergence.status)
        || !Number.isFinite(result.meshConvergence.coarseToMediumStressChangeRelative)
        || !Number.isFinite(result.meshConvergence.coarseToMediumDeformationChangeRelative)
        || !Number.isFinite(result.meshConvergence.stressChangeRelative)
        || !Number.isFinite(result.meshConvergence.deformationChangeRelative)
        || typeof result.meshConvergence.meshCountsIncrease !== "boolean"
        || result.meshConvergence.points.length !== 3
        || !result.meshConvergence.points.every((point) =>
          point.solverStatus === "Done" && point.meshNodes > 0 && point.meshElements > 0
          && point.resultFileBytes > 0
          && Number.isFinite(point.maximumVonMisesStressPa)
          && Number.isFinite(point.maximumTotalDeformationM)
          && point.maximumVonMisesStressPa >= 0 && point.maximumTotalDeformationM >= 0
          && Array.isArray(point.warnings)
        )
      ))
    ) throw new Error("Mechanical çözüm kanıtı veya sonuç birimleri eksik.");
  } else if (job.result !== null) {
    throw new Error("Tamamlanmamış analiz sonuç içeremez.");
  }
  return job;
}

async function staticRequest(url: string, token: string, init?: RequestInit): Promise<StaticStructuralJob> {
  const normalized = normalizeLoopbackBridgeUrl(url);
  if (!token.trim()) throw new Error("Analiz için yerel köprü tokenı gerekli.");
  const response = await fetchWithTimeout(`${normalized}/bridge/v1/analyses/static-structural`, {
    ...init,
    headers: { "X-MSKU-Bridge-Token": token.trim(), ...(init?.headers ?? {}) },
  }, 12_000);
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { detail?: { message?: string } } | null;
    throw new Error(error?.detail?.message ?? `Yerel analiz isteği HTTP ${response.status} döndürdü.`);
  }
  return validateStaticJob(await response.json() as StaticStructuralJob);
}

export async function startStaticStructural(
  baseUrl: string,
  token: string,
  input: StaticStructuralInput,
): Promise<StaticStructuralJob> {
  return staticRequest(baseUrl, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function readStaticStructural(
  baseUrl: string,
  token: string,
  jobId: string,
): Promise<StaticStructuralJob> {
  if (!/^[a-f0-9-]{36}$/.test(jobId)) throw new Error("Geçersiz analiz iş kimliği.");
  const normalized = normalizeLoopbackBridgeUrl(baseUrl);
  if (!token.trim()) throw new Error("Analiz için yerel köprü tokenı gerekli.");
  const response = await fetchWithTimeout(`${normalized}/bridge/v1/analyses/static-structural/${jobId}`, {
    headers: { "X-MSKU-Bridge-Token": token.trim() },
  }, 12_000);
  if (!response.ok) throw new Error(`Analiz durumu HTTP ${response.status} döndürdü.`);
  return validateStaticJob(await response.json() as StaticStructuralJob);
}

function validateModalJob(job: ModalAnalysisJob): ModalAnalysisJob {
  if (!job.jobId || !["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"].includes(job.state)) {
    throw new Error("Modal analiz yanıtı geçersiz.");
  }
  if (job.state !== "SUCCEEDED") {
    if (job.result !== null) throw new Error("Tamamlanmamış modal analiz sonuç içeremez.");
    return job;
  }
  const result = job.result;
  if (!result || result.solverStatus !== "Done" || result.units !== "SI"
    || result.validationStatus !== "NUMERIC_RESULT_UNVALIDATED_PHYSICALLY"
    || result.meshConvergenceStatus !== "NOT_ASSESSED"
    || !/^[a-f0-9]{64}$/.test(result.geometrySha256)
    || !Number.isInteger(result.meshNodes) || result.meshNodes <= 0
    || !Number.isInteger(result.meshElements) || result.meshElements <= 0
    || result.resultFileBytes <= 0 || result.bodyCount <= 0
    || result.fixedScopeEntityCount <= 0
    || !Array.isArray(result.modes) || result.modes.length < 1 || result.modes.length > 6
    || result.modes.some((mode, index) => mode.modeNumber !== index + 1
      || !Number.isFinite(mode.frequencyHz) || mode.frequencyHz <= 0
      || (index > 0 && mode.frequencyHz < result.modes[index - 1].frequencyHz))
    || !Array.isArray(result.warnings)
    || !result.warnings.every((warning) => typeof warning === "string")
    || !result.productInfo?.toLocaleLowerCase("en-US").includes("ansys mechanical")) {
    throw new Error("Mechanical modal çözüm veya frekans kanıtı eksik.");
  }
  return job;
}

export async function startModalAnalysis(
  baseUrl: string, token: string, input: ModalAnalysisInput,
): Promise<ModalAnalysisJob> {
  const normalized = normalizeLoopbackBridgeUrl(baseUrl);
  if (!token.trim()) throw new Error("Modal analiz için yerel köprü tokenı gerekli.");
  const response = await fetchWithTimeout(`${normalized}/bridge/v1/analyses/modal`, {
    method: "POST",
    headers: { "X-MSKU-Bridge-Token": token.trim(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }, 12_000);
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { detail?: { message?: string } } | null;
    throw new Error(error?.detail?.message ?? `Modal analiz HTTP ${response.status} döndürdü.`);
  }
  return validateModalJob(await response.json() as ModalAnalysisJob);
}

export async function readModalAnalysis(
  baseUrl: string, token: string, jobId: string,
): Promise<ModalAnalysisJob> {
  if (!/^[a-f0-9-]{36}$/.test(jobId)) throw new Error("Geçersiz modal iş kimliği.");
  const normalized = normalizeLoopbackBridgeUrl(baseUrl);
  if (!token.trim()) throw new Error("Modal analiz için yerel köprü tokenı gerekli.");
  const response = await fetchWithTimeout(`${normalized}/bridge/v1/analyses/modal/${jobId}`, {
    headers: { "X-MSKU-Bridge-Token": token.trim() },
  }, 12_000);
  if (!response.ok) throw new Error(`Modal analiz durumu HTTP ${response.status} döndürdü.`);
  return validateModalJob(await response.json() as ModalAnalysisJob);
}
