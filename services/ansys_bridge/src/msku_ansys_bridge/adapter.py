from __future__ import annotations

import importlib
import re
import socket
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, Protocol, TypeVar

from .config import BridgeSettings
from .discovery import (
    AnsysInstallation,
    InstallationDiscovery,
    PyMechanicalCompatibility,
    discover_windows_installations,
    pymechanical_compatibility,
)

_T = TypeVar("_T")


@dataclass(frozen=True, slots=True)
class ConnectionTestResult:
    state: Literal[
        "NOT_TESTED",
        "VERIFIED",
        "TEST_IN_PROGRESS",
        "LAUNCH_IN_PROGRESS",
        "INSTALLATION_NOT_FOUND",
        "INCOMPATIBLE",
        "PROCESS_NOT_REACHABLE",
        "PROCESS_START_FAILED",
        "AUTHENTICATION_FAILED",
        "LICENSE_ERROR",
        "VERIFICATION_FAILED",
    ]
    process_verified: bool
    license_verified: bool
    started_by_bridge: bool
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

    def run_python_script(self, script: str) -> Any: ...

    def clear(self) -> Any: ...

    def exit(self, force: bool = False) -> Any: ...


class MechanicalConnector(Protocol):
    def connect(
        self,
        *,
        host: str,
        port: int,
        timeout_seconds: int,
    ) -> MechanicalClient: ...


class MechanicalLauncher(Protocol):
    def launch(
        self,
        *,
        installation: AnsysInstallation,
        host: str,
        port: int,
        timeout_seconds: int,
        start_license: str,
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


class PyMechanicalLauncher:
    """Delegate automatic selection or request an explicit authorized product."""

    def launch(
        self,
        *,
        installation: AnsysInstallation,
        host: str,
        port: int,
        timeout_seconds: int,
        start_license: str = "auto",
    ) -> MechanicalClient:
        if start_license == "auto":
            # The historical aa_t_i keyword started this Student v261 install
            # read-only, while ANSYS's own selection checked out Academic Student.
            # Delegation never bypasses entitlement: verify the real process.
            license_keyword = None
        elif start_license == "none":
            license_keyword = None
        elif start_license in {"aa_t_i", "ansys", "mech_1", "mech_2"}:
            if installation.version_code < 261:
                raise ValueError("Explicit Mechanical start_license requires 2026 R1 or later")
            license_keyword = start_license
        else:
            raise ValueError("Unsupported Mechanical start_license keyword")
        core = importlib.import_module("ansys.mechanical.core")
        launch_mechanical = core.launch_mechanical
        return launch_mechanical(
            exec_file=str(installation.executable),
            additional_envs={f"AWP_ROOT{installation.version_code}": str(installation.root)},
            ip=host,
            port=port,
            batch=True,
            start_instance=True,
            start_timeout=timeout_seconds,
            cleanup_on_exit=True,
            keep_connection_alive=True,
            transport_mode="wnua",
            start_license=license_keyword,
        )


class AnsysAdapter(Protocol):
    def status(self) -> AdapterStatus: ...

    def test_connection(self) -> ConnectionTestResult: ...

    def launch_connection(self) -> ConnectionTestResult: ...

    def close(self) -> None: ...

    def run_with_owned_client(self, action: Callable[[MechanicalClient], _T]) -> _T: ...


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
        license_verified=False,
        started_by_bridge=False,
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
        discovery_provider: Callable[[], InstallationDiscovery] | None = None,
        compatibility_provider: Callable[
            [AnsysInstallation | None], PyMechanicalCompatibility
        ] = pymechanical_compatibility,
        connector: MechanicalConnector | None = None,
        launcher: MechanicalLauncher | None = None,
        port_probe: Callable[[str, int, float], bool] = _loopback_port_open,
    ) -> None:
        self._settings = settings
        self._discovery_provider = discovery_provider or (
            lambda: discover_windows_installations(
                explicit_executable=settings.mechanical_executable
            )
        )
        self._compatibility_provider = compatibility_provider
        self._connector = connector or PyMechanicalConnector()
        self._launcher = launcher or PyMechanicalLauncher()
        self._port_probe = port_probe
        self._connection = _not_tested(settings.mechanical_port)
        self._connection_lock = threading.Lock()
        self._owned_client: MechanicalClient | None = None
        self._connected_client: MechanicalClient | None = None

    def _environment(self) -> tuple[InstallationDiscovery, PyMechanicalCompatibility]:
        discovery = self._discovery_provider()
        compatibility = self._compatibility_provider(discovery.selected)
        return discovery, compatibility

    def status(self) -> AdapterStatus:
        if self._connection.process_verified and not self._connection_lock.locked():
            client = self._connected_client
            reachable = self._port_probe(
                "127.0.0.1",
                self._settings.mechanical_port,
                min(float(self._settings.connection_timeout_seconds), 1.0),
            )
            if client is None or not reachable:
                self._failure(
                    "PROCESS_NOT_REACHABLE",
                    "MECHANICAL_GRPC_PROCESS_NOT_REACHABLE",
                    "Önceden doğrulanan Mechanical gRPC prosesi artık erişilebilir değil.",
                )
            else:
                try:
                    if client.verify_valid_connection() is False:
                        raise ConnectionError("Mechanical connection rejected")
                except Exception:
                    self._failure(
                        "VERIFICATION_FAILED",
                        "PYMECHANICAL_CONNECTION_LOST",
                        "Önceden doğrulanan Mechanical bağlantısı artık geçerli değil.",
                    )
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
                "explicit_path_process_launch",
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
            "PROCESS_START_FAILED",
            "AUTHENTICATION_FAILED",
            "LICENSE_ERROR",
            "VERIFICATION_FAILED",
        ],
        code: str,
        message: str,
        *,
        started_by_bridge: bool = False,
    ) -> ConnectionTestResult:
        result = ConnectionTestResult(
            state=state,
            process_verified=False,
            license_verified=False,
            started_by_bridge=started_by_bridge,
            host="127.0.0.1",
            port=self._settings.mechanical_port,
            checked_at=datetime.now(UTC).isoformat(),
            mechanical_version=None,
            product_info=None,
            error_code=code,
            message=message,
        )
        self._connected_client = None
        self._connection = result
        return result

    def _exception_failure(
        self,
        exc: Exception,
        *,
        launching: bool,
        client_obtained: bool = False,
    ) -> ConnectionTestResult:
        lowered = f"{type(exc).__name__} {exc}".casefold()
        if "license" in lowered:
            return self._failure(
                "LICENSE_ERROR",
                "ANSYS_LICENSE_UNAVAILABLE",
                "Mechanical lisansı alınamadı veya mevcut lisans bağlantıya izin vermedi.",
                started_by_bridge=launching and client_obtained,
            )
        if "auth" in lowered or "wnua" in lowered or "credential" in lowered:
            return self._failure(
                "AUTHENTICATION_FAILED",
                "PYMECHANICAL_WNUA_AUTHENTICATION_FAILED",
                "Windows Named User Authentication ile Mechanical bağlantısı kurulamadı.",
                started_by_bridge=launching and client_obtained,
            )
        if launching:
            return self._failure(
                "PROCESS_START_FAILED",
                "MECHANICAL_EXPLICIT_PATH_LAUNCH_FAILED",
                (
                    "Mechanical doğrulanmış açık executable yolu ve AWP_ROOT ile başlatıldı "
                    "ancak gRPC prosesi doğrulanamadı. Lisans ve Mechanical başlangıç "
                    "günlüklerini kontrol edin."
                ),
                started_by_bridge=client_obtained,
            )
        return self._failure(
            "VERIFICATION_FAILED",
            "PYMECHANICAL_CONNECTION_FAILED",
            (
                "PyMechanical bağlantısı doğrulanamadı. Mechanical gRPC modu, sürüm, "
                "port ve servis paketi ayarlarını kontrol edin."
            ),
        )

    def _verify_client(
        self,
        client: MechanicalClient,
        discovery: InstallationDiscovery,
        *,
        started_by_bridge: bool,
    ) -> ConnectionTestResult:
        try:
            verification = client.verify_valid_connection()
            if verification is False:
                return self._failure(
                    "VERIFICATION_FAILED",
                    "PYMECHANICAL_CONNECTION_REJECTED",
                    "PyMechanical gerçek Mechanical bağlantısını doğrulamadı.",
                    started_by_bridge=started_by_bridge,
                )
            product_info = str(client.get_product_info()).strip()
            mechanical_version = str(client.version).strip()
            read_only = (
                str(
                    client.run_python_script(
                        "Ansys.ACT.Mechanical.MechanicalAPI.Instance.ReadOnlyMode"
                    )
                )
                .strip()
                .casefold()
            )
        except Exception as exc:  # PyMechanical exposes multiple runtime/gRPC exception types.
            return self._exception_failure(exc, launching=started_by_bridge, client_obtained=True)

        if not product_info or "ansys mechanical" not in product_info.casefold():
            return self._failure(
                "VERIFICATION_FAILED",
                "UNEXPECTED_MECHANICAL_PRODUCT_INFO",
                "Bağlanan proses doğrulanmış Ansys Mechanical ürün bilgisi döndürmedi.",
                started_by_bridge=started_by_bridge,
            )
        if started_by_bridge and (
            "preppost" in product_info.casefold()
            or "ansys mechanical []" in product_info.casefold()
        ):
            return self._failure(
                "LICENSE_ERROR",
                "MECHANICAL_STRUCTURAL_LICENSE_NOT_CHECKED_OUT",
                "Mechanical PrepPost veya boş ürün bildirdi; yapısal çözücü lisansı doğrulanmadı.",
                started_by_bridge=True,
            )
        if not mechanical_version:
            return self._failure(
                "VERIFICATION_FAILED",
                "MECHANICAL_VERSION_NOT_REPORTED",
                "Bağlanan Mechanical prosesi sürüm bilgisi döndürmedi.",
                started_by_bridge=started_by_bridge,
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
                started_by_bridge=started_by_bridge,
            )
        if read_only not in {"false", "0"}:
            return self._failure(
                "LICENSE_ERROR",
                "MECHANICAL_LICENSE_NOT_CHECKED_OUT",
                (
                    "Mechanical prosesi yalnızca salt-okunur durumda; kullanılabilir lisans "
                    "doğrulanamadı. Bridge lisans kontrolünü atlamaz."
                ),
                started_by_bridge=started_by_bridge,
            )

        result = ConnectionTestResult(
            state="VERIFIED",
            process_verified=True,
            # ReadOnlyMode only establishes a writable editor session. The solver's
            # structural/HPC entitlement is checked by the real solve, not here.
            license_verified=True,
            started_by_bridge=started_by_bridge,
            host="127.0.0.1",
            port=self._settings.mechanical_port,
            checked_at=datetime.now(UTC).isoformat(),
            mechanical_version=mechanical_version,
            product_info=product_info[:500],
            error_code=None,
            message=(
                "Gerçek Mechanical prosesi ve yazılabilir düzenleme oturumu doğrulandı; "
                "yapısal solver lisansı ancak gerçek çözümde doğrulanabilir."
            ),
        )
        self._connected_client = client
        self._connection = result
        return result

    def test_connection(self) -> ConnectionTestResult:
        if not self._connection_lock.acquire(blocking=False):
            return ConnectionTestResult(
                state="TEST_IN_PROGRESS",
                process_verified=False,
                license_verified=False,
                started_by_bridge=False,
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
            except Exception as exc:  # PyMechanical exposes multiple runtime/gRPC exception types.
                return self._exception_failure(exc, launching=False)
            return self._verify_client(client, discovery, started_by_bridge=False)
        finally:
            self._connection_lock.release()

    def launch_connection(self) -> ConnectionTestResult:
        if not self._connection_lock.acquire(blocking=False):
            return ConnectionTestResult(
                state="LAUNCH_IN_PROGRESS",
                process_verified=False,
                license_verified=False,
                started_by_bridge=False,
                host="127.0.0.1",
                port=self._settings.mechanical_port,
                checked_at=datetime.now(UTC).isoformat(),
                mechanical_version=None,
                product_info=None,
                error_code="MECHANICAL_LAUNCH_IN_PROGRESS",
                message="Başka bir Mechanical başlatma veya bağlantı testi devam ediyor.",
            )
        try:
            discovery, compatibility = self._environment()
            installation = discovery.selected
            if installation is None:
                return self._failure(
                    "INSTALLATION_NOT_FOUND",
                    "ANSYS_INSTALLATION_NOT_FOUND",
                    "Mechanical başlatılmadı; doğrulanmış yerel executable bulunamadı.",
                )
            if compatibility.state != "COMPATIBLE":
                return self._failure(
                    "INCOMPATIBLE",
                    compatibility.state,
                    compatibility.message,
                )
            if self._port_probe(
                "127.0.0.1",
                self._settings.mechanical_port,
                min(float(self._settings.connection_timeout_seconds), 1.0),
            ):
                return self._failure(
                    "VERIFICATION_FAILED",
                    "MECHANICAL_PORT_ALREADY_IN_USE",
                    (
                        "Hedef gRPC portu kullanımda; ikinci bir proses başlatılmadı. "
                        "Mevcut prosesi 'Gerçek bağlantıyı test et' ile doğrulayın."
                    ),
                )
            try:
                client = self._launcher.launch(
                    installation=installation,
                    host="127.0.0.1",
                    port=self._settings.mechanical_port,
                    timeout_seconds=self._settings.launch_timeout_seconds,
                    start_license=self._settings.start_license,
                )
            except Exception as exc:
                return self._exception_failure(exc, launching=True)

            result = self._verify_client(client, discovery, started_by_bridge=True)
            if result.process_verified:
                self._owned_client = client
            else:
                try:
                    client.exit(force=True)
                except Exception:
                    pass
            return result
        finally:
            self._connection_lock.release()

    def close(self) -> None:
        with self._connection_lock:
            client = self._owned_client
            self._owned_client = None
            if client is None:
                return
            try:
                client.exit(force=True)
            except Exception:
                # A user may have already closed the Mechanical process.
                pass
            finally:
                self._connected_client = None
                self._connection = _not_tested(self._settings.mechanical_port)

    def run_with_owned_client(self, action: Callable[[MechanicalClient], _T]) -> _T:
        # An externally connected Mechanical process may contain unsaved user work.
        # Static jobs clear a project, so they are allowed only in bridge-owned sessions.
        with self._connection_lock:
            client = self._owned_client
            if (
                client is None
                or client is not self._connected_client
                or not self._connection.process_verified
                or not self._connection.license_verified
            ):
                from .analysis import AnalysisError

                raise AnalysisError(
                    "BRIDGE_OWNED_SESSION_REQUIRED",
                    "Analiz için bridge tarafından başlatılmış ve doğrulanmış "
                    "Mechanical oturumu gerekli.",
                )
            return action(client)
