from __future__ import annotations

import importlib
import re
import socket
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, Protocol

from .config import BridgeSettings
from .discovery import (
    AnsysInstallation,
    InstallationDiscovery,
    PyMechanicalCompatibility,
    discover_windows_installations,
    pymechanical_compatibility,
)


@dataclass(frozen=True, slots=True)
class ConnectionTestResult:
    state: Literal[
        "NOT_TESTED",
        "VERIFIED",
        "TEST_IN_PROGRESS",
        "INSTALLATION_NOT_FOUND",
        "INCOMPATIBLE",
        "PROCESS_NOT_REACHABLE",
        "AUTHENTICATION_FAILED",
        "LICENSE_ERROR",
        "VERIFICATION_FAILED",
    ]
    process_verified: bool
    host: Literal["127.0.0.1"]
    port: int
    checked_at: str | None
    mechanical_version: str | None
    product_info: str | None
    error_code: str | None
    message: str


@dataclass(frozen=True, slots=True)
class AdapterStatus:
    adapter: Literal["pymechanical"]
    state: Literal[
        "READY_FOR_CONNECTION_TEST",
        "INSTALLATION_NOT_FOUND",
        "INCOMPATIBLE",
        "UNSUPPORTED_PLATFORM",
    ]
    ansys_connected: bool
    simulations_enabled: Literal[False]
    capabilities: tuple[str, ...]
    message: str
    discovery: InstallationDiscovery
    compatibility: PyMechanicalCompatibility
    connection: ConnectionTestResult


class MechanicalClient(Protocol):
    @property
    def version(self) -> Any: ...

    def verify_valid_connection(self) -> Any: ...

    def get_product_info(self) -> Any: ...


class MechanicalConnector(Protocol):
    def connect(
        self,
        *,
        host: str,
        port: int,
        timeout_seconds: int,
    ) -> MechanicalClient: ...


class PyMechanicalConnector:
    """Lazy PyMechanical boundary; it connects only to an already-running local process."""

    def connect(
        self,
        *,
        host: str,
        port: int,
        timeout_seconds: int,
    ) -> MechanicalClient:
        core = importlib.import_module("ansys.mechanical.core")
        connect_to_mechanical = core.connect_to_mechanical
        return connect_to_mechanical(
            ip=host,
            port=port,
            connect_timeout=timeout_seconds,
            cleanup_on_exit=False,
            keep_connection_alive=False,
            transport_mode="wnua",
        )


class AnsysAdapter(Protocol):
    def status(self) -> AdapterStatus: ...

    def test_connection(self) -> ConnectionTestResult: ...


def _loopback_port_open(host: str, port: int, timeout_seconds: float) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout_seconds):
            return True
    except OSError:
        return False


def _not_tested(port: int) -> ConnectionTestResult:
    return ConnectionTestResult(
        state="NOT_TESTED",
        process_verified=False,
        host="127.0.0.1",
        port=port,
        checked_at=None,
        mechanical_version=None,
        product_info=None,
        error_code=None,
        message="Gerçek Mechanical prosesi henüz doğrulanmadı.",
    )


class LocalAnsysAdapter:
    """Detect installations and verify an existing local Mechanical gRPC process safely."""

    def __init__(
        self,
        settings: BridgeSettings,
        *,
        discovery_provider: Callable[[], InstallationDiscovery] = discover_windows_installations,
        compatibility_provider: Callable[
            [AnsysInstallation | None], PyMechanicalCompatibility
        ] = pymechanical_compatibility,
        connector: MechanicalConnector | None = None,
        port_probe: Callable[[str, int, float], bool] = _loopback_port_open,
    ) -> None:
        self._settings = settings
        self._discovery_provider = discovery_provider
        self._compatibility_provider = compatibility_provider
        self._connector = connector or PyMechanicalConnector()
        self._port_probe = port_probe
        self._connection = _not_tested(settings.mechanical_port)
        self._connection_lock = threading.Lock()

    def _environment(self) -> tuple[InstallationDiscovery, PyMechanicalCompatibility]:
        discovery = self._discovery_provider()
        compatibility = self._compatibility_provider(discovery.selected)
        return discovery, compatibility

    def status(self) -> AdapterStatus:
        discovery, compatibility = self._environment()
        state: Literal[
            "READY_FOR_CONNECTION_TEST",
            "INSTALLATION_NOT_FOUND",
            "INCOMPATIBLE",
            "UNSUPPORTED_PLATFORM",
        ]
        if discovery.state == "UNSUPPORTED_PLATFORM":
            state = "UNSUPPORTED_PLATFORM"
            message = "ANSYS Student kurulum tespiti yalnızca Windows üzerinde destekleniyor."
        elif discovery.selected is None:
            state = "INSTALLATION_NOT_FOUND"
            message = "Doğrulanabilir bir ANSYS Mechanical kurulumu bulunamadı."
        elif compatibility.state != "COMPATIBLE":
            state = "INCOMPATIBLE"
            message = compatibility.message
        else:
            state = "READY_FOR_CONNECTION_TEST"
            message = (
                "Kurulum bulundu; gerçek proses bağlantısı kullanıcı isteğiyle test edilebilir."
            )
        return AdapterStatus(
            adapter="pymechanical",
            state=state,
            ansys_connected=self._connection.process_verified,
            simulations_enabled=False,
            capabilities=(
                "windows_installation_detection",
                "pymechanical_compatibility_check",
                "existing_process_connection_test",
            ),
            message=message,
            discovery=discovery,
            compatibility=compatibility,
            connection=self._connection,
        )

    def _failure(
        self,
        state: Literal[
            "INSTALLATION_NOT_FOUND",
            "INCOMPATIBLE",
            "PROCESS_NOT_REACHABLE",
            "AUTHENTICATION_FAILED",
            "LICENSE_ERROR",
            "VERIFICATION_FAILED",
        ],
        code: str,
        message: str,
    ) -> ConnectionTestResult:
        result = ConnectionTestResult(
            state=state,
            process_verified=False,
            host="127.0.0.1",
            port=self._settings.mechanical_port,
            checked_at=datetime.now(UTC).isoformat(),
            mechanical_version=None,
            product_info=None,
            error_code=code,
            message=message,
        )
        self._connection = result
        return result

    def test_connection(self) -> ConnectionTestResult:
        if not self._connection_lock.acquire(blocking=False):
            return ConnectionTestResult(
                state="TEST_IN_PROGRESS",
                process_verified=False,
                host="127.0.0.1",
                port=self._settings.mechanical_port,
                checked_at=datetime.now(UTC).isoformat(),
                mechanical_version=None,
                product_info=None,
                error_code="CONNECTION_TEST_IN_PROGRESS",
                message="Başka bir gerçek proses bağlantı testi devam ediyor.",
            )
        try:
            discovery, compatibility = self._environment()
            if discovery.selected is None:
                return self._failure(
                    "INSTALLATION_NOT_FOUND",
                    "ANSYS_INSTALLATION_NOT_FOUND",
                    "Bağlantı testi yapılmadı; Mechanical kurulumu doğrulanamadı.",
                )
            if compatibility.state != "COMPATIBLE":
                return self._failure(
                    "INCOMPATIBLE",
                    compatibility.state,
                    compatibility.message,
                )
            if not self._port_probe(
                "127.0.0.1",
                self._settings.mechanical_port,
                min(float(self._settings.connection_timeout_seconds), 1.0),
            ):
                return self._failure(
                    "PROCESS_NOT_REACHABLE",
                    "MECHANICAL_GRPC_PROCESS_NOT_REACHABLE",
                    (
                        "127.0.0.1 üzerindeki Mechanical gRPC prosesi erişilebilir değil. "
                        "Bridge ANSYS'i otomatik başlatmaz."
                    ),
                )

            try:
                client = self._connector.connect(
                    host="127.0.0.1",
                    port=self._settings.mechanical_port,
                    timeout_seconds=self._settings.connection_timeout_seconds,
                )
                verification = client.verify_valid_connection()
                if verification is False:
                    return self._failure(
                        "VERIFICATION_FAILED",
                        "PYMECHANICAL_CONNECTION_REJECTED",
                        "PyMechanical gerçek Mechanical bağlantısını doğrulamadı.",
                    )
                product_info = str(client.get_product_info()).strip()
                mechanical_version = str(client.version).strip()
            except Exception as exc:  # PyMechanical exposes multiple runtime/gRPC exception types.
                lowered = f"{type(exc).__name__} {exc}".casefold()
                if "license" in lowered:
                    return self._failure(
                        "LICENSE_ERROR",
                        "ANSYS_LICENSE_UNAVAILABLE",
                        "Mechanical lisansı alınamadı veya mevcut lisans bağlantıya izin vermedi.",
                    )
                if "auth" in lowered or "wnua" in lowered or "credential" in lowered:
                    return self._failure(
                        "AUTHENTICATION_FAILED",
                        "PYMECHANICAL_WNUA_AUTHENTICATION_FAILED",
                        "Windows Named User Authentication ile Mechanical bağlantısı kurulamadı.",
                    )
                return self._failure(
                    "VERIFICATION_FAILED",
                    "PYMECHANICAL_CONNECTION_FAILED",
                    (
                        "PyMechanical bağlantısı doğrulanamadı. Mechanical gRPC modu, sürüm, "
                        "port ve servis paketi ayarlarını kontrol edin."
                    ),
                )

            if not product_info or "ansys mechanical" not in product_info.casefold():
                return self._failure(
                    "VERIFICATION_FAILED",
                    "UNEXPECTED_MECHANICAL_PRODUCT_INFO",
                    "Bağlanan proses doğrulanmış Ansys Mechanical ürün bilgisi döndürmedi.",
                )
            if not mechanical_version:
                return self._failure(
                    "VERIFICATION_FAILED",
                    "MECHANICAL_VERSION_NOT_REPORTED",
                    "Bağlanan Mechanical prosesi sürüm bilgisi döndürmedi.",
                )
            version_match = re.search(r"(?<!\d)(\d{3})(?!\d)", mechanical_version)
            detected_codes = {item.version_code for item in discovery.installations}
            if version_match is None or int(version_match.group(1)) not in detected_codes:
                return self._failure(
                    "VERIFICATION_FAILED",
                    "MECHANICAL_PROCESS_VERSION_NOT_DETECTED_LOCALLY",
                    (
                        "Bağlanan prosesin sürümü, bu bilgisayarda tespit edilen Mechanical "
                        "kurulumlarından biriyle eşleşmedi."
                    ),
                )

            result = ConnectionTestResult(
                state="VERIFIED",
                process_verified=True,
                host="127.0.0.1",
                port=self._settings.mechanical_port,
                checked_at=datetime.now(UTC).isoformat(),
                mechanical_version=mechanical_version,
                product_info=product_info[:500],
                error_code=None,
                message="Gerçek Ansys Mechanical prosesi PyMechanical ile doğrulandı.",
            )
            self._connection = result
            return result
        finally:
            self._connection_lock.release()
