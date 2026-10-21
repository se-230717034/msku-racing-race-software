from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import msku_ansys_bridge.adapter as adapter_module
import pytest
from msku_ansys_bridge.adapter import LocalAnsysAdapter, PyMechanicalLauncher
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
        read_only: object = False,
        failure: Exception | None = None,
    ) -> None:
        self.verification = verification
        self.version = version
        self.product_info = product_info
        self.read_only = read_only
        self.failure = failure
        self.verify_calls = 0
        self.product_calls = 0
        self.exit_calls = 0

    def verify_valid_connection(self) -> bool | None:
        self.verify_calls += 1
        if self.failure:
            raise self.failure
        return self.verification

    def get_product_info(self) -> object:
        self.product_calls += 1
        return self.product_info

    def run_python_script(self, script: str) -> object:
        assert script == "Ansys.ACT.Mechanical.MechanicalAPI.Instance.ReadOnlyMode"
        return self.read_only

    def clear(self) -> None:
        pass

    def exit(self, force: bool = False) -> None:
        assert force is True
        self.exit_calls += 1


class FakeConnector:
    def __init__(self, client: FakeClient) -> None:
        self.client = client
        self.calls: list[dict[str, Any]] = []

    def connect(self, *, host: str, port: int, timeout_seconds: int) -> FakeClient:
        self.calls.append({"host": host, "port": port, "timeout_seconds": timeout_seconds})
        return self.client


class FakeLauncher:
    def __init__(self, client: FakeClient, failure: Exception | None = None) -> None:
        self.client = client
        self.failure = failure
        self.calls: list[dict[str, Any]] = []

    def launch(
        self,
        *,
        installation: AnsysInstallation,
        host: str,
        port: int,
        timeout_seconds: int,
        start_license: str,
    ) -> FakeClient:
        self.calls.append({
            "installation": installation,
            "host": host,
            "port": port,
            "timeout_seconds": timeout_seconds,
            "start_license": start_license,
        })
        if self.failure:
            raise self.failure
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
) -> tuple[LocalAnsysAdapter, FakeConnector, FakeLauncher]:
    active_discovery = discovery or installation_discovery()
    connector = FakeConnector(client)
    launcher = FakeLauncher(client)
    instance = LocalAnsysAdapter(
        BridgeSettings(token="x" * 32),
        discovery_provider=lambda: active_discovery,
        compatibility_provider=lambda value: pymechanical_compatibility(
            value, distribution_version="0.13.4", python_version=(3, 12)
        ),
        connector=connector,
        launcher=launcher,
        port_probe=lambda _host, _port, _timeout: port_open,
    )
    return instance, connector, launcher


def test_success_requires_connection_verification_product_identity_and_matching_version() -> None:
    client = FakeClient(verification=True)
    instance, connector, _ = adapter(client)

    result = instance.test_connection()

    assert result.state == "VERIFIED"
    assert result.process_verified is True
    assert result.license_verified is True
    assert "solver lisansı ancak gerçek çözümde" in result.message
    assert client.verify_calls == 1
    assert client.product_calls == 1
    assert connector.calls == [
        {
            "host": "127.0.0.1",
            "port": 10000,
            "timeout_seconds": 8,
        }
    ]
    assert instance.status().ansys_connected is True


def test_closed_port_never_calls_pymechanical_connector() -> None:
    instance, connector, _ = adapter(FakeClient(), port_open=False)

    result = instance.test_connection()

    assert result.state == "PROCESS_NOT_REACHABLE"
    assert result.process_verified is False
    assert connector.calls == []


def test_explicit_failed_verification_cannot_be_reported_as_connected() -> None:
    client = FakeClient(verification=False)
    instance, _, _ = adapter(client)

    result = instance.test_connection()

    assert result.state == "VERIFICATION_FAILED"
    assert result.process_verified is False
    assert client.product_calls == 0
    assert instance.status().ansys_connected is False


def test_unexpected_product_or_mismatched_version_is_rejected() -> None:
    wrong_product, _, _ = adapter(FakeClient(product_info="Other gRPC service"))
    wrong_version, _, _ = adapter(FakeClient(version=251))

    assert wrong_product.test_connection().error_code == "UNEXPECTED_MECHANICAL_PRODUCT_INFO"
    assert (
        wrong_version.test_connection().error_code
        == "MECHANICAL_PROCESS_VERSION_NOT_DETECTED_LOCALLY"
    )


def test_license_and_authentication_errors_are_clear_but_do_not_leak_details() -> None:
    license_adapter, _, _ = adapter(FakeClient(failure=RuntimeError("license server secret=abc")))
    auth_adapter, _, _ = adapter(FakeClient(failure=RuntimeError("WNUA credential rejected")))

    license_result = license_adapter.test_connection()
    auth_result = auth_adapter.test_connection()

    assert license_result.state == "LICENSE_ERROR"
    assert license_result.error_code == "ANSYS_LICENSE_UNAVAILABLE"
    assert "secret=abc" not in license_result.message
    assert auth_result.state == "AUTHENTICATION_FAILED"
    assert auth_result.error_code == "PYMECHANICAL_WNUA_AUTHENTICATION_FAILED"


def test_read_only_process_is_not_reported_as_licensed_or_verified() -> None:
    instance, _, _ = adapter(FakeClient(read_only=True))

    result = instance.test_connection()

    assert result.state == "LICENSE_ERROR"
    assert result.error_code == "MECHANICAL_LICENSE_NOT_CHECKED_OUT"
    assert result.process_verified is False
    assert result.license_verified is False


def test_status_revokes_verified_connection_when_real_listener_disappears() -> None:
    client = FakeClient()
    discovery = installation_discovery()
    port = {"open": True}
    instance = LocalAnsysAdapter(
        BridgeSettings(token="x" * 32),
        discovery_provider=lambda: discovery,
        compatibility_provider=lambda value: pymechanical_compatibility(
            value, distribution_version="0.13.4", python_version=(3, 12)
        ),
        connector=FakeConnector(client),
        port_probe=lambda _host, _port, _timeout: port["open"],
    )

    assert instance.test_connection().state == "VERIFIED"
    assert instance.status().ansys_connected is True
    port["open"] = False

    status = instance.status()

    assert status.ansys_connected is False
    assert status.connection.state == "PROCESS_NOT_REACHABLE"
    instance.close()
    assert client.exit_calls == 0


def test_launch_uses_detected_executable_and_versioned_awp_root() -> None:
    client = FakeClient()
    instance, connector, launcher = adapter(client, port_open=False)

    result = instance.launch_connection()

    installation = installation_discovery().selected
    assert installation is not None
    assert result.state == "VERIFIED"
    assert result.process_verified is True
    assert result.license_verified is True
    assert result.started_by_bridge is True
    assert connector.calls == []
    assert launcher.calls == [
        {
            "installation": installation,
            "host": "127.0.0.1",
            "port": 10000,
            "timeout_seconds": 180,
            "start_license": "auto",
        }
    ]
    assert client.exit_calls == 0

    instance.close()

    assert client.exit_calls == 1
    assert instance.status().ansys_connected is False


def test_launch_does_not_replace_existing_listener_or_hide_startup_errors() -> None:
    existing, _, existing_launcher = adapter(FakeClient(), port_open=True)
    existing_result = existing.launch_connection()

    assert existing_result.error_code == "MECHANICAL_PORT_ALREADY_IN_USE"
    assert existing_launcher.calls == []

    client = FakeClient()
    failed, _, failed_launcher = adapter(client, port_open=False)
    failed_launcher.failure = OSError("Unable to connect secret detail")
    failed_result = failed.launch_connection()

    assert failed_result.state == "PROCESS_START_FAILED"
    assert failed_result.error_code == "MECHANICAL_EXPLICIT_PATH_LAUNCH_FAILED"
    assert failed_result.started_by_bridge is False
    assert "secret detail" not in failed_result.message


def test_pymechanical_launcher_passes_explicit_path_and_awp_root(monkeypatch: Any) -> None:
    installation = installation_discovery().selected
    assert installation is not None
    calls: list[dict[str, Any]] = []
    expected_client = FakeClient()

    def launch_mechanical(**kwargs: Any) -> FakeClient:
        calls.append(kwargs)
        return expected_client

    monkeypatch.setattr(
        adapter_module.importlib,
        "import_module",
        lambda name: SimpleNamespace(launch_mechanical=launch_mechanical),
    )

    result = PyMechanicalLauncher().launch(
        installation=installation,
        host="127.0.0.1",
        port=10000,
        timeout_seconds=180,
    )

    assert result is expected_client
    assert calls == [
        {
            "exec_file": str(installation.executable),
            "additional_envs": {"AWP_ROOT261": str(installation.root)},
            "ip": "127.0.0.1",
            "port": 10000,
            "batch": True,
            "start_timeout": 180,
            "cleanup_on_exit": True,
            "keep_connection_alive": True,
            "transport_mode": "wnua",
            "start_license": "aa_t_i",
        }
    ]


def test_explicit_license_is_forwarded_without_fallback(monkeypatch: Any) -> None:
    installation = installation_discovery().selected
    assert installation is not None
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(
        adapter_module.importlib,
        "import_module",
        lambda _name: SimpleNamespace(launch_mechanical=lambda **kwargs: calls.append(kwargs)),
    )
    PyMechanicalLauncher().launch(
        installation=installation,
        host="127.0.0.1",
        port=10000,
        timeout_seconds=180,
        start_license="mech_2",
    )
    assert calls[0]["start_license"] == "mech_2"
    assert calls[0]["additional_envs"] == {"AWP_ROOT261": str(installation.root)}


def test_old_mechanical_rejects_explicit_start_license_before_launch() -> None:
    installation = installation_discovery().selected
    assert installation is not None
    older = AnsysInstallation(
        version_code=251,
        release="2025 R1",
        root=installation.root,
        executable=installation.executable,
        product_kind="student",
        source="fixture",
    )
    with pytest.raises(ValueError, match="2026 R1"):
        PyMechanicalLauncher().launch(
            installation=older,
            host="127.0.0.1",
            port=10000,
            timeout_seconds=180,
            start_license="aa_t_i",
        )


@pytest.mark.parametrize(
    "product_info",
    [
        "Ansys Mechanical Enterprise PrepPost\nProduct Version:261",
        "Ansys Mechanical []\nProduct Version:261",
    ],
)
def test_owned_nonstructural_product_is_not_accepted_as_structural_license(
    product_info: str,
) -> None:
    instance, _, _ = adapter(
        FakeClient(product_info=product_info),
        port_open=False,
    )
    result = instance.launch_connection()
    assert result.state == "LICENSE_ERROR"
    assert result.error_code == "MECHANICAL_STRUCTURAL_LICENSE_NOT_CHECKED_OUT"
    assert result.process_verified is False
