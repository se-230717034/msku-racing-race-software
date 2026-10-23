"""Evidence-led, non-approving local ANSYS technical reports.

Reports deliberately contain no local CAD path, credential, license-server address,
or invented physical validation. They exist only for accepted real solver jobs.
"""

from __future__ import annotations

import math
import re
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .analysis import (
    MESH_CONVERGENCE_TOLERANCE_RELATIVE,
    MeshQualityEvidence,
    StaticAnalysisRequest,
    StaticJobResponse,
)
from .modal import ModalAnalysisRequest, ModalJobResponse

EvidenceStatus = Literal["VERIFIED", "UNVERIFIED", "BLOCKED"]


class EvidenceCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    status: EvidenceStatus
    observation: str
    limitation: str | None = None


class TechnicalReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schemaVersion: Literal["1.0"] = "1.0"
    reportType: Literal["LOCAL_ANSYS_NUMERICAL_EVIDENCE"] = "LOCAL_ANSYS_NUMERICAL_EVIDENCE"
    analysisType: Literal["STATIC_STRUCTURAL", "MODAL"]
    generatedAt: str
    jobId: str
    jobStartedAt: str
    jobCompletedAt: str
    releaseReadiness: Literal["BLOCKED"] = "BLOCKED"
    physicalValidation: Literal["UNVERIFIED"] = "UNVERIFIED"
    approvedForEngineeringUse: Literal[False] = False
    inputProvenance: dict[str, Any]
    solverResult: dict[str, Any]
    checks: list[EvidenceCheck]
    unresolvedItems: list[str]
    warnings: list[str] = Field(default_factory=list)


def _check(
    code: str, status: EvidenceStatus, observation: str, limitation: str | None = None
) -> EvidenceCheck:
    return EvidenceCheck(code=code, status=status, observation=observation, limitation=limitation)


def _input_without_path(request: StaticAnalysisRequest | ModalAnalysisRequest) -> dict[str, Any]:
    # The CAD content hash in the solver result identifies the input bytes.
    # Absolute paths are private local metadata and must never enter the export.
    return request.model_dump(mode="json", exclude={"geometryPath"})


def _common_checks(
    *,
    solver_status: str,
    result_bytes: int,
    geometry_hash: str,
    mesh_quality: MeshQualityEvidence,
    shape_check: bool,
    studio_status: str | None,
    body_count: int,
    fixed_count: int,
) -> list[EvidenceCheck]:
    if solver_status.split(".")[-1] != "Done" or result_bytes <= 0:
        raise ValueError("A completed real solver result file is required for a technical report")
    if re.fullmatch(r"[0-9a-f]{64}", geometry_hash) is None or body_count <= 0 or fixed_count <= 0:
        raise ValueError("CAD and boundary-scope runtime evidence is incomplete")
    measured_quality = mesh_quality.status == "MEASURED_BY_MECHANICAL"
    if measured_quality and not (
        mesh_quality.minimum is not None
        and mesh_quality.average is not None
        and mesh_quality.maximum is not None
        and all(
            math.isfinite(value) and 0 <= value <= 1
            for value in (mesh_quality.minimum, mesh_quality.average, mesh_quality.maximum)
        )
        and mesh_quality.minimum <= mesh_quality.average <= mesh_quality.maximum
    ):
        raise ValueError("Reported Mechanical element-quality evidence is inconsistent")
    return [
        _check(
            "SOLVER_AND_RESULT_FILE",
            "VERIFIED",
            f"Mechanical Done; nonempty local result file: {result_bytes} bytes.",
            "This is numerical completion, not physical validation.",
        ),
        _check(
            "CAD_CONTENT_PROVENANCE",
            "VERIFIED",
            f"Imported CAD SHA-256: {geometry_hash}; {body_count} bodies.",
            "A hash identifies bytes, not geometric correctness or vehicle provenance.",
        ),
        _check(
            "FIXED_SCOPE_PRESENT",
            "VERIFIED",
            f"Imported named fixed selection contained {fixed_count} geometry entities.",
            "Face type, fixture stiffness and vehicle mounting were not checked.",
        ),
        _check(
            "ELEMENT_QUALITY_METRIC",
            "VERIFIED" if measured_quality else "UNVERIFIED",
            "Mechanical ElementQuality values returned."
            if measured_quality
            else "Mechanical ElementQuality metric unavailable.",
            "A global min/average/max is not a Jacobian or through-thickness audit.",
        ),
        _check(
            "SHAPE_CHECK_INPUT",
            "VERIFIED" if shape_check else "UNVERIFIED",
            "APDL shape-check command found in solver input."
            if shape_check
            else "APDL shape-check command not confirmed in solver input.",
            "Command presence does not prove every element passed shape criteria.",
        ),
        _check(
            "STUDIO_CAD_REGISTRATION",
            "UNVERIFIED",
            studio_status or "No Studio-to-CAD frame/anchor declaration was supplied.",
            "Declared anchors are not verified against imported CAD topology or metrology.",
        ),
        _check(
            "MATERIAL_PROPERTIES",
            "UNVERIFIED",
            "ANSYS library Structural Steel was requested for imported bodies.",
            "No measured, versioned MSKU component material or density certificate was supplied.",
        ),
        _check(
            "PHYSICAL_CORRELATION",
            "UNVERIFIED",
            "No independent real-vehicle test correlation is attached.",
            "Solver completion and software tests cannot establish physical accuracy.",
        ),
    ]


def _validate_static_mesh_evidence(request: StaticAnalysisRequest, job: StaticJobResponse) -> None:
    result = job.result
    if result is None:
        raise ValueError("Static result is missing")
    if (request.meshConvergenceSizesMm is None) != (result.meshConvergence is None):
        raise ValueError("Requested mesh study and reported study differ")
    if result.meshConvergence is None:
        return
    assessment = result.meshConvergence
    if (
        len(assessment.points) != 3
        or request.meshConvergenceSizesMm != [point.meshSizeMm for point in assessment.points]
        or not math.isclose(assessment.toleranceRelative, MESH_CONVERGENCE_TOLERANCE_RELATIVE)
    ):
        raise ValueError("Three completed mesh points are required")
    coarse, medium, fine = assessment.points
    if not (
        coarse.meshSizeMm > medium.meshSizeMm > fine.meshSizeMm == result.meshSizeMm
        and coarse.meshNodes < medium.meshNodes < fine.meshNodes == result.meshNodes
        and coarse.meshElements < medium.meshElements < fine.meshElements == result.meshElements
        and all(
            point.resultFileBytes > 0 and point.solverStatus == "Done"
            for point in assessment.points
        )
        and math.isclose(fine.maximumVonMisesStressPa, result.maximumVonMisesStressPa)
        and math.isclose(fine.maximumTotalDeformationM, result.maximumTotalDeformationM)
    ):
        raise ValueError("Mesh sequence or finest solver result is inconsistent")

    def relative(previous: float, current: float) -> float:
        return (
            abs(current - previous) / abs(current)
            if current
            else (0.0 if previous == 0 else math.inf)
        )

    values = (
        relative(coarse.maximumVonMisesStressPa, medium.maximumVonMisesStressPa),
        relative(coarse.maximumTotalDeformationM, medium.maximumTotalDeformationM),
        relative(medium.maximumVonMisesStressPa, fine.maximumVonMisesStressPa),
        relative(medium.maximumTotalDeformationM, fine.maximumTotalDeformationM),
    )
    recorded = (
        assessment.coarseToMediumStressChangeRelative,
        assessment.coarseToMediumDeformationChangeRelative,
        assessment.stressChangeRelative,
        assessment.deformationChangeRelative,
    )
    if any(
        not math.isfinite(value) or not math.isclose(value, given, rel_tol=1e-8)
        for value, given in zip(values, recorded, strict=True)
    ):
        raise ValueError("Recorded mesh differences do not match solver points")
    passed = (
        all(value <= assessment.toleranceRelative for value in values[2:])
        and values[2] <= values[0]
        and values[3] <= values[1]
    )
    if (assessment.status == "PASSED_NUMERICALLY") != passed or not assessment.meshCountsIncrease:
        raise ValueError("Mesh convergence status contradicts the independently recomputed trend")


def build_static_report(request: StaticAnalysisRequest, job: StaticJobResponse) -> TechnicalReport:
    if job.state != "SUCCEEDED" or job.result is None or job.completedAt is None:
        raise ValueError("Only a completed accepted Static Structural job can be reported")
    result = job.result
    if (
        not all(
            math.isfinite(value) and value >= 0
            for value in (result.maximumVonMisesStressPa, result.maximumTotalDeformationM)
        )
        or result.forceScopeEntityCount <= 0
    ):
        raise ValueError("Static numerical or load-scope evidence is incomplete")
    if (
        result.material != request.material
        or result.fixedNamedSelection != request.fixedNamedSelection
        or result.forceNamedSelection != request.forceNamedSelection
        or result.forceAxis != request.forceAxis
        or result.forceN != request.forceN
        or result.forceInputSha256 != request.forceInputSha256
        or result.forceComponentsN != request.forceComponentsN
        or result.forceApplicationPointVehicleM != request.forceApplicationPointVehicleM
        or result.meshSizeMm != request.meshSizeMm
        or (result.studioTransfer is None) != (request.studioTransfer is None)
    ):
        raise ValueError("Static request and solver-result provenance disagree")
    _validate_static_mesh_evidence(request, job)
    checks = _common_checks(
        solver_status=result.solverStatus,
        result_bytes=result.resultFileBytes,
        geometry_hash=result.geometrySha256,
        mesh_quality=result.meshQuality,
        shape_check=result.shapeCheckInSolverInput,
        studio_status=result.studioTransfer.status if result.studioTransfer else None,
        body_count=result.bodyCount,
        fixed_count=result.fixedScopeEntityCount,
    )
    checks.extend(
        [
            _check(
                "STATIC_SI_RESULTS",
                "VERIFIED",
                "Finite maximum stress [Pa] and deformation [m] were read from Mechanical.",
                "These are global extrema, not a spatial field or design allowable.",
            ),
            _check(
                "LOAD_SCOPE_PRESENT",
                "VERIFIED",
                f"Named load selection contained {result.forceScopeEntityCount} geometry entities.",
                "Load distribution, application point and load path are unverified.",
            ),
            _check(
                "LOAD_APPLICATION_POINT",
                "UNVERIFIED",
                "Studio vehicle-frame point was declared."
                if result.forceApplicationPointVehicleM is not None
                else "No load application point was transferred.",
                "Point is not mapped to a CAD face or moment arm; load uses named selection.",
            ),
            _check(
                "BOUNDARY_CONDITION_PHYSICS",
                "UNVERIFIED",
                "Fixed and force selections were nonempty and disjoint in Mechanical.",
                "Real joint/contact stiffness and support fixture equivalence are not established.",
            ),
        ]
    )
    convergence = result.meshConvergence
    if convergence is None:
        checks.append(
            _check("STATIC_MESH_CONVERGENCE", "UNVERIFIED", "No three-mesh study was run.")
        )
    elif convergence.status == "NOT_CONVERGED":
        checks.append(
            _check(
                "STATIC_MESH_CONVERGENCE",
                "BLOCKED",
                "Three-mesh global maximum trend did not meet the declared numerical criterion.",
                "Rising peak stress has unknown cause; inspect hot spots and refine further.",
            )
        )
    else:
        checks.append(
            _check(
                "STATIC_MESH_CONVERGENCE",
                "VERIFIED",
                "Three-mesh global maximum trend met the declared numerical screening criterion.",
                "Spatial stress convergence, singularity and physical validity remain unverified.",
            )
        )
    return TechnicalReport(
        analysisType="STATIC_STRUCTURAL",
        generatedAt=datetime.now(UTC).isoformat(),
        jobId=job.jobId,
        jobStartedAt=job.startedAt,
        jobCompletedAt=job.completedAt,
        inputProvenance=_input_without_path(request),
        solverResult=result.model_dump(mode="json"),
        checks=checks,
        unresolvedItems=[
            "Real vehicle CAD topology and fixture/load face registration",
            "Measured material properties and justified joint/contact/boundary conditions",
            "Load application point and moment-arm mapping to CAD",
            "Spatial hot-spot/singularity inspection and robust mesh convergence",
            "Independent benchmark and physical vehicle correlation",
        ],
        warnings=result.warnings,
    )


def build_modal_report(request: ModalAnalysisRequest, job: ModalJobResponse) -> TechnicalReport:
    if job.state != "SUCCEEDED" or job.result is None or job.completedAt is None:
        raise ValueError("Only a completed accepted Modal job can be reported")
    result = job.result
    if not result.modes or any(
        not math.isfinite(mode.frequencyHz) or mode.frequencyHz <= 0 for mode in result.modes
    ):
        raise ValueError("Finite positive modal frequencies are required")
    if (
        result.material != request.material
        or result.fixedNamedSelection != request.fixedNamedSelection
        or result.meshSizeMm != request.meshSizeMm
        or len(result.modes) != request.modeCount
        or (result.studioTransfer is None) != (request.studioTransfer is None)
    ):
        raise ValueError("Modal request and solver-result provenance disagree")
    checks = _common_checks(
        solver_status=result.solverStatus,
        result_bytes=result.resultFileBytes,
        geometry_hash=result.geometrySha256,
        mesh_quality=result.meshQuality,
        shape_check=result.shapeCheckInSolverInput,
        studio_status=result.studioTransfer.status if result.studioTransfer else None,
        body_count=result.bodyCount,
        fixed_count=result.fixedScopeEntityCount,
    )
    checks.extend(
        [
            _check(
                "MODAL_FREQUENCIES_HZ",
                "VERIFIED",
                f"{len(result.modes)} positive ordered Mechanical modal frequencies [Hz] returned.",
                "Mode shapes are normalized; they are not forced-displacement predictions.",
            ),
            _check(
                "MODAL_MESH_CONVERGENCE",
                "UNVERIFIED",
                "No modal mesh refinement comparison was performed.",
                "Frequency and mode-shape stability across meshes are unknown.",
            ),
            _check(
                "MODAL_BOUNDARY_PHYSICS",
                "UNVERIFIED",
                "Named fixed support exists in Mechanical.",
                "The real vehicle mounting stiffness, contact and pre-stress were not correlated.",
            ),
        ]
    )
    return TechnicalReport(
        analysisType="MODAL",
        generatedAt=datetime.now(UTC).isoformat(),
        jobId=job.jobId,
        jobStartedAt=job.startedAt,
        jobCompletedAt=job.completedAt,
        inputProvenance=_input_without_path(request),
        solverResult=result.model_dump(mode="json"),
        checks=checks,
        unresolvedItems=[
            "Measured density and stiffness for the real component",
            "Modal mesh convergence and mode-shape association",
            "Actual mounting/contact stiffness and pre-stress",
            "Independent modal benchmark and instrumented vehicle/component correlation",
        ],
        warnings=result.warnings,
    )
