from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol


@dataclass(frozen=True, slots=True)
class AdapterStatus:
    adapter: Literal["mock"]
    state: Literal["MOCK_READY"]
    ansys_connected: bool
    simulations_enabled: bool
    capabilities: tuple[str, ...]
    message: str


class AnsysAdapter(Protocol):
    """Boundary that a future, explicitly local ANSYS adapter must implement."""

    def status(self) -> AdapterStatus: ...


class MockAnsysAdapter:
    """Phase 1 adapter. It never imports, launches, or calls ANSYS."""

    def status(self) -> AdapterStatus:
        return AdapterStatus(
            adapter="mock",
            state="MOCK_READY",
            ansys_connected=False,
            simulations_enabled=False,
            capabilities=("health_check", "connection_contract"),
            message="Mock adapter hazır; gerçek ANSYS bağlantısı ve simülasyonu uygulanmadı.",
        )
