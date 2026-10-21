from __future__ import annotations

import pytest
from msku_ansys_bridge.config import BridgeSettings


def test_start_license_defaults_to_auto(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MSKU_ANSYS_START_LICENSE", raising=False)
    assert BridgeSettings.from_environment().start_license == "auto"


@pytest.mark.parametrize("value", ["none", "aa_t_i", "ansys", "mech_1", "mech_2"])
def test_start_license_accepts_documented_keywords(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    monkeypatch.setenv("MSKU_ANSYS_START_LICENSE", value)
    assert BridgeSettings.from_environment().start_license == value


@pytest.mark.parametrize("value", ["preppost", "-p ansys", "ansys extra", "aa_s"])
def test_start_license_rejects_unsupported_or_non_solver_values(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    monkeypatch.setenv("MSKU_ANSYS_START_LICENSE", value)
    with pytest.raises(ValueError, match="MSKU_ANSYS_START_LICENSE"):
        BridgeSettings.from_environment()
