import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizeLoopbackBridgeUrl, probeAnsysBridge } from "./ansysBridge";

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
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      status: "ok",
      service: "msku-ansys-local-bridge",
      version: "0.1.0",
      scope: "localhost_only",
      tokenConfigured: true,
    }), { status: 200 }));

    const state = await probeAnsysBridge("http://127.0.0.1:8765", "");

    expect(state.kind).toBe("token_required");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accepts only the Phase 1 mock status contract", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "ok",
        service: "msku-ansys-local-bridge",
        version: "0.1.0",
        scope: "localhost_only",
        tokenConfigured: true,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "ready",
        service: "msku-ansys-local-bridge",
        version: "0.1.0",
        transport: "localhost_token",
        adapter: {
          adapter: "mock",
          state: "MOCK_READY",
          ansysConnected: false,
          simulationsEnabled: false,
          capabilities: ["health_check"],
          message: "Mock hazır.",
        },
        warnings: ["MOCK_ADAPTER_ONLY"],
      }), { status: 200 }));

    const state = await probeAnsysBridge("http://127.0.0.1:8765", "secure-token");

    expect(state.kind).toBe("mock_ready");
    if (state.kind === "mock_ready") expect(state.status.adapter.simulationsEnabled).toBe(false);
  });

  it("does not treat an authorization failure as an offline bridge", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "ok",
        service: "msku-ansys-local-bridge",
        version: "0.1.0",
        scope: "localhost_only",
        tokenConfigured: true,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(probeAnsysBridge("http://127.0.0.1:8765", "wrong")).resolves.toMatchObject({
      kind: "unauthorized",
    });
  });
});
