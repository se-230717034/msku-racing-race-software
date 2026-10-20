from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from msku_ansys_bridge.adapter import LocalAnsysAdapter
from msku_ansys_bridge.config import BridgeSettings
from msku_ansys_bridge.discovery import (
    AnsysInstallation,
    InstallationDiscovery,
    pymechanical_compatibility,
)
from msku_ansys_bridge.main import create_app

TOKEN = "phase-two-test-token-with-at-least-32-characters"
ORIGIN = "https://msku-racing-race-software.vercel.app"


class VerifiedClient:
    version = 261

    def verify_valid_connection(self) -> bool:
        return True

    def get_product_info(self) -> str:
        return "Ansys Mechanical [Ansys Mechanical Student]\nProduct Version:261"


class VerifiedConnector:
    def connect(self, **_: Any) -> VerifiedClient:
        return VerifiedClient()


def fake_adapter(settings: BridgeSettings) -> LocalAnsysAdapter:
    installation = AnsysInstallation(
        version_code=261,
        release="2026 R1",
        root=Path("C:/Program Files/ANSYS Inc/ANSYS Student/v261"),
        executable=Path(
            "C:/Program Files/ANSYS Inc/ANSYS Student/v261/aisol/bin/winx64/AnsysWBU.exe"
        ),
        product_kind="student",
        source="AWP_ROOT261",
    )
    discovery = InstallationDiscovery(
        platform="Windows",
        state="FOUND",
        installations=(installation,),
        selected=installation,
        warnings=(),
    )
    return LocalAnsysAdapter(
        settings,
        discovery_provider=lambda: discovery,
        compatibility_provider=lambda value: pymechanical_compatibility(
            value, distribution_version="0.13.4", python_version=(3, 12)
        ),
        connector=VerifiedConnector(),
        port_probe=lambda _host, _port, _timeout: True,
    )


@contextmanager
def client(*, token: str | None = TOKEN) -> Iterator[TestClient]:
    settings = BridgeSettings(
        token=token,
        allowed_origins=(ORIGIN,),
        allow_test_client=True,
    )
    with TestClient(create_app(settings, fake_adapter(settings))) as bridge:
        yield bridge


def test_live_health_exposes_only_bridge_readiness() -> None:
    with client() as bridge:
        response = bridge.get("/bridge/v1/health/live")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "msku-ansys-local-bridge",
        "version": "0.2.0",
        "scope": "localhost_only",
        "tokenConfigured": True,
    }


def test_status_reports_installation_and_compatibility_without_claiming_connection() -> None:
    with client() as bridge:
        response = bridge.get(
            "/bridge/v1/status",
            headers={"X-MSKU-Bridge-Token": TOKEN, "Origin": ORIGIN},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["transport"] == "localhost_token_wnua"
    assert payload["adapter"]["adapter"] == "pymechanical"
    assert payload["adapter"]["state"] == "READY_FOR_CONNECTION_TEST"
    assert payload["adapter"]["installation"]["selected"]["productKind"] == "student"
    assert payload["adapter"]["installation"]["selected"]["versionCode"] == 261
    assert payload["adapter"]["compatibility"]["state"] == "COMPATIBLE"
    assert payload["adapter"]["ansysConnected"] is False
    assert payload["adapter"]["simulationsEnabled"] is False
    assert payload["adapter"]["connection"]["state"] == "NOT_TESTED"
    assert "REAL_ANSYS_NOT_CONNECTED" in payload["warnings"]
    assert "SIMULATION_ENDPOINTS_NOT_IMPLEMENTED" in payload["warnings"]


def test_connection_endpoint_reports_verified_only_after_process_checks() -> None:
    with client() as bridge:
        response = bridge.post(
            "/bridge/v1/connection/test",
            headers={"X-MSKU-Bridge-Token": TOKEN, "Origin": ORIGIN},
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["state"] == "VERIFIED"
        assert payload["processVerified"] is True
        assert payload["mechanicalVersion"] == "261"
        assert "Ansys Mechanical" in payload["productInfo"]

        status = bridge.get(
            "/bridge/v1/status",
            headers={"X-MSKU-Bridge-Token": TOKEN, "Origin": ORIGIN},
        ).json()
        assert status["adapter"]["ansysConnected"] is True
        assert status["adapter"]["connection"]["checkedAt"] is not None
        assert "REAL_ANSYS_NOT_CONNECTED" not in status["warnings"]


def test_authenticated_readiness_does_not_enable_simulations() -> None:
    with client() as bridge:
        response = bridge.get(
            "/bridge/v1/health/ready",
            headers={"X-MSKU-Bridge-Token": TOKEN, "Origin": ORIGIN},
        )

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "service": "msku-ansys-local-bridge",
        "version": "0.2.0",
        "adapterState": "READY_FOR_CONNECTION_TEST",
        "ansysConnected": False,
        "simulationsEnabled": False,
    }


def test_status_and_connection_test_reject_missing_or_invalid_token() -> None:
    with client() as bridge:
        assert bridge.get("/bridge/v1/status").status_code == 401
        assert bridge.post("/bridge/v1/connection/test").status_code == 401
        assert (
            bridge.get(
                "/bridge/v1/status",
                headers={"X-MSKU-Bridge-Token": "incorrect-token-value"},
            ).status_code
            == 401
        )


def test_unconfigured_bridge_refuses_authenticated_status() -> None:
    with client(token=None) as bridge:
        response = bridge.get(
            "/bridge/v1/status",
            headers={"X-MSKU-Bridge-Token": TOKEN},
        )

    assert response.status_code == 503
    assert response.json()["detail"].startswith("Bridge token is not configured")


def test_untrusted_browser_origin_is_rejected_before_routing() -> None:
    with client() as bridge:
        response = bridge.get(
            "/bridge/v1/status",
            headers={"X-MSKU-Bridge-Token": TOKEN, "Origin": "https://attacker.example"},
        )

    assert response.status_code == 403
    assert response.json() == {"detail": "Browser origin is not allowed."}


def test_cors_preflight_supports_private_network_access_for_post() -> None:
    with client() as bridge:
        response = bridge.options(
            "/bridge/v1/connection/test",
            headers={
                "Origin": ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "X-MSKU-Bridge-Token",
                "Access-Control-Request-Private-Network": "true",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ORIGIN
    assert response.headers["access-control-allow-private-network"] == "true"


def test_remote_socket_is_rejected() -> None:
    settings = BridgeSettings(token=TOKEN, allowed_origins=(ORIGIN,))
    with TestClient(
        create_app(settings, fake_adapter(settings)), client=("10.20.30.40", 5000)
    ) as bridge:
        response = bridge.get("/bridge/v1/health/live")

    assert response.status_code == 403
    assert response.json() == {"detail": "Local bridge accepts loopback clients only."}
