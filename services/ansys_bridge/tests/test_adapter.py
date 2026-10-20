from __future__ import annotations

from pathlib import Path
from typing import Any

from msku_ansys_bridge.adapter import LocalAnsysAdapter
from msku_ansys_bridge.config import BridgeSettings
from msku_ansys_bridge.discovery import (
    AnsysInstallation,
    InstallationDiscovery,
    pymechanical_compatibility,
)


class FakeClient:
    def __init__(
        self,
        *,
        verification: bool | None = True,
        version: object = 261,
        product_info: object = "Ansys Mechanical [Student]\nProduct Version:261",
        failure: Exception | None = None,
    ) -> None:
        self.verification = verification
        self.version = version
        self.product_info = product_info
        self.failure = failure
        self.verify_calls = 0
        self.product_calls = 0

    def verify_valid_connection(self) -> bool | None:
        self.verify_calls += 1
        if self.failure:
            raise self.failure
        return self.verification

    def get_product_info(self) -> object:
        self.product_calls += 1
        return self.product_info


class FakeConnector:
    def __init__(self, client: FakeClient) -> None:
        self.client = client
        self.calls: list[dict[str, Any]] = []

    def connect(self, **kwargs: Any) -> FakeClient:
        self.calls.append(kwargs)
        return self.client


def installation_discovery() -> InstallationDiscovery:
    installation = AnsysInstallation(
        version_code=261,
        release="2026 R1",
        root=Path("C:/Program Files/ANSYS Inc/ANSYS Student/v261"),
        executable=Path(
            "C:/Program Files/ANSYS Inc/ANSYS Student/v261/aisol/bin/winx64/AnsysWBU.exe"
        ),
        product_kind="student",
        source="fixture",
    )
    return InstallationDiscovery(
        platform="Windows",
        state="FOUND",
        installations=(installation,),
        selected=installation,
        warnings=(),
    )


def adapter(
    client: FakeClient,
    *,
    port_open: bool = True,
    discovery: InstallationDiscovery | None = None,
) -> tuple[LocalAnsysAdapter, FakeConnector]:
    active_discovery = discovery or installation_discovery()
    connector = FakeConnector(client)
    instance = LocalAnsysAdapter(
        BridgeSettings(token="x" * 32),
        discovery_provider=lambda: active_discovery,
        compatibility_provider=lambda value: pymechanical_compatibility(
            value, distribution_version="0.13.4", python_version=(3, 12)
        ),
        connector=connector,
        port_probe=lambda _host, _port, _timeout: port_open,
    )
    return instance, connector


def test_success_requires_connection_verification_product_identity_and_matching_version() -> None:
    client = FakeClient(verification=True)
    instance, connector = adapter(client)

    result = instance.test_connection()

    assert result.state == "VERIFIED"
    assert result.process_verified is True
    assert client.verify_calls == 1
    assert client.product_calls == 1
    assert connector.calls == [{
        "host": "127.0.0.1",
        "port": 10000,
        "timeout_seconds": 8,
    }]
    assert instance.status().ansys_connected is True


def test_closed_port_never_calls_pymechanical_connector() -> None:
    instance, connector = adapter(FakeClient(), port_open=False)

    result = instance.test_connection()

    assert result.state == "PROCESS_NOT_REACHABLE"
    assert result.process_verified is False
    assert connector.calls == []


def test_explicit_failed_verification_cannot_be_reported_as_connected() -> None:
    client = FakeClient(verification=False)
    instance, _ = adapter(client)

    result = instance.test_connection()

    assert result.state == "VERIFICATION_FAILED"
    assert result.process_verified is False
    assert client.product_calls == 0
    assert instance.status().ansys_connected is False


def test_unexpected_product_or_mismatched_version_is_rejected() -> None:
    wrong_product, _ = adapter(FakeClient(product_info="Other gRPC service"))
    wrong_version, _ = adapter(FakeClient(version=251))

    assert wrong_product.test_connection().error_code == "UNEXPECTED_MECHANICAL_PRODUCT_INFO"
    assert (
        wrong_version.test_connection().error_code
        == "MECHANICAL_PROCESS_VERSION_NOT_DETECTED_LOCALLY"
    )


def test_license_and_authentication_errors_are_clear_but_do_not_leak_details() -> None:
    license_adapter, _ = adapter(FakeClient(failure=RuntimeError("license server secret=abc")))
    auth_adapter, _ = adapter(FakeClient(failure=RuntimeError("WNUA credential rejected")))

    license_result = license_adapter.test_connection()
    auth_result = auth_adapter.test_connection()

    assert license_result.state == "LICENSE_ERROR"
    assert license_result.error_code == "ANSYS_LICENSE_UNAVAILABLE"
    assert "secret=abc" not in license_result.message
    assert auth_result.state == "AUTHENTICATION_FAILED"
    assert auth_result.error_code == "PYMECHANICAL_WNUA_AUTHENTICATION_FAILED"
