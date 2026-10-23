from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from msku_ansys_bridge.analysis import AnalysisError
from msku_ansys_bridge.modal import ModalAnalysisRequest, run_modal_analysis
from pydantic import ValidationError


def _ascii_alias(path: Path) -> Path:
    if os.name != "nt":
        return path
    import ctypes

    home = Path.home()
    buffer = ctypes.create_unicode_buffer(4096)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    count = kernel.GetShortPathNameW(str(home), buffer, len(buffer))
    if not count:
        raise RuntimeError("Windows test user profile has no ASCII short path")
    return Path(str(path).replace(str(home), buffer.value, 1))


class ModalMechanical:
    version = 261

    def __init__(self, working_dir: Path) -> None:
        self.calls: list[str] = []
        self.working_dir = _ascii_alias(working_dir)
        self.nodes = 1000
        self.status = "Done"
        self.frequencies: list[str] = ["12.5 [Hz]", "35.0 [Hz]", "40.0 [Hz]"]
        (working_dir / "file.rst").write_bytes(b"real-solver-fixture")

    def clear(self) -> None:
        self.calls.append("clear")

    def get_product_info(self) -> str:
        return "Ansys Mechanical [Student]"

    def run_python_script(self, script: str) -> str:
        self.calls.append(script)
        if "AddModalAnalysis()" in script:
            return json.dumps(
                {"bodies": 1, "fixedFaces": 1, "configuredModes": 3, "studioHardpoints": 0}
            )
        if "MaxNumberOfCores = 2" in script:
            return "2"
        if "Project.SaveAs" in script:
            return ""
        if "MSKU_ANALYSIS.WorkingDir" in script:
            return str(self.working_dir)
        if "GenerateMesh()" in script:
            return json.dumps({"nodes": self.nodes, "elements": 500})
        if "ComputeMeshQualityMetrics()" in script:
            return json.dumps({"minimum": "0.12", "average": "0.6", "maximum": "0.95"})
        if "Solution.Solve(True)" in script:
            return json.dumps({"status": self.status})
        if "EvaluateAllResults()" in script:
            return json.dumps({"status": self.status, "frequencies": self.frequencies})
        raise AssertionError("unexpected Mechanical call")


def request(tmp_path: Path) -> ModalAnalysisRequest:
    cad = tmp_path / "test.agdb"
    cad.write_bytes(b"synthetic test CAD bytes")
    return ModalAnalysisRequest(
        geometryPath=str(cad),
        fixedNamedSelection="NS_Fixed",
        meshSizeMm=25,
        modeCount=3,
    )


def test_modal_contract_returns_only_real_client_frequencies(tmp_path: Path) -> None:
    mechanical = ModalMechanical(tmp_path)
    result = run_modal_analysis(mechanical, request(tmp_path), lambda *_: None)
    assert [mode.frequencyHz for mode in result.modes] == [12.5, 35, 40]
    assert result.validationStatus == "NUMERIC_RESULT_UNVALIDATED_PHYSICALLY"
    assert result.meshConvergenceStatus == "NOT_ASSESSED"
    assert result.meshQuality.minimum == 0.12
    assert result.meshQuality.status == "MEASURED_BY_MECHANICAL"
    assert result.resultFileBytes > 0
    assert any("AddModalAnalysis()" in call for call in mechanical.calls)
    assert any("MaximumModesToFind = 3" in call for call in mechanical.calls)
    assert any("MaxNumberOfCores = 2" in call for call in mechanical.calls)
    assert not any("AddForce()" in call for call in mechanical.calls)


@pytest.mark.parametrize(
    ("frequencies", "expected_code"),
    [
        (["0 [Hz]", "35 [Hz]", "40 [Hz]"], "MODAL_FREQUENCY_INVALID"),
        (["12 [Hz]", "35 [Hz]", "40 [s]"], "RESULT_UNIT_UNEXPECTED"),
        (["40 [Hz]", "35 [Hz]", "12 [Hz]"], "MODAL_FREQUENCY_ORDER"),
        (["12 [Hz]"], "MODAL_FREQUENCIES_MISSING"),
    ],
)
def test_modal_rejects_invalid_or_missing_frequency(
    tmp_path: Path, frequencies: list[str], expected_code: str
) -> None:
    mechanical = ModalMechanical(tmp_path)
    mechanical.frequencies = frequencies
    with pytest.raises(AnalysisError) as failure:
        run_modal_analysis(mechanical, request(tmp_path), lambda *_: None)
    assert failure.value.code == expected_code


def test_modal_failed_solve_and_student_limit_never_return_result(tmp_path: Path) -> None:
    mechanical = ModalMechanical(tmp_path)
    mechanical.nodes = 128_001
    with pytest.raises(AnalysisError) as failure:
        run_modal_analysis(mechanical, request(tmp_path), lambda *_: None)
    assert failure.value.code == "STUDENT_MESH_LIMIT_PRECHECK"
    assert not any("Solution.Solve(True)" in call for call in mechanical.calls)
    mechanical = ModalMechanical(tmp_path)
    mechanical.status = "SolveRequired"
    with pytest.raises(AnalysisError):
        run_modal_analysis(mechanical, request(tmp_path), lambda *_: None)


def test_modal_input_rejects_script_injection_and_unsupported_mode_count(
    tmp_path: Path,
) -> None:
    valid = request(tmp_path).model_dump()
    with pytest.raises(ValidationError):
        ModalAnalysisRequest.model_validate({**valid, "modeCount": 7})
    with pytest.raises(ValidationError):
        ModalAnalysisRequest.model_validate({**valid, "fixedNamedSelection": "NS\nimport os"})
    with pytest.raises(ValidationError):
        ModalAnalysisRequest.model_validate({**valid, "script": "print(1)"})


def test_modal_setup_uses_quoted_local_path(tmp_path: Path) -> None:
    from msku_ansys_bridge.modal import _modal_setup_script

    request_value = request(tmp_path)
    script = _modal_setup_script(request_value, Path(request_value.geometryPath))
    compile(script, "<modal setup>", "exec")
    assert "AddModalAnalysis()" in script
    assert "SHPP,ON,ALL" in script
    assert "NS_Fixed" in script


def test_modal_result_requires_nonempty_rst(tmp_path: Path) -> None:
    mechanical = ModalMechanical(tmp_path)
    (tmp_path / "file.rst").write_bytes(b"")
    with pytest.raises(AnalysisError) as failure:
        run_modal_analysis(mechanical, request(tmp_path), lambda *_: None)
    assert failure.value.code == "MODAL_RESULT_FILE_MISSING"


def test_missing_material_failure_is_sanitized_without_numeric_result(tmp_path: Path) -> None:
    from msku_ansys_bridge.modal import ModalAnalysisManager, ModalJobResponse

    class MissingMaterialAdapter:
        def run_with_owned_client(self, _operation: object) -> None:
            raise RuntimeError("Material Structural Steel missing at C:/private/CAD/part.agdb")

    manager = ModalAnalysisManager(MissingMaterialAdapter())  # type: ignore[arg-type]
    manager._job = ModalJobResponse(
        jobId="test", state="QUEUED", stage="queued", message="queued", startedAt="now"
    )
    manager._work(request(tmp_path))
    result = manager.snapshot("test")
    assert result is not None
    assert result.state == "FAILED"
    assert result.errorCode == "MATERIAL_NOT_AVAILABLE"
    assert result.result is None
    assert "C:/private" not in result.message
