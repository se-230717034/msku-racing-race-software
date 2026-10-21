from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import pytest
from msku_ansys_bridge.analysis import (
    AnalysisError,
    StaticAnalysisManager,
    StaticAnalysisRequest,
    _si_quantity,
    run_static_structural,
)
from pydantic import ValidationError


def request(tmp_path: Path) -> StaticAnalysisRequest:
    geometry = tmp_path / "small.agdb"
    geometry.write_bytes(b"test-only CAD placeholder")
    return StaticAnalysisRequest(
        geometryPath=str(geometry),
        fixedNamedSelection="NS_Fixed",
        forceNamedSelection="NS_Force",
        forceAxis="X",
        forceN=1000,
        meshSizeMm=25,
    )


class FakeMechanical:
    version = 261

    def __init__(
        self,
        *,
        nodes: int = 500,
        elements: int = 200,
        solver_status: str = "Done",
        stress: str = "1250 [Pa]",
        deformation: str = "0.0002 [m]",
        failure: Exception | None = None,
        configured_cores: str = "2",
        working_dir: Path | None = None,
    ) -> None:
        self.calls: list[str] = []
        self.nodes = nodes
        self.elements = elements
        self.solver_status = solver_status
        self.stress = stress
        self.deformation = deformation
        self.failure = failure
        self.configured_cores = configured_cores
        self.working_dir = working_dir

    def clear(self) -> None:
        self.calls.append("clear")

    def run_python_script(self, script: str) -> str:
        self.calls.append(script)
        if self.failure is not None:
            raise self.failure
        if "AddGeometryImport" in script:
            return json.dumps({"bodies": 1, "fixedFaces": 1, "forceFaces": 1})
        if "GenerateMesh()" in script:
            return json.dumps({"nodes": self.nodes, "elements": self.elements})
        if "SolveConfigurations['My Computer']" in script:
            return self.configured_cores
        if "Solution.Solve(True)" in script:
            return json.dumps({"status": self.solver_status})
        if "MSKU_ANALYSIS.WorkingDir" in script:
            return str(self.working_dir) if self.working_dir is not None else "?"
        if "EvaluateAllResults()" in script:
            return json.dumps(
                {
                    "status": self.solver_status,
                    "stress": self.stress,
                    "deformation": self.deformation,
                }
            )
        raise AssertionError("unexpected Mechanical script")

    def get_product_info(self) -> str:
        return "Ansys Mechanical [Ansys Mechanical Enterprise]\nProduct Version:261"

    def verify_valid_connection(self) -> bool:
        return True

    def exit(self, force: bool = False) -> None:
        pass


class FakeOwnedAdapter:
    def __init__(self, client: FakeMechanical) -> None:
        self.client = client

    def run_with_owned_client(self, action: Any) -> Any:
        return action(self.client)


def test_real_workflow_contract_extracts_only_solver_values(tmp_path: Path) -> None:
    client = FakeMechanical()
    stages: list[str] = []
    payload = request(tmp_path)

    result = run_static_structural(client, payload, lambda stage, _message: stages.append(stage))

    assert stages == ["importing", "meshing", "solving", "extracting"]
    assert result.solverStatus == "Done"
    assert result.maximumVonMisesStressPa == 1250
    assert result.maximumTotalDeformationM == 0.0002
    assert result.meshNodes == 500
    assert result.meshElements == 200
    assert result.geometrySha256 != ""
    assert result.validationStatus == "NUMERIC_RESULT_UNVALIDATED_PHYSICALLY"
    assert result.forceN == 1000
    assert client.calls[0] == "clear"
    assert "'NS_Fixed'" in client.calls[1]
    assert "'NS_Force'" in client.calls[1]
    assert "1000.0" in client.calls[1]
    assert any("MaxNumberOfCores = 2" in call for call in client.calls)


def test_failed_solver_never_returns_results(tmp_path: Path) -> None:
    client = FakeMechanical(solver_status="Failed")
    with pytest.raises(AnalysisError, match="Mechanical çözümü başarıyla tamamlanmadı"):
        run_static_structural(client, request(tmp_path), lambda *_: None)
    assert not any("EvaluateAllResults()" in call for call in client.calls)


def test_solver_rejects_unconfirmed_core_limit(tmp_path: Path) -> None:
    client = FakeMechanical(configured_cores="4")
    with pytest.raises(AnalysisError) as failure:
        run_static_structural(client, request(tmp_path), lambda *_: None)
    assert failure.value.code == "SOLVE_CORE_CONFIGURATION_FAILED"
    assert not any("Solution.Solve(True)" in call for call in client.calls)


@pytest.mark.parametrize(
    ("filename", "log", "expected_code"),
    [
        (
            "solve.out",
            "*** ERROR - Insufficient HPC licenses available.",
            "ANSYS_HPC_LICENSE_LIMIT",
        ),
        (
            "file0.err",
            "The element option SOLID186 was either not ordered with this Ansys "
            "installation or the appropriate product was not selected for this session.",
            "ANSYS_STRUCTURAL_PRODUCT_UNAVAILABLE",
        ),
    ],
)
def test_solver_log_is_classified_without_leaking_raw_details(
    tmp_path: Path, filename: str, log: str, expected_code: str
) -> None:
    secret = "license-server-secret"
    (tmp_path / filename).write_text(log + secret)
    client = FakeMechanical(solver_status="SolveRequired", working_dir=tmp_path)
    with pytest.raises(AnalysisError) as failure:
        run_static_structural(client, request(tmp_path), lambda *_: None)
    assert failure.value.code == expected_code
    assert secret not in failure.value.message
    assert not any("EvaluateAllResults()" in call for call in client.calls)


def test_unicode_working_dir_log_is_read_before_failed_solve(tmp_path: Path) -> None:
    working_dir = tmp_path / "Yaşar" / "Mechanical"
    working_dir.mkdir(parents=True)
    (working_dir / "file0.err").write_text(
        "The element option SOLID186 was not ordered or the appropriate product "
        "was not selected for this session.",
        encoding="utf-8",
    )
    client = FakeMechanical(solver_status="SolveRequired", working_dir=working_dir)
    with pytest.raises(AnalysisError) as failure:
        run_static_structural(client, request(tmp_path), lambda *_: None)
    assert failure.value.code == "ANSYS_STRUCTURAL_PRODUCT_UNAVAILABLE"
    assert "MSKU_ANALYSIS.WorkingDir" in client.calls
    assert "str(MSKU_ANALYSIS.WorkingDir)" not in client.calls
    assert client.calls.index("MSKU_ANALYSIS.WorkingDir") < next(
        index for index, call in enumerate(client.calls) if "Solution.Solve(True)" in call
    )


def test_student_mesh_precheck_stops_before_solve(tmp_path: Path) -> None:
    client = FakeMechanical(nodes=128_001)
    with pytest.raises(AnalysisError) as failure:
        run_static_structural(client, request(tmp_path), lambda *_: None)
    assert failure.value.code == "STUDENT_MESH_LIMIT_PRECHECK"
    assert not any("Solution.Solve(True)" in call for call in client.calls)


@pytest.mark.parametrize("value", ["1250 [MPa]", "nan [Pa]", "-2 [Pa]", "1250"])
def test_results_reject_wrong_units_and_invalid_values(value: str) -> None:
    with pytest.raises(AnalysisError):
        _si_quantity(value, "Pa")


def test_request_rejects_zero_force_overlapping_selection_and_extra_fields(tmp_path: Path) -> None:
    valid = request(tmp_path).model_dump()
    with pytest.raises(ValidationError):
        StaticAnalysisRequest.model_validate({**valid, "forceN": 0})
    with pytest.raises(ValidationError):
        StaticAnalysisRequest.model_validate({**valid, "forceNamedSelection": "NS_Fixed"})
    with pytest.raises(ValidationError):
        StaticAnalysisRequest.model_validate({**valid, "script": "arbitrary()"})


def test_manager_reports_failure_without_mock_fallback_or_raw_secret(tmp_path: Path) -> None:
    client = FakeMechanical(failure=RuntimeError("license server=secret"))
    manager = StaticAnalysisManager(FakeOwnedAdapter(client))
    started = manager.start(request(tmp_path))
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        job = manager.snapshot(started.jobId)
        if job is not None and job.state == "FAILED":
            break
        time.sleep(0.01)
    assert job is not None
    assert job.state == "FAILED"
    assert job.result is None
    assert job.errorCode == "ANSYS_LICENSE_ERROR"
    assert "secret" not in job.message


def test_missing_cad_selection_is_a_specific_safe_failure(tmp_path: Path) -> None:
    client = FakeMechanical(failure=RuntimeError("MSKU_FIXED_SELECTION_MISSING_OR_EMPTY:secret"))
    manager = StaticAnalysisManager(FakeOwnedAdapter(client))
    started = manager.start(request(tmp_path))
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        job = manager.snapshot(started.jobId)
        if job is not None and job.state == "FAILED":
            break
        time.sleep(0.01)
    assert job is not None
    assert job.errorCode == "FIXED_SELECTION_MISSING"
    assert job.result is None
    assert "secret" not in job.message
