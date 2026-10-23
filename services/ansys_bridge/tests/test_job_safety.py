from __future__ import annotations

import threading
import time
from pathlib import Path

import pytest
from msku_ansys_bridge.analysis import (
    AnalysisError,
    StaticAnalysisManager,
    StaticAnalysisRequest,
)
from msku_ansys_bridge.modal import ModalAnalysisManager, ModalAnalysisRequest


class BlockingAdapter:
    def __init__(self) -> None:
        self.entered = threading.Event()
        self.release = threading.Event()
        self.quarantined = False

    def assert_ready_for_job(self) -> None:
        if self.quarantined:
            raise AnalysisError("MECHANICAL_TIMEOUT_RESTART_REQUIRED", "Quarantined")

    def quarantine_timeout(self) -> None:
        self.quarantined = True

    def run_with_owned_client(self, _action: object) -> None:
        self.entered.set()
        self.release.wait(2)
        raise RuntimeError("late raw Mechanical path C:/private/model.agdb")


@pytest.mark.parametrize("kind", ["static", "modal"])
def test_stage_timeout_rejects_late_result_and_requires_new_session(
    tmp_path: Path, kind: str
) -> None:
    cad = tmp_path / "sample.agdb"
    cad.write_bytes(b"test fixture, not a real solve")
    adapter = BlockingAdapter()
    if kind == "static":
        manager = StaticAnalysisManager(adapter, stage_timeout_seconds=0.05)  # type: ignore[arg-type]
        request = StaticAnalysisRequest(
            geometryPath=str(cad),
            fixedNamedSelection="NS_Fixed",
            forceNamedSelection="NS_Force",
            forceAxis="X",
            forceN=1000,
            meshSizeMm=25,
        )
    else:
        manager = ModalAnalysisManager(adapter, stage_timeout_seconds=0.05)  # type: ignore[arg-type]
        request = ModalAnalysisRequest(
            geometryPath=str(cad),
            fixedNamedSelection="NS_Fixed",
            meshSizeMm=25,
            modeCount=3,
        )
    started = manager.start(request)
    assert adapter.entered.wait(1)
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        job = manager.snapshot(started.jobId)
        if job is not None and job.state == "FAILED":
            break
        time.sleep(0.01)
    assert job is not None
    assert job.state == "FAILED"
    assert job.errorCode == "MECHANICAL_STAGE_TIMEOUT"
    assert job.result is None
    assert adapter.quarantined is True
    assert manager.report_source(started.jobId) is None
    with pytest.raises(AnalysisError, match="Quarantined"):
        manager.start(request)
    adapter.release.set()
    time.sleep(0.03)
    assert manager.snapshot(started.jobId).errorCode == "MECHANICAL_STAGE_TIMEOUT"  # type: ignore[union-attr]
    assert "C:/private" not in manager.snapshot(started.jobId).message  # type: ignore[union-attr]
