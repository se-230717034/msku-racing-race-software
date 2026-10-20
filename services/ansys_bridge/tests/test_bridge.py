from __future__ import annotations

from fastapi.testclient import TestClient
from msku_ansys_bridge.config import BridgeSettings
from msku_ansys_bridge.main import create_app

TOKEN = "phase-one-test-token-with-at-least-32-characters"
ORIGIN = "https://msku-racing-race-software.vercel.app"


def client(*, token: str | None = TOKEN) -> TestClient:
    settings = BridgeSettings(
        token=token,
        allowed_origins=(ORIGIN,),
        allow_test_client=True,
    )
    return TestClient(create_app(settings))


def test_live_health_exposes_only_bridge_readiness() -> None:
    response = client().get("/bridge/v1/health/live")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "msku-ansys-local-bridge",
        "version": "0.1.0",
        "scope": "localhost_only",
        "tokenConfigured": True,
    }


def test_authenticated_status_is_explicitly_mock_only() -> None:
    response = client().get(
        "/bridge/v1/status",
        headers={"X-MSKU-Bridge-Token": TOKEN, "Origin": ORIGIN},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["transport"] == "localhost_token"
    assert payload["adapter"]["adapter"] == "mock"
    assert payload["adapter"]["state"] == "MOCK_READY"
    assert payload["adapter"]["ansysConnected"] is False
    assert payload["adapter"]["simulationsEnabled"] is False
    assert payload["warnings"] == [
        "MOCK_ADAPTER_ONLY",
        "REAL_ANSYS_NOT_CONNECTED",
        "SIMULATION_ENDPOINTS_NOT_IMPLEMENTED",
    ]


def test_authenticated_readiness_does_not_claim_ansys_readiness() -> None:
    response = client().get(
        "/bridge/v1/health/ready",
        headers={"X-MSKU-Bridge-Token": TOKEN, "Origin": ORIGIN},
    )

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "service": "msku-ansys-local-bridge",
        "version": "0.1.0",
        "adapterState": "MOCK_READY",
        "ansysConnected": False,
        "simulationsEnabled": False,
    }


def test_status_rejects_missing_or_invalid_token() -> None:
    bridge = client()

    assert bridge.get("/bridge/v1/status").status_code == 401
    assert (
        bridge.get(
            "/bridge/v1/status",
            headers={"X-MSKU-Bridge-Token": "incorrect-token-value"},
        ).status_code
        == 401
    )


def test_unconfigured_bridge_refuses_authenticated_status() -> None:
    response = client(token=None).get(
        "/bridge/v1/status",
        headers={"X-MSKU-Bridge-Token": TOKEN},
    )

    assert response.status_code == 503
    assert response.json()["detail"].startswith("Bridge token is not configured")


def test_untrusted_browser_origin_is_rejected_before_routing() -> None:
    response = client().get(
        "/bridge/v1/status",
        headers={"X-MSKU-Bridge-Token": TOKEN, "Origin": "https://attacker.example"},
    )

    assert response.status_code == 403
    assert response.json() == {"detail": "Browser origin is not allowed."}


def test_cors_preflight_supports_private_network_access_for_allowed_origin() -> None:
    response = client().options(
        "/bridge/v1/status",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "X-MSKU-Bridge-Token",
            "Access-Control-Request-Private-Network": "true",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ORIGIN
    assert response.headers["access-control-allow-private-network"] == "true"


def test_remote_socket_is_rejected() -> None:
    settings = BridgeSettings(token=TOKEN, allowed_origins=(ORIGIN,))
    bridge = TestClient(create_app(settings), client=("10.20.30.40", 5000))
    response = bridge.get("/bridge/v1/health/live")

    assert response.status_code == 403
    assert response.json() == {"detail": "Local bridge accepts loopback clients only."}
