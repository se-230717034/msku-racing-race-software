import { afterEach, describe, expect, it, vi } from "vitest";

import {
  launchRealAnsysConnection,
  normalizeLoopbackBridgeUrl,
  probeAnsysBridge,
  testRealAnsysConnection,
} from "./ansysBridge";

const live = {
  status: "ok",
  service: "msku-ansys-local-bridge",
  version: "0.2.1",
  scope: "localhost_only",
  tokenConfigured: true,
};

function bridgeStatus(connectionState = "NOT_TESTED", processVerified = false, startedByBridge = false) {
  const verified = connectionState === "VERIFIED" && processVerified;
  return {
    status: "ready",
    service: "msku-ansys-local-bridge",
    version: "0.2.1",
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
    warnings: verified ? ["SIMULATION_ENDPOINTS_NOT_IMPLEMENTED"] : ["REAL_ANSYS_NOT_CONNECTED"],
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
});
