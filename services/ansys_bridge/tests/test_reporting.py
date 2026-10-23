from __future__ import annotations

from pathlib import Path

import pytest
from msku_ansys_bridge.analysis import (
    MeshConvergenceAssessment,
    MeshConvergencePoint,
    MeshQualityEvidence,
    StaticAnalysisRequest,
    StaticAnalysisResult,
    StaticJobResponse,
)
from msku_ansys_bridge.modal import (
    ModalAnalysisRequest,
    ModalAnalysisResult,
    ModalJobResponse,
    ModalMode,
)
from msku_ansys_bridge.reporting import build_modal_report, build_static_report
from pydantic import ValidationError


def _static_job() -> StaticJobResponse:
    result = StaticAnalysisResult(
        solverStatus="Done",
        maximumVonMisesStressPa=278.7390026061557,
        maximumTotalDeformationM=7.259030706281926e-9,
        meshNodes=14_404,
        meshElements=2_925,
        resultFileBytes=1024,
        geometrySha256="a" * 64,
        material="Structural Steel",
        fixedNamedSelection="NS_FIXED",
        forceNamedSelection="NS_FORCE",
        forceAxis="Z",
        forceN=100,
        bodyCount=1,
        fixedScopeEntityCount=2,
        forceScopeEntityCount=1,
        meshSizeMm=300,
        mechanicalVersion="261",
        productInfo="Ansys Mechanical Student",
        shapeCheckInSolverInput=True,
        meshQuality=MeshQualityEvidence(
            status="MEASURED_BY_MECHANICAL", minimum=0.2, average=0.6, maximum=0.9
        ),
        meshConvergence=MeshConvergenceAssessment(
            status="NOT_CONVERGED",
            toleranceRelative=0.05,
            coarseToMediumStressChangeRelative=(264.88754152944796 - 253.5319357825563)
            / 264.88754152944796,
            coarseToMediumDeformationChangeRelative=(7.284751469556398e-9 - 7.250757351503458e-9)
            / 7.284751469556398e-9,
            stressChangeRelative=(278.7390026061557 - 264.88754152944796) / 278.7390026061557,
            deformationChangeRelative=(7.284751469556398e-9 - 7.259030706281926e-9)
            / 7.259030706281926e-9,
            meshCountsIncrease=True,
            points=[
                MeshConvergencePoint(
                    meshSizeMm=size,
                    meshNodes=nodes,
                    meshElements=elements,
                    resultFileBytes=1024,
                    maximumVonMisesStressPa=stress,
                    maximumTotalDeformationM=deformation,
                )
                for size, nodes, elements, stress, deformation in (
                    (500, 4_464, 840, 253.5319357825563, 7.250757351503458e-9),
                    (400, 8_614, 1_696, 264.88754152944796, 7.284751469556398e-9),
                    (300, 14_404, 2_925, 278.7390026061557, 7.259030706281926e-9),
                )
            ],
        ),
        warnings=["Fiziksel olarak doğrulanmadı."],
    )
    return StaticJobResponse(
        jobId="11111111-1111-4111-8111-111111111111",
        state="SUCCEEDED",
        stage="done",
        message="Done",
        startedAt="2026-10-22T10:00:00Z",
        completedAt="2026-10-22T10:01:00Z",
        result=result,
    )


def _static_request() -> StaticAnalysisRequest:
    return StaticAnalysisRequest(
        geometryPath=str(Path("C:/private/vehicle.agdb")),
        fixedNamedSelection="NS_FIXED",
        forceNamedSelection="NS_FORCE",
        forceN=100,
        meshSizeMm=300,
        meshConvergenceSizesMm=[500, 400, 300],
    )


def test_static_report_preserves_not_converged_and_privacy() -> None:
    report = build_static_report(_static_request(), _static_job())
    assert report.releaseReadiness == "BLOCKED"
    assert report.physicalValidation == "UNVERIFIED"
    assert report.approvedForEngineeringUse is False
    assert {check.code: check.status for check in report.checks}[
        "STATIC_MESH_CONVERGENCE"
    ] == "BLOCKED"
    assert {check.code: check.status for check in report.checks}[
        "LOAD_APPLICATION_POINT"
    ] == "UNVERIFIED"
    exported = report.model_dump_json()
    assert "C:/private" not in exported
    assert "geometryPath" not in exported
    assert "278.7390026061557" in exported


def test_static_report_rejects_missing_result_file_and_failed_job() -> None:
    job = _static_job()
    assert job.result is not None
    job.result.resultFileBytes = 0
    with pytest.raises(ValueError, match="result file"):
        build_static_report(_static_request(), job)
    job = _static_job()
    job.state = "FAILED"
    with pytest.raises(ValueError, match="completed accepted"):
        build_static_report(_static_request(), job)


def test_static_report_recomputes_convergence_and_rejects_false_pass() -> None:
    job = _static_job()
    assert job.result is not None and job.result.meshConvergence is not None
    job.result.meshConvergence.status = "PASSED_NUMERICALLY"
    with pytest.raises(ValueError, match="contradicts"):
        build_static_report(_static_request(), job)


def test_static_report_rejects_result_that_disagrees_with_request() -> None:
    job = _static_job()
    assert job.result is not None
    job.result.forceN = 200
    with pytest.raises(ValueError, match="provenance"):
        build_static_report(_static_request(), job)


def test_modal_report_retains_unverified_mesh_and_physics() -> None:
    request = ModalAnalysisRequest(
        geometryPath="C:/private/vehicle.agdb",
        fixedNamedSelection="NS_FIXED",
        meshSizeMm=300,
        modeCount=2,
    )
    result = ModalAnalysisResult(
        modes=[ModalMode(modeNumber=1, frequencyHz=12), ModalMode(modeNumber=2, frequencyHz=34)],
        meshNodes=100,
        meshElements=50,
        resultFileBytes=1024,
        bodyCount=1,
        fixedScopeEntityCount=2,
        meshSizeMm=300,
        meshQuality=MeshQualityEvidence(status="UNAVAILABLE"),
        geometrySha256="b" * 64,
        material="Structural Steel",
        fixedNamedSelection="NS_FIXED",
        mechanicalVersion="261",
        productInfo="Ansys Mechanical Student",
        shapeCheckInSolverInput=False,
    )
    job = ModalJobResponse(
        jobId="22222222-2222-4222-8222-222222222222",
        state="SUCCEEDED",
        stage="done",
        message="Done",
        startedAt="2026-10-22T10:00:00Z",
        completedAt="2026-10-22T10:01:00Z",
        result=result,
    )
    report = build_modal_report(request, job)
    checks = {check.code: check.status for check in report.checks}
    assert checks["MODAL_FREQUENCIES_HZ"] == "VERIFIED"
    assert checks["MODAL_MESH_CONVERGENCE"] == "UNVERIFIED"
    assert checks["PHYSICAL_CORRELATION"] == "UNVERIFIED"
    assert report.releaseReadiness == "BLOCKED"
    assert "C:/private" not in report.model_dump_json()


def test_force_application_point_cannot_be_claimed_without_transfer() -> None:
    payload = _static_request().model_dump()
    payload["forceApplicationPointVehicleM"] = {"x": 0.1, "y": 0.2, "z": 0.3}
    with pytest.raises(ValidationError, match="CAD çerçevesi"):
        StaticAnalysisRequest.model_validate(payload)
