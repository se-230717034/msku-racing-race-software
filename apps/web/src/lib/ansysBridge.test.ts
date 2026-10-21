import { afterEach, describe, expect, it, vi } from "vitest";

import {
  launchRealAnsysConnection,
  normalizeLoopbackBridgeUrl,
  probeAnsysBridge,
  readStaticStructural,
  startStaticStructural,
  testRealAnsysConnection,
} from "./ansysBridge";

const live = {
  status: "ok",
  service: "msku-ansys-local-bridge",
  version: "0.3.0",
  scope: "localhost_only",
  tokenConfigured: true,
};

function bridgeStatus(connectionState = "NOT_TESTED", processVerified = false, startedByBridge = false) {
  const verified = connectionState === "VERIFIED" && processVerified;
  return {
    status: "ready",
    service: "msku-ansys-local-bridge",
    version: "0.3.0",
    transport: "localhost_token_wnua",
    adapter: {
      adapter: "pymechanical",
      state: "READY_FOR_CONNECTION_TEST",
      ansysConnected: verified,
      simulationsEnabled: false,
      capabilities: ["windows_installation_detection", "existing_process_connection_test"],
      message: "Kurulum bulundu; gerçek proses bağlantısı kullanıcı isteğiyle test edilebilir.",
      installation: {
        platform: "Windows",
        state: "FOUND",
        selected: {
          versionCode: 261,
          release: "2026 R1",
          productKind: "student",
          executablePath: "C:/Program Files/ANSYS Inc/ANSYS Student/v261/aisol/bin/winx64/AnsysWBU.exe",
          source: "AWP_ROOT261",
        },
        installations: [],
        warnings: [],
      },
      compatibility: {
        state: "COMPATIBLE",
        pymechanicalVersion: "0.13.4",
        pythonVersion: "3.12",
        minimumMechanicalVersionCode: 242,
        message: "Uyumlu.",
      },
      connection: {
        state: connectionState,
        processVerified,
        licenseVerified: verified,
        startedByBridge,
        host: "127.0.0.1",
        port: 10000,
        checkedAt: verified ? "2026-10-20T18:00:00Z" : null,
        mechanicalVersion: verified ? "261" : null,
        productInfo: verified ? "Ansys Mechanical [Student] Product Version:261" : null,
        errorCode: null,
        message: verified ? "Gerçek proses doğrulandı." : "Henüz test edilmedi.",
      },
    },
    warnings: verified ? ["STATIC_STRUCTURAL_REQUIRES_EXPLICIT_LOCAL_ACTION"] : ["REAL_ANSYS_NOT_CONNECTED"],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ANSYS local bridge client", () => {
  it("accepts loopback HTTP endpoints only", () => {
    expect(normalizeLoopbackBridgeUrl("http://127.0.0.1:8765/")).toBe("http://127.0.0.1:8765");
    expect(normalizeLoopbackBridgeUrl("http://localhost:8765")).toBe("http://localhost:8765");
    expect(() => normalizeLoopbackBridgeUrl("https://bridge.example.com")).toThrow(/loopback/);
    expect(() => normalizeLoopbackBridgeUrl("http://192.168.1.20:8765")).toThrow(/loopback/);
    expect(() => normalizeLoopbackBridgeUrl("http://127.0.0.1:8765/status?token=secret")).toThrow(/içeremez/);
  });

  it("reports a running bridge as token-required without calling protected status", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(live), { status: 200 }));

    const state = await probeAnsysBridge("http://127.0.0.1:8765", "");

    expect(state.kind).toBe("token_required");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports installation compatibility without claiming a real connection", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(live), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(bridgeStatus()), { status: 200 }));

    const state = await probeAnsysBridge("http://127.0.0.1:8765", "secure-token");

    expect(state.kind).toBe("bridge_ready");
    if (state.kind === "bridge_ready") {
      expect(state.status.adapter.installation.selected?.productKind).toBe("student");
      expect(state.status.adapter.compatibility.state).toBe("COMPATIBLE");
      expect(state.status.adapter.ansysConnected).toBe(false);
    }
  });

  it("requires process proof, product identity, and version before accepting success", async () => {
    const invalidSuccess = bridgeStatus("VERIFIED", false);
    invalidSuccess.adapter.ansysConnected = true;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(live), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(invalidSuccess), { status: 200 }));

    await expect(probeAnsysBridge("http://127.0.0.1:8765", "secure-token")).resolves.toMatchObject({
      kind: "error",
    });
  });

  it("accepts verified status only after explicit real-process test and refresh", async () => {
    const verifiedConnection = bridgeStatus("VERIFIED", true).adapter.connection;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(verifiedConnection), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(bridgeStatus("VERIFIED", true)), { status: 200 }));

    const state = await testRealAnsysConnection(
      "http://127.0.0.1:8765",
      "secure-token",
    );

    expect(state.kind).toBe("connection_verified");
    if (state.kind === "connection_verified") {
      expect(state.status.adapter.connection.processVerified).toBe(true);
      expect(state.status.adapter.connection.licenseVerified).toBe(true);
      expect(state.status.adapter.simulationsEnabled).toBe(false);
    }
  });

  it("accepts explicit-path launch only with process and license proof", async () => {
    const launched = bridgeStatus("VERIFIED", true, true);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(launched.adapter.connection), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(launched), { status: 200 }));

    const state = await launchRealAnsysConnection(
      "http://127.0.0.1:8765",
      "secure-token",
    );

    expect(state.kind).toBe("connection_verified");
    if (state.kind === "connection_verified") {
      expect(state.status.adapter.connection.startedByBridge).toBe(true);
      expect(state.status.adapter.connection.licenseVerified).toBe(true);
    }
  });

  it("does not treat an authorization failure as an offline bridge", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(live), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(probeAnsysBridge("http://127.0.0.1:8765", "wrong")).resolves.toMatchObject({
      kind: "unauthorized",
    });
  });

  it("starts Static Structural only through an explicit tokened POST and polls its job", async () => {
    const job = {
      jobId: "11111111-1111-4111-8111-111111111111",
      state: "RUNNING",
      stage: "meshing",
      message: "Mesh üretiliyor",
      startedAt: "2026-10-21T10:00:00Z",
      completedAt: null,
      errorCode: null,
      result: null,
    };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(job), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(job), { status: 200 }));
    const input = {
      geometryPath: "C:\\CAD\\small.agdb",
      material: "Structural Steel" as const,
      fixedNamedSelection: "NS_Fixed",
      forceNamedSelection: "NS_Force",
      forceAxis: "X" as const,
      forceN: 1000,
      meshSizeMm: 25,
    };
    const started = await startStaticStructural("http://127.0.0.1:8765", "secure-token", input);
    const polled = await readStaticStructural("http://127.0.0.1:8765", "secure-token", started.jobId);

    expect(started.state).toBe("RUNNING");
    expect(polled.result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: { "X-MSKU-Bridge-Token": "secure-token", "Content-Type": "application/json" },
    });
    const requestBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody).toBe("string");
    expect(JSON.parse(requestBody as string)).toEqual(input);
  });

  it("rejects a falsely successful Static Structural response without solver evidence", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      jobId: "11111111-1111-4111-8111-111111111111",
      state: "SUCCEEDED",
      stage: "done",
      message: "Success",
      startedAt: "2026-10-21T10:00:00Z",
      completedAt: "2026-10-21T10:00:10Z",
      errorCode: null,
      result: null,
    }), { status: 200 }));

    await expect(readStaticStructural(
      "http://127.0.0.1:8765", "secure-token", "11111111-1111-4111-8111-111111111111",
    )).rejects.toThrow(/kanıtı/);
  });

  it("rejects a completed job without a warning list before rendering results", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      jobId: "11111111-1111-4111-8111-111111111111",
      state: "SUCCEEDED",
      stage: "done",
      message: "Mechanical completed",
      startedAt: "2026-10-21T10:00:00Z",
      completedAt: "2026-10-21T10:00:10Z",
      errorCode: null,
      result: {
        solverStatus: "Done",
        maximumVonMisesStressPa: 1,
        maximumTotalDeformationM: 1e-6,
        meshNodes: 10,
        meshElements: 2,
        geometrySha256: "a".repeat(64),
        material: "Structural Steel",
        fixedNamedSelection: "NS_Fixed",
        forceNamedSelection: "NS_Force",
        forceAxis: "X",
        forceN: 100,
        meshSizeMm: 25,
        mechanicalVersion: "261",
        productInfo: "Ansys Mechanical",
        units: "SI",
        validationStatus: "NUMERIC_RESULT_UNVALIDATED_PHYSICALLY",
      },
    }), { status: 200 }));

    await expect(readStaticStructural(
      "http://127.0.0.1:8765", "secure-token", "11111111-1111-4111-8111-111111111111",
    )).rejects.toThrow(/kanıtı/);
  });
});
