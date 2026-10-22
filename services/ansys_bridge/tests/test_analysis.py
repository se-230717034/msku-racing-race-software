from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import pytest
from msku_ansys_bridge.analysis import (
    AnalysisError,
    MeshConvergencePoint,
    StaticAnalysisManager,
    StaticAnalysisRequest,
    _ascii_project_path,
    _assess_mesh_convergence,
    _setup_script,
    _shape_check_in_solver_input,
    _si_quantity,
    _solver_failure,
    _solver_warning_summary,
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
        save_failure: bool = False,
        mesh_sequence: list[tuple[int, int]] | None = None,
        result_sequence: list[tuple[str, str]] | None = None,
        solver_type: str = "Direct",
    ) -> None:
        self.calls: list[str] = []
        self.nodes = nodes
        self.elements = elements
        self.solver_status = solver_status
        self.stress = stress
        self.deformation = deformation
        self.failure = failure
        self.configured_cores = configured_cores
        self.working_dir = working_dir or Path(
            "C:/ansys-test" if os.name == "nt" else "/tmp/ansys-test"
        )
        self.save_failure = save_failure
        self.mesh_sequence = mesh_sequence
        self.result_sequence = result_sequence
        self.solver_type = solver_type
        self.mesh_index = -1

    def clear(self) -> None:
        self.calls.append("clear")

    def run_python_script(self, script: str) -> str:
        self.calls.append(script)
        if self.failure is not None:
            raise self.failure
        if "AddGeometryImport" in script:
            return json.dumps(
                {
                    "bodies": 1,
                    "fixedFaces": 1,
                    "forceFaces": 1,
                    "solverType": self.solver_type,
                }
            )
        if "GenerateMesh()" in script:
            self.mesh_index += 1
            if self.mesh_sequence is not None:
                nodes, elements = self.mesh_sequence[self.mesh_index]
                return json.dumps({"nodes": nodes, "elements": elements})
            return json.dumps({"nodes": self.nodes, "elements": self.elements})
        if "SolveConfigurations['My Computer']" in script:
            return self.configured_cores
        if "Project.SaveAs(" in script:
            if self.save_failure:
                raise RuntimeError("SaveAs unavailable")
            return ""
        if "Solution.Solve(True)" in script:
            return json.dumps({"status": self.solver_status})
        if "MSKU_ANALYSIS.WorkingDir" in script:
            return str(self.working_dir)
        if "EvaluateAllResults()" in script:
            stress, deformation = self.stress, self.deformation
            if self.result_sequence is not None:
                stress, deformation = self.result_sequence[self.mesh_index]
            return json.dumps(
                {
                    "status": self.solver_status,
                    "stress": stress,
                    "deformation": deformation,
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
    assert "SolverType.Direct" in client.calls[1]
    assert "SHPP,ON,ALL" in client.calls[1]
    assert "CHECK" in client.calls[1]
    assert any("MaxNumberOfCores = 2" in call for call in client.calls)
    save_index = next(i for i, call in enumerate(client.calls) if "Project.SaveAs(" in call)
    solve_index = next(i for i, call in enumerate(client.calls) if "Solution.Solve(True)" in call)
    assert save_index < solve_index


@pytest.mark.parametrize("status", ["Failed", "SolveRequiredPartialResultsAvailable"])
def test_failed_solver_never_returns_results(tmp_path: Path, status: str) -> None:
    client = FakeMechanical(solver_status=status)
    with pytest.raises(AnalysisError, match="Mechanical çözümü başarıyla tamamlanmadı"):
        run_static_structural(client, request(tmp_path), lambda *_: None)
    assert not any("EvaluateAllResults()" in call for call in client.calls)


def test_solver_rejects_unconfirmed_core_limit(tmp_path: Path) -> None:
    client = FakeMechanical(configured_cores="4")
    with pytest.raises(AnalysisError) as failure:
        run_static_structural(client, request(tmp_path), lambda *_: None)
    assert failure.value.code == "SOLVE_CORE_CONFIGURATION_FAILED"
    assert not any("Solution.Solve(True)" in call for call in client.calls)


def test_solver_rejects_unconfirmed_direct_setting(tmp_path: Path) -> None:
    client = FakeMechanical(solver_type="Iterative")
    with pytest.raises(AnalysisError) as failure:
        run_static_structural(client, request(tmp_path), lambda *_: None)
    assert failure.value.code == "DIRECT_SOLVER_NOT_CONFIRMED"
    assert not any("Solution.Solve(True)" in call for call in client.calls)


def test_shape_check_script_is_well_formed(tmp_path: Path) -> None:
    script = _setup_script(request(tmp_path), tmp_path / "small.agdb")
    compile(script, "<mechanical-setup>", "exec")
    assert "MSKU_SHAPE_CHECK.Input = '/PREP7\\nSHPP,ON,ALL\\nCHECK\\n/SOLU'" in script


def test_shape_check_evidence_requires_both_commands(tmp_path: Path) -> None:
    assert not _shape_check_in_solver_input(tmp_path)
    (tmp_path / "ds.dat").write_text("/PREP7\nSHPP,ON,ALL\nCHECK\n/SOLU\n")
    assert _shape_check_in_solver_input(tmp_path)
    (tmp_path / "ds.dat").write_text("/PREP7\nSHPP,ON,ALL\n/SOLU\n")
    assert not _shape_check_in_solver_input(tmp_path)


def test_three_real_solve_contract_and_numeric_convergence(tmp_path: Path) -> None:
    payload = request(tmp_path).model_copy(update={"meshConvergenceSizesMm": [40.0, 30.0, 25.0]})
    client = FakeMechanical(
        mesh_sequence=[(300, 120), (500, 230), (700, 380)],
        result_sequence=[
            ("1060 [Pa]", "0.00022 [m]"),
            ("1010 [Pa]", "0.000205 [m]"),
            ("1000 [Pa]", "0.0002 [m]"),
        ],
    )
    result = run_static_structural(client, payload, lambda *_: None)
    assert sum("Solution.Solve(True)" in call for call in client.calls) == 3
    assert sum("GenerateMesh()" in call for call in client.calls) == 3
    assert sum("ClearGeneratedData()" in call for call in client.calls) == 2
    assert result.meshConvergence is not None
    assert result.meshConvergence.status == "PASSED_NUMERICALLY"
    assert result.meshConvergence.stressChangeRelative == pytest.approx(0.01)
    assert result.meshConvergence.deformationChangeRelative == pytest.approx(0.025)
    assert result.maximumVonMisesStressPa == 1000
    assert result.validationStatus == "NUMERIC_RESULT_UNVALIDATED_PHYSICALLY"


def test_nonmonotone_mesh_count_cannot_pass_numeric_convergence() -> None:
    points = [
        MeshConvergencePoint(
            meshSizeMm=size,
            meshNodes=nodes,
            meshElements=elements,
            maximumVonMisesStressPa=1000,
            maximumTotalDeformationM=0.0002,
        )
        for size, nodes, elements in [(40, 300, 100), (30, 500, 200), (25, 400, 150)]
    ]
    assert _assess_mesh_convergence(points).status == "NOT_CONVERGED"


def test_real_smoke_stress_trend_does_not_pass_numeric_convergence() -> None:
    # Independently recorded Student v261 results on pinned example CAD;
    # expected values are not generated by the production solver during this test.
    measured = [
        (500.0, 4464, 840, 253.5319357825563, 7.250757351503458e-9),
        (400.0, 8614, 1696, 264.88754152944796, 7.284751469556398e-9),
        (300.0, 14404, 2925, 278.7390026061557, 7.259030706281926e-9),
    ]
    points = [
        MeshConvergencePoint(
            meshSizeMm=size,
            meshNodes=nodes,
            meshElements=elements,
            maximumVonMisesStressPa=stress,
            maximumTotalDeformationM=deformation,
        )
        for size, nodes, elements, stress, deformation in measured
    ]
    assessment = _assess_mesh_convergence(points)
    assert assessment.status == "NOT_CONVERGED"
    assert assessment.stressChangeRelative == pytest.approx(0.049693300712133015)
    assert assessment.stressChangeRelative > assessment.coarseToMediumStressChangeRelative


def test_failed_later_student_precheck_returns_no_result(tmp_path: Path) -> None:
    payload = request(tmp_path).model_copy(update={"meshConvergenceSizesMm": [40.0, 30.0, 25.0]})
    client = FakeMechanical(mesh_sequence=[(300, 120), (128_001, 200)])
    with pytest.raises(AnalysisError) as failure:
        run_static_structural(client, payload, lambda *_: None)
    assert failure.value.code == "STUDENT_MESH_LIMIT_PRECHECK"
    assert sum("Solution.Solve(True)" in call for call in client.calls) == 1


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
    (tmp_path / filename).write_text(log + "license-server-secret")
    failure = _solver_failure(tmp_path, "SolveRequired")
    assert failure.code == expected_code
    assert "license-server-secret" not in failure.message


def test_unicode_working_dir_fails_before_solve(tmp_path: Path) -> None:
    working_dir = tmp_path / "Ünicode" / "Mechanical"
    working_dir.mkdir(parents=True)
    (working_dir / "file0.err").write_text(
        "The element option SOLID186 was not ordered or the appropriate product "
        "was not selected for this session.",
        encoding="utf-8",
    )
    client = FakeMechanical(solver_status="SolveRequired", working_dir=working_dir)
    with pytest.raises(AnalysisError) as failure:
        run_static_structural(client, request(tmp_path), lambda *_: None)
    assert failure.value.code == "ANSYS_ASCII_WORKDIR_NOT_CONFIRMED"
    assert "MSKU_ANALYSIS.WorkingDir" in client.calls
    assert "str(MSKU_ANALYSIS.WorkingDir)" not in client.calls
    assert not any("Solution.Solve(True)" in call for call in client.calls)


def test_project_directory_rejects_unicode_override(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    directory = tmp_path / "çalışma"
    directory.mkdir()
    monkeypatch.setenv("MSKU_ANSYS_PROJECT_DIRECTORY", str(directory))
    with pytest.raises(AnalysisError) as failure:
        _ascii_project_path()
    assert failure.value.code == "ANSYS_ASCII_PROJECT_DIRECTORY_REQUIRED"


def test_default_project_path_is_local_ascii(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MSKU_ANSYS_PROJECT_DIRECTORY", raising=False)
    project = Path(_ascii_project_path())
    assert project.is_absolute()
    assert str(project).isascii()
    assert project.parent.is_dir()
    assert project.suffix == ".mechdb"


def test_explicit_ascii_project_directory(monkeypatch: pytest.MonkeyPatch) -> None:
    ascii_directory = str(Path(_ascii_project_path()).parent)
    monkeypatch.setenv("MSKU_ANSYS_PROJECT_DIRECTORY", ascii_directory)
    assert Path(_ascii_project_path()).parent == Path(ascii_directory)


def test_save_as_failure_stops_before_solve(tmp_path: Path) -> None:
    client = FakeMechanical(save_failure=True)
    with pytest.raises(AnalysisError) as failure:
        run_static_structural(client, request(tmp_path), lambda *_: None)
    assert failure.value.code == "ANSYS_PROJECT_SAVE_FAILED"
    assert not any("Solution.Solve(True)" in call for call in client.calls)


def test_solver_warning_count_is_sanitized(tmp_path: Path) -> None:
    (tmp_path / "solve.out").write_text(
        "license-server-secret\nNUMBER OF WARNING MESSAGES ENCOUNTERED= 3\n"
    )
    warnings = _solver_warning_summary(tmp_path)
    assert len(warnings) == 1
    assert "3 uyarı" in warnings[0]
    assert "license-server-secret" not in warnings[0]


def test_solver_high_risk_warnings_are_visible_but_raw_log_is_not(tmp_path: Path) -> None:
    (tmp_path / "solve.out").write_text("NUMBER OF WARNING MESSAGES ENCOUNTERED= 3\n")
    (tmp_path / "file0.err").write_text(
        "C:\\private\\CAD\\secret.agdb\n"
        "Element shape checking is currently inactive. Issue SHPP,ON.\n"
        "It has been detected that you are using reduced integration brick\n"
        "elements along with the PCG solver (EQSLV,PCG).\n"
    )
    warnings = _solver_warning_summary(tmp_path)
    assert len(warnings) == 3
    assert "şekil denetimi kapalı" in warnings[1]
    assert "azaltılmış integrasyonlu" in warnings[2]
    assert all("secret.agdb" not in warning for warning in warnings)


def test_missing_material_warning_is_sanitized_and_not_dismissed(tmp_path: Path) -> None:
    (tmp_path / "file0.err").write_text(
        "Material number 11 (used by element 1741) should normally have at least "
        "\n one MP or one TB type command associated with it. secret-hostname"
    )
    warnings = _solver_warning_summary(tmp_path)
    assert len(warnings) == 1
    assert "MP/TB" in warnings[0]
    assert "secret-hostname" not in warnings[0]


def test_pcg_warning_rejects_result_even_after_done(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "msku_ansys_bridge.analysis._solver_warning_summary",
        lambda _workdir: ["MAPDL: azaltılmış integrasyonlu brick elemanlar PCG ile kullanıldı;"],
    )
    client = FakeMechanical()
    with pytest.raises(AnalysisError) as failure:
        run_static_structural(client, request(tmp_path), lambda *_: None)
    assert failure.value.code == "DIRECT_SOLVER_NOT_USED"


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
    for sizes in ([25, 30, 40], [40, 30], [40, 30, 20], [40, float("nan"), 25]):
        with pytest.raises(ValidationError):
            StaticAnalysisRequest.model_validate({**valid, "meshConvergenceSizesMm": sizes})


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
