from __future__ import annotations

import hashlib
import json
import os
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from msku_engineering import (
    KINEMATICS_SOLVER_VERSION,
    SolverSettings,
    solve_sweep,
    validate_corner,
)

from .models import (
    DiagnosticResponse,
    InputProvenanceResponse,
    KinematicMetricsResponse,
    KinematicPoseResponse,
    KinematicsSweepRequest,
    KinematicsSweepResponse,
    KinematicStateResponse,
    Project,
    ProjectValidationResponse,
    SolverDiagnosticsResponse,
    SolverMetadataResponse,
    ValidationStatusResponse,
    Vec3,
)

app = FastAPI(
    title="MSKU Racing Dynamics Studio API",
    version="0.1.0",
    description="Typed geometry validation and unvalidated suspension-kinematics API.",
)

origins = [
    item.strip()
    for item in os.getenv(
        "MSKU_API_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if item.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/api/v1/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "msku-racing-api", "version": "0.1.0"}


@app.post("/api/v1/projects/validate", response_model=ProjectValidationResponse)
async def validate_project(project: Project) -> ProjectValidationResponse:
    points = {
        point.id: (point.position.x, point.position.y, point.position.z)
        for point in project.suspension.hardpoints
    }
    diagnostics = validate_corner(
        points,
        project.suspension.wheel.radius,
        project.suspension.wheel.width,
        project.suspension.corner,
    )
    response_diagnostics = [
        DiagnosticResponse(
            severity=item.severity,
            code=item.code,
            message=item.message,
            points=list(item.points),
        )
        for item in diagnostics
    ]
    return ProjectValidationResponse(
        valid=not any(item.severity == "error" for item in diagnostics),
        schemaVersion="1.0.0",
        units={"length": "m", "angle": "rad"},
        diagnostics=response_diagnostics,
    )


def _vec3(values: tuple[float, float, float]) -> Vec3:
    return Vec3(x=values[0], y=values[1], z=values[2])


def _project_input_sha256(project: Project) -> str:
    canonical = json.dumps(
        project.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@app.post("/api/v1/kinematics/sweep", response_model=KinematicsSweepResponse)
async def kinematics_sweep(request: KinematicsSweepRequest) -> KinematicsSweepResponse:
    project = request.project
    points = {
        point.id: (point.position.x, point.position.y, point.position.z)
        for point in project.suspension.hardpoints
    }
    geometry_diagnostics = validate_corner(
        points,
        project.suspension.wheel.radius,
        project.suspension.wheel.width,
        project.suspension.corner,
    )
    blocking = [item for item in geometry_diagnostics if item.severity == "error"]
    if blocking:
        raise HTTPException(
            status_code=422,
            detail=[{"code": item.code, "message": item.message} for item in blocking],
        )

    try:
        settings = SolverSettings(
            residual_tolerance_m=request.solver.residualToleranceM,
            max_function_evaluations=request.solver.maxFunctionEvaluations,
        )
        result = solve_sweep(
            points,
            request.sweep.startTravelM,
            request.sweep.endTravelM,
            request.sweep.steps,
            project.suspension.wheel.radius,
            project.suspension.wheel.staticCamberRad,
            project.suspension.wheel.staticToeRad,
            project.suspension.corner,
            settings,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    states: list[KinematicStateResponse] = []
    for state in result.states:
        pose = None
        if state.pose is not None:
            pose = KinematicPoseResponse(
                hardpoints={
                    point_id: _vec3(value) for point_id, value in state.pose.hardpoints.items()
                },
                wheelAxis=_vec3(state.pose.wheel_axis),
                translation=_vec3(state.pose.translation),
                rotationVector=_vec3(state.pose.rotation_vector),
            )
        metrics = None
        if state.metrics is not None:
            metrics = KinematicMetricsResponse(
                camberRad=state.metrics.camber_rad,
                camberChangeRad=state.metrics.camber_change_rad,
                camberGainRadPerM=state.metrics.camber_gain_rad_per_m,
                toeRad=state.metrics.toe_rad,
                bumpSteerRad=state.metrics.bump_steer_rad,
                bumpSteerGradientRadPerM=state.metrics.bump_steer_gradient_rad_per_m,
                casterRad=state.metrics.caster_rad,
                kpiRad=state.metrics.kpi_rad,
                trackChangeM=state.metrics.track_change_m,
                rollCenterHeightM=state.metrics.roll_center_height_m,
                instantCenterYM=state.metrics.instant_center_y_m,
                instantCenterZM=state.metrics.instant_center_z_m,
            )
        states.append(
            KinematicStateResponse(
                travelM=state.travel_m,
                calculationStatus=state.calculation_status,
                pose=pose,
                metrics=metrics,
                diagnostics=SolverDiagnosticsResponse(
                    converged=state.diagnostics.converged,
                    optimizerSuccess=state.diagnostics.optimizer_success,
                    residualsAccepted=state.diagnostics.residuals_accepted,
                    jacobianAccepted=state.diagnostics.jacobian_accepted,
                    continuityAccepted=state.diagnostics.continuity_accepted,
                    residualNormM=state.diagnostics.residual_norm_m,
                    maxAbsResidualM=state.diagnostics.max_abs_residual_m,
                    jacobianRank=state.diagnostics.jacobian_rank,
                    jacobianCondition=state.diagnostics.jacobian_condition,
                    functionEvaluations=state.diagnostics.function_evaluations,
                    message=state.diagnostics.message,
                ),
                warnings=list(state.warnings),
            )
        )

    return KinematicsSweepResponse(
        schemaVersion="1.0.0",
        modelStatus="unvalidated",
        units={
            "length": "m",
            "angle": "rad",
            "camberGain": "rad/m",
            "bumpSteerGradient": "rad/m",
        },
        allConverged=result.all_converged,
        validationStatus=ValidationStatusResponse(
            numerical=result.calculation_status,
            reference=result.reference_status,
            physical=result.physical_status,
            engineeringApproval="NOT_APPROVED",
        ),
        solver=SolverMetadataResponse(
            name="rigid_upright_double_wishbone",
            version=result.solver_version,
            residualToleranceM=settings.residual_tolerance_m,
            rankRelativeTolerance=settings.rank_relative_tolerance,
            conditionLimit=settings.condition_limit,
            continuityPositionLimitM=settings.continuity_position_limit_m,
            continuityRotationLimitRad=settings.continuity_rotation_limit_rad,
            maximumTravelStepM=settings.max_travel_step_m,
            maxFunctionEvaluations=settings.max_function_evaluations,
            gradientMethod="second_order_nonuniform_finite_difference",
        ),
        inputProvenance=InputProvenanceResponse(
            projectId=project.projectId,
            projectName=project.name,
            dataClassification=project.dataClassification,
            declaredModelStatus=project.modelStatus,
            projectInputSha256=_project_input_sha256(project),
        ),
        warnings=[
            *(item.code for item in geometry_diagnostics if item.severity == "warning"),
            "RIGID_LINK_IDEAL_JOINT_MODEL",
            "ROLL_CENTER_REQUIRES_SYMMETRIC_MIRRORED_OPPOSITE_CORNER",
            "PHYSICAL_VALIDATION_EVIDENCE_NOT_ATTACHED",
        ],
        residualToleranceM=result.residual_tolerance_m,
        states=states,
    )


@app.get("/api/v1/capabilities")
async def capabilities() -> dict[str, Any]:
    return {
        "implemented": [
            "project_validation",
            "static_geometry_diagnostics",
            "double_wishbone_kinematics_sweep",
        ],
        "notImplemented": [
            "quasi_static_loads",
            "dynamics",
            "road_simulation",
            "optimization",
            "reports",
        ],
        "modelStatus": "unvalidated",
        "solverVersion": KINEMATICS_SOLVER_VERSION,
        "qualityStates": [
            "VERIFIED_NUMERICALLY",
            "REFERENCE_BENCHMARKED",
            "UNVALIDATED_PHYSICALLY",
            "FAILED",
        ],
    }
