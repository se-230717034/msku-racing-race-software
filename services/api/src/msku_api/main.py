from __future__ import annotations

import hashlib
import json
import os
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from msku_engineering import (
    BICYCLE_SOLVER_VERSION,
    DYNAMICS_SOLVER_VERSION,
    FULL_CAR_SOLVER_VERSION,
    KINEMATICS_SOLVER_VERSION,
    OPTIMIZATION_SOLVER_VERSION,
    QUASI_STATIC_SOLVER_VERSION,
    BicycleDomainLimits,
    BicycleInitialState,
    BicycleParameters,
    DynamicsSettings,
    EquilibriumSettings,
    ExternalWrench,
    FullCarCornerParameters,
    FullCarInitialState,
    FullCarParameters,
    FullCarRoadInputs,
    ObjectiveDefinition,
    OptimizationSettings,
    QuarterCarInitialState,
    QuarterCarParameters,
    RoadProfile,
    SolverSettings,
    SteeringProfile,
    TwoForceMember,
    VehicleLoadTransferInput,
    calculate_actuation_series,
    calculate_damper_force,
    calculate_vehicle_load_transfer,
    run_optimization,
    simulate_bicycle,
    simulate_full_car,
    simulate_quarter_car,
    solve_pose,
    solve_sweep,
    solve_upright_equilibrium,
    validate_corner,
)
from starlette.concurrency import run_in_threadpool

from .models import (
    ActuationSeriesRequest,
    ActuationSeriesResponse,
    AxleLoadsResponse,
    BicycleDiagnosticsResponse,
    BicycleSampleResponse,
    BicycleSimulationRequest,
    BicycleSimulationResponse,
    DamperForceRequest,
    DamperForceResponse,
    DiagnosticResponse,
    DynamicsDiagnosticsResponse,
    DynamicsInputProvenanceResponse,
    DynamicsSettingsInput,
    EngineeringOptimizationRequest,
    EngineeringOptimizationResponse,
    EquilibriumDiagnosticsResponse,
    FullCarDiagnosticsResponse,
    FullCarSampleResponse,
    FullCarSimulationRequest,
    FullCarSimulationResponse,
    InputProvenanceResponse,
    KinematicMetricsResponse,
    KinematicPoseResponse,
    KinematicsSweepRequest,
    KinematicsSweepResponse,
    KinematicStateResponse,
    MemberForceResponse,
    OptimizationCandidateResponse,
    OptimizationConvergenceResponse,
    OptimizationDiagnosticsResponse,
    OptimizationProvenanceResponse,
    OptimizationSensitivityResponse,
    Phase3ValidationStatusResponse,
    Project,
    ProjectValidationResponse,
    QuarterCarSampleResponse,
    QuarterCarSimulationRequest,
    QuarterCarSimulationResponse,
    RoadProfileInput,
    SolverDiagnosticsResponse,
    SolverMetadataResponse,
    SpringSampleResponse,
    UprightEquilibriumRequest,
    UprightEquilibriumResponse,
    ValidationStatusResponse,
    Vec3,
    VehicleLoadTransferRequest,
    VehicleLoadTransferResponse,
    WheelLoadsResponse,
)
from .optimization_adapter import build_optimization_adapter

app = FastAPI(
    title="MSKU Racing Dynamics Studio API",
    version="0.6.1",
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
    return {"status": "ok", "service": "msku-racing-api", "version": "0.6.1"}


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


def _request_input_sha256(
    request: (
        QuarterCarSimulationRequest
        | FullCarSimulationRequest
        | BicycleSimulationRequest
        | EngineeringOptimizationRequest
    ),
) -> str:
    canonical = json.dumps(
        request.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _road_profile(value: RoadProfileInput) -> RoadProfile:
    return RoadProfile(
        kind=value.kind,
        amplitude_m=value.amplitudeM,
        start_time_s=value.startTimeS,
        duration_s=value.durationS,
        frequency_hz=value.frequencyHz,
        sample_times_s=tuple(value.sampleTimesS),
        sample_displacements_m=tuple(value.sampleDisplacementsM),
    )


def _dynamics_settings(value: DynamicsSettingsInput) -> DynamicsSettings:
    return DynamicsSettings(
        duration_s=value.durationS,
        output_samples=value.outputSamples,
        relative_tolerance=value.relativeTolerance,
        absolute_tolerance=value.absoluteTolerance,
        maximum_step_s=value.maximumStepS,
        method=value.method,
    )


def _project_provenance(project: Project) -> InputProvenanceResponse:
    return InputProvenanceResponse(
        projectId=project.projectId,
        projectName=project.name,
        dataClassification=project.dataClassification,
        declaredModelStatus=project.modelStatus,
        projectInputSha256=_project_input_sha256(project),
    )


def _phase3_validation(status: str) -> Phase3ValidationStatusResponse:
    if status not in ("VERIFIED_NUMERICALLY", "NOT_COMPUTABLE", "FAILED"):
        raise ValueError(f"Unsupported calculation status: {status}")
    return Phase3ValidationStatusResponse(numerical=status)  # type: ignore[arg-type]


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
        inputProvenance=_project_provenance(project),
        warnings=[
            *(item.code for item in geometry_diagnostics if item.severity == "warning"),
            "RIGID_LINK_IDEAL_JOINT_MODEL",
            "ROLL_CENTER_REQUIRES_SYMMETRIC_MIRRORED_OPPOSITE_CORNER",
            "PHYSICAL_VALIDATION_EVIDENCE_NOT_ATTACHED",
        ],
        residualToleranceM=result.residual_tolerance_m,
        states=states,
    )


@app.post(
    "/api/v1/quasi-static/upright-equilibrium",
    response_model=UprightEquilibriumResponse,
)
async def upright_equilibrium(request: UprightEquilibriumRequest) -> UprightEquilibriumResponse:
    project = request.project
    points = {
        point.id: (point.position.x, point.position.y, point.position.z)
        for point in project.suspension.hardpoints
    }
    blocking = [
        item
        for item in validate_corner(
            points,
            project.suspension.wheel.radius,
            project.suspension.wheel.width,
            project.suspension.corner,
        )
        if item.severity == "error"
    ]
    if blocking:
        raise HTTPException(
            status_code=422,
            detail=[{"code": item.code, "message": item.message} for item in blocking],
        )
    try:
        state, _ = solve_pose(
            points,
            request.travelM,
            project.suspension.wheel.radius,
            project.suspension.wheel.staticCamberRad,
            project.suspension.wheel.staticToeRad,
            project.suspension.corner,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if state.pose is None:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "KINEMATIC_POSE_FAILED",
                "message": state.diagnostics.message,
                "warnings": state.warnings,
            },
        )

    member_definitions = (
        ("uca_front_leg", "uca_front_inboard", "uca_outboard"),
        ("uca_rear_leg", "uca_rear_inboard", "uca_outboard"),
        ("lca_front_leg", "lca_front_inboard", "lca_outboard"),
        ("lca_rear_leg", "lca_rear_inboard", "lca_outboard"),
        ("tie_rod", "tie_rod_inboard", "tie_rod_outboard"),
    )
    members = [
        TwoForceMember(member_id, points[inboard_id], state.pose.hardpoints[outboard_id])
        for member_id, inboard_id, outboard_id in member_definitions
    ]
    if request.additionalMember is not None:
        extra = request.additionalMember
        members.append(
            TwoForceMember(
                extra.id,
                (extra.chassisPointM.x, extra.chassisPointM.y, extra.chassisPointM.z),
                (extra.uprightPointM.x, extra.uprightPointM.y, extra.uprightPointM.z),
            )
        )

    wrench = request.externalWrench
    result = solve_upright_equilibrium(
        members,
        ExternalWrench(
            (wrench.forceN.x, wrench.forceN.y, wrench.forceN.z),
            (wrench.momentNm.x, wrench.momentNm.y, wrench.momentNm.z),
            (
                wrench.applicationPointM.x,
                wrench.applicationPointM.y,
                wrench.applicationPointM.z,
            ),
        ),
        state.pose.hardpoints["wheel_center"],
        EquilibriumSettings(
            force_tolerance_n=request.solver.forceToleranceN,
            moment_tolerance_nm=request.solver.momentToleranceNm,
            rank_relative_tolerance=request.solver.rankRelativeTolerance,
            condition_limit=request.solver.conditionLimit,
        ),
    )
    diagnostics = result.diagnostics
    return UprightEquilibriumResponse(
        schemaVersion="1.0.0",
        calculationStatus=result.calculation_status,
        validationStatus=_phase3_validation(result.calculation_status),
        solverVersion=result.solver_version,
        units={"force": "N", "moment": "N*m", "length": "m"},
        inputProvenance=_project_provenance(project),
        pose=KinematicPoseResponse(
            hardpoints={
                point_id: _vec3(value) for point_id, value in state.pose.hardpoints.items()
            },
            wheelAxis=_vec3(state.pose.wheel_axis),
            translation=_vec3(state.pose.translation),
            rotationVector=_vec3(state.pose.rotation_vector),
        ),
        memberForces=[
            MemberForceResponse(
                id=item.id,
                axialForceN=item.axial_force_n,
                state=item.state,
                forceOnUprightN=_vec3(item.force_on_upright_n),
                chassisReactionN=_vec3(item.chassis_reaction_n),
                uprightPointM=_vec3(item.upright_point_m),
            )
            for item in result.member_forces
        ],
        diagnostics=EquilibriumDiagnosticsResponse(
            matrixRows=diagnostics.matrix_rows,
            matrixColumns=diagnostics.matrix_columns,
            matrixRank=diagnostics.matrix_rank,
            conditionNumber=diagnostics.condition_number,
            forceResidualN=_vec3(diagnostics.force_residual_n),
            momentResidualNm=_vec3(diagnostics.moment_residual_nm),
            forceResidualNormN=diagnostics.force_residual_norm_n,
            momentResidualNormNm=diagnostics.moment_residual_norm_nm,
            characteristicLengthM=diagnostics.characteristic_length_m,
            message=diagnostics.message,
        ),
        warnings=[
            *result.warnings,
            "EXTERNAL_WRENCH_APPLICATION_POINT_WAS_EXPLICITLY_SUPPLIED",
            "PHYSICAL_VALIDATION_EVIDENCE_NOT_ATTACHED",
        ],
    )


@app.post(
    "/api/v1/quasi-static/load-transfer",
    response_model=VehicleLoadTransferResponse,
)
async def vehicle_load_transfer(
    request: VehicleLoadTransferRequest,
) -> VehicleLoadTransferResponse:
    result = calculate_vehicle_load_transfer(
        VehicleLoadTransferInput(
            mass_kg=request.massKg,
            wheelbase_m=request.wheelbaseM,
            cg_from_front_axle_m=request.cgFromFrontAxleM,
            cg_height_m=request.cgHeightM,
            front_track_m=request.frontTrackM,
            rear_track_m=request.rearTrackM,
            longitudinal_acceleration_mps2=request.longitudinalAccelerationMps2,
            lateral_acceleration_mps2=request.lateralAccelerationMps2,
            gravity_mps2=request.gravityMps2,
            front_roll_stiffness_nm_per_rad=request.frontRollStiffnessNmPerRad,
            rear_roll_stiffness_nm_per_rad=request.rearRollStiffnessNmPerRad,
        )
    )
    return VehicleLoadTransferResponse(
        schemaVersion="1.0.0",
        calculationStatus=result.calculation_status,
        validationStatus=_phase3_validation(result.calculation_status),
        solverVersion=result.solver_version,
        modelName="rigid_body_with_elastic_roll_stiffness_distribution",
        units={"mass": "kg", "length": "m", "acceleration": "m/s^2", "force": "N"},
        axleLoads=(
            AxleLoadsResponse(frontN=result.axle_loads.front_n, rearN=result.axle_loads.rear_n)
            if result.axle_loads is not None
            else None
        ),
        wheelLoads=(
            WheelLoadsResponse(
                frontLeftN=result.wheel_loads.front_left_n,
                frontRightN=result.wheel_loads.front_right_n,
                rearLeftN=result.wheel_loads.rear_left_n,
                rearRightN=result.wheel_loads.rear_right_n,
            )
            if result.wheel_loads is not None
            else None
        ),
        longitudinalTransferN=result.longitudinal_transfer_n,
        frontLateralTransferN=result.front_lateral_transfer_n,
        rearLateralTransferN=result.rear_lateral_transfer_n,
        totalWeightN=result.total_weight_n,
        forceResidualN=result.force_residual_n,
        warnings=list(result.warnings),
    )


@app.post("/api/v1/quasi-static/actuation-series", response_model=ActuationSeriesResponse)
async def actuation_series(request: ActuationSeriesRequest) -> ActuationSeriesResponse:
    result = calculate_actuation_series(
        request.wheelTravelM,
        request.springLengthM,
        request.referenceSpringLengthM,
        request.springRateNPerM,
        request.preloadN,
        request.compressionOnly,
    )
    return ActuationSeriesResponse(
        schemaVersion="1.0.0",
        calculationStatus=result.calculation_status,
        validationStatus=_phase3_validation(result.calculation_status),
        solverVersion=result.solver_version,
        units={
            "length": "m",
            "force": "N",
            "springRate": "N/m",
            "energy": "J",
            "motionRatio": "m/m",
        },
        samples=[
            SpringSampleResponse(
                wheelTravelM=item.wheel_travel_m,
                springLengthM=item.spring_length_m,
                springCompressionM=item.spring_compression_m,
                motionRatio=item.motion_ratio,
                springForceN=item.spring_force_n,
                storedEnergyJ=item.stored_energy_j,
                wheelForceN=item.wheel_force_n,
                wheelRateNPerM=item.wheel_rate_n_per_m,
            )
            for item in result.samples
        ],
        warnings=list(result.warnings),
    )


@app.post("/api/v1/quasi-static/damper-force", response_model=DamperForceResponse)
async def damper_force(request: DamperForceRequest) -> DamperForceResponse:
    result = calculate_damper_force(
        request.velocityMps,
        request.compressionCoefficientNsPerM,
        request.reboundCoefficientNsPerM,
    )
    return DamperForceResponse(
        schemaVersion="1.0.0",
        calculationStatus=result.calculation_status,
        forceN=result.force_n,
        warning=result.warning,
    )


@app.post(
    "/api/v1/dynamics/quarter-car/simulate",
    response_model=QuarterCarSimulationResponse,
)
async def quarter_car_simulation(
    request: QuarterCarSimulationRequest,
) -> QuarterCarSimulationResponse:
    parameters = request.parameters
    road = request.road
    initial = request.initialState
    settings = request.settings
    result = simulate_quarter_car(
        QuarterCarParameters(
            sprung_mass_kg=parameters.sprungMassKg,
            unsprung_mass_kg=parameters.unsprungMassKg,
            suspension_stiffness_n_per_m=parameters.suspensionStiffnessNPerM,
            suspension_damping_ns_per_m=parameters.suspensionDampingNsPerM,
            tire_stiffness_n_per_m=parameters.tireStiffnessNPerM,
            tire_damping_ns_per_m=parameters.tireDampingNsPerM,
            static_tire_load_n=parameters.staticTireLoadN,
        ),
        RoadProfile(
            kind=road.kind,
            amplitude_m=road.amplitudeM,
            start_time_s=road.startTimeS,
            duration_s=road.durationS,
            frequency_hz=road.frequencyHz,
            sample_times_s=tuple(road.sampleTimesS),
            sample_displacements_m=tuple(road.sampleDisplacementsM),
        ),
        QuarterCarInitialState(
            sprung_displacement_m=initial.sprungDisplacementM,
            sprung_velocity_mps=initial.sprungVelocityMps,
            unsprung_displacement_m=initial.unsprungDisplacementM,
            unsprung_velocity_mps=initial.unsprungVelocityMps,
        ),
        DynamicsSettings(
            duration_s=settings.durationS,
            output_samples=settings.outputSamples,
            relative_tolerance=settings.relativeTolerance,
            absolute_tolerance=settings.absoluteTolerance,
            maximum_step_s=settings.maximumStepS,
            method=settings.method,
        ),
    )
    diagnostics = result.diagnostics
    return QuarterCarSimulationResponse(
        schemaVersion="1.0.0",
        modelName="linear_quarter_car_2dof",
        calculationStatus=result.calculation_status,
        validationStatus=_phase3_validation(result.calculation_status),
        solverVersion=result.solver_version,
        units={
            "time": "s",
            "displacement": "m",
            "velocity": "m/s",
            "acceleration": "m/s^2",
            "force": "N",
            "energy": "J",
            "power": "W",
        },
        inputProvenance=DynamicsInputProvenanceResponse(
            dataClassification=request.dataClassification,
            sourceLabel=request.sourceLabel,
            inputSha256=_request_input_sha256(request),
        ),
        naturalFrequenciesHz=(
            list(result.natural_frequencies_hz)
            if result.natural_frequencies_hz is not None
            else None
        ),
        diagnostics=DynamicsDiagnosticsResponse(
            solverSuccess=diagnostics.solver_success,
            finiteStates=diagnostics.finite_states,
            contactAccepted=diagnostics.contact_accepted,
            functionEvaluations=diagnostics.function_evaluations,
            jacobianEvaluations=diagnostics.jacobian_evaluations,
            luDecompositions=diagnostics.lu_decompositions,
            integrationMethod=diagnostics.integration_method,
            relativeTolerance=diagnostics.relative_tolerance,
            absoluteTolerance=diagnostics.absolute_tolerance,
            maximumStepS=diagnostics.maximum_step_s,
            acceptedSteps=diagnostics.accepted_steps,
            minimumAcceptedStepS=diagnostics.minimum_accepted_step_s,
            maximumAcceptedStepS=diagnostics.maximum_accepted_step_s,
            initialEnergyJ=diagnostics.initial_energy_j,
            finalEnergyJ=diagnostics.final_energy_j,
            roadInputWorkJ=diagnostics.road_input_work_j,
            dissipatedEnergyJ=diagnostics.dissipated_energy_j,
            energyBalanceResidualJ=diagnostics.energy_balance_residual_j,
            relativeEnergyBalanceError=diagnostics.relative_energy_balance_error,
            minimumTotalContactForceN=diagnostics.minimum_total_contact_force_n,
            message=diagnostics.message,
        ),
        assumptions=[
            "TWO_DOF_LINEAR_QUARTER_CAR",
            "VERTICAL_COORDINATES_RELATIVE_TO_STATIC_EQUILIBRIUM",
            "POSITIVE_VERTICAL_DISPLACEMENT_IS_UPWARD",
            "LINEAR_BILATERAL_TIRE_CONTACT",
            "NO_GRAVITY_OR_PRELOAD_REAPPLIED",
            "NO_SUSPENSION_GEOMETRY_COMPLIANCE_OR_TIRE_ENVELOPING",
        ],
        warnings=list(result.warnings),
        samples=[
            QuarterCarSampleResponse(
                timeS=item.time_s,
                roadDisplacementM=item.road_displacement_m,
                roadVelocityMps=item.road_velocity_mps,
                sprungDisplacementM=item.sprung_displacement_m,
                sprungVelocityMps=item.sprung_velocity_mps,
                sprungAccelerationMps2=item.sprung_acceleration_mps2,
                unsprungDisplacementM=item.unsprung_displacement_m,
                unsprungVelocityMps=item.unsprung_velocity_mps,
                unsprungAccelerationMps2=item.unsprung_acceleration_mps2,
                suspensionTravelM=item.suspension_travel_m,
                tireCompressionM=item.tire_compression_m,
                suspensionForceOnSprungN=item.suspension_force_on_sprung_n,
                tireForceIncrementN=item.tire_force_increment_n,
                totalTireContactForceN=item.total_tire_contact_force_n,
                mechanicalEnergyJ=item.mechanical_energy_j,
                dissipatedPowerW=item.dissipated_power_w,
                roadInputPowerW=item.road_input_power_w,
            )
            for item in result.samples
        ],
    )


@app.post(
    "/api/v1/dynamics/full-car/simulate",
    response_model=FullCarSimulationResponse,
)
async def full_car_simulation(
    request: FullCarSimulationRequest,
) -> FullCarSimulationResponse:
    parameters = request.parameters
    initial = request.initialState
    result = simulate_full_car(
        FullCarParameters(
            sprung_mass_kg=parameters.sprungMassKg,
            pitch_inertia_kg_m2=parameters.pitchInertiaKgM2,
            roll_inertia_kg_m2=parameters.rollInertiaKgM2,
            corners=tuple(
                FullCarCornerParameters(
                    x_position_m=corner.xPositionM,
                    y_position_m=corner.yPositionM,
                    unsprung_mass_kg=corner.unsprungMassKg,
                    suspension_stiffness_n_per_m=corner.suspensionStiffnessNPerM,
                    suspension_damping_ns_per_m=corner.suspensionDampingNsPerM,
                    tire_stiffness_n_per_m=corner.tireStiffnessNPerM,
                    tire_damping_ns_per_m=corner.tireDampingNsPerM,
                    static_tire_load_n=corner.staticTireLoadN,
                )
                for corner in parameters.corners
            ),
        ),
        FullCarRoadInputs(profiles=tuple(_road_profile(road) for road in request.roadProfiles)),
        FullCarInitialState(
            body_heave_m=initial.bodyHeaveM,
            body_heave_velocity_mps=initial.bodyHeaveVelocityMps,
            pitch_rad=initial.pitchRad,
            pitch_rate_radps=initial.pitchRateRadps,
            roll_rad=initial.rollRad,
            roll_rate_radps=initial.rollRateRadps,
            unsprung_displacements_m=tuple(initial.unsprungDisplacementsM),
            unsprung_velocities_mps=tuple(initial.unsprungVelocitiesMps),
        ),
        _dynamics_settings(request.settings),
    )
    diagnostics = result.diagnostics
    return FullCarSimulationResponse(
        schemaVersion="1.0.0",
        modelName="linear_full_car_7dof",
        calculationStatus=result.calculation_status,
        validationStatus=_phase3_validation(result.calculation_status),
        solverVersion=result.solver_version,
        units={
            "time": "s",
            "length": "m",
            "angle": "rad",
            "velocity": "m/s",
            "angularVelocity": "rad/s",
            "acceleration": "m/s^2",
            "angularAcceleration": "rad/s^2",
            "force": "N",
            "energy": "J",
            "power": "W",
        },
        inputProvenance=DynamicsInputProvenanceResponse(
            dataClassification=request.dataClassification,
            sourceLabel=request.sourceLabel,
            inputSha256=_request_input_sha256(request),
        ),
        naturalFrequenciesHz=(
            list(result.natural_frequencies_hz)
            if result.natural_frequencies_hz is not None
            else None
        ),
        cornerOrder=["front_left", "front_right", "rear_left", "rear_right"],
        diagnostics=FullCarDiagnosticsResponse(
            solverSuccess=diagnostics.solver_success,
            finiteStates=diagnostics.finite_states,
            contactAccepted=diagnostics.contact_accepted,
            functionEvaluations=diagnostics.function_evaluations,
            jacobianEvaluations=diagnostics.jacobian_evaluations,
            luDecompositions=diagnostics.lu_decompositions,
            integrationMethod=diagnostics.integration_method,
            relativeTolerance=diagnostics.relative_tolerance,
            absoluteTolerance=diagnostics.absolute_tolerance,
            maximumStepS=diagnostics.maximum_step_s,
            acceptedSteps=diagnostics.accepted_steps,
            minimumAcceptedStepS=diagnostics.minimum_accepted_step_s,
            maximumAcceptedStepS=diagnostics.maximum_accepted_step_s,
            massMatrixCondition=diagnostics.mass_matrix_condition,
            stiffnessMatrixCondition=diagnostics.stiffness_matrix_condition,
            initialEnergyJ=diagnostics.initial_energy_j,
            finalEnergyJ=diagnostics.final_energy_j,
            roadInputWorkJ=diagnostics.road_input_work_j,
            dissipatedEnergyJ=diagnostics.dissipated_energy_j,
            energyBalanceResidualJ=diagnostics.energy_balance_residual_j,
            relativeEnergyBalanceError=diagnostics.relative_energy_balance_error,
            minimumTotalContactForceN=diagnostics.minimum_total_contact_force_n,
            contactLossCorner=diagnostics.contact_loss_corner,
            message=diagnostics.message,
        ),
        assumptions=[
            "LINEAR_SEVEN_DOF_FULL_CAR",
            "BODY_HEAVE_PITCH_ROLL_AND_FOUR_UNSPRUNG_VERTICAL_DOF",
            "STATIC_EQUILIBRIUM_PERTURBATION_COORDINATES",
            "SMALL_PITCH_AND_ROLL_ANGLES",
            "LINEAR_BILATERAL_TIRES",
            "NO_SUSPENSION_KINEMATIC_OR_COMPLIANCE_COUPLING",
        ],
        warnings=list(result.warnings),
        samples=[
            FullCarSampleResponse(
                timeS=item.time_s,
                roadDisplacementsM=list(item.road_displacements_m),
                roadVelocitiesMps=list(item.road_velocities_mps),
                bodyHeaveM=item.body_heave_m,
                bodyHeaveVelocityMps=item.body_heave_velocity_mps,
                bodyHeaveAccelerationMps2=item.body_heave_acceleration_mps2,
                pitchRad=item.pitch_rad,
                pitchRateRadps=item.pitch_rate_radps,
                pitchAccelerationRadps2=item.pitch_acceleration_radps2,
                rollRad=item.roll_rad,
                rollRateRadps=item.roll_rate_radps,
                rollAccelerationRadps2=item.roll_acceleration_radps2,
                unsprungDisplacementsM=list(item.unsprung_displacements_m),
                unsprungVelocitiesMps=list(item.unsprung_velocities_mps),
                unsprungAccelerationsMps2=list(item.unsprung_accelerations_mps2),
                suspensionTravelsM=list(item.suspension_travels_m),
                tireCompressionsM=list(item.tire_compressions_m),
                suspensionForcesOnBodyN=list(item.suspension_forces_on_body_n),
                tireForceIncrementsN=list(item.tire_force_increments_n),
                totalTireContactForcesN=list(item.total_tire_contact_forces_n),
                mechanicalEnergyJ=item.mechanical_energy_j,
                dissipatedPowerW=item.dissipated_power_w,
                roadInputPowerW=item.road_input_power_w,
            )
            for item in result.samples
        ],
    )


@app.post(
    "/api/v1/dynamics/bicycle/simulate",
    response_model=BicycleSimulationResponse,
)
async def bicycle_simulation(
    request: BicycleSimulationRequest,
) -> BicycleSimulationResponse:
    parameters = request.parameters
    steering = request.steering
    initial = request.initialState
    limits = request.domainLimits
    result = simulate_bicycle(
        BicycleParameters(
            mass_kg=parameters.massKg,
            yaw_inertia_kg_m2=parameters.yawInertiaKgM2,
            cg_to_front_axle_m=parameters.cgToFrontAxleM,
            cg_to_rear_axle_m=parameters.cgToRearAxleM,
            front_cornering_stiffness_n_per_rad=parameters.frontCorneringStiffnessNPerRad,
            rear_cornering_stiffness_n_per_rad=parameters.rearCorneringStiffnessNPerRad,
            speed_mps=parameters.speedMps,
        ),
        SteeringProfile(
            kind=steering.kind,
            amplitude_rad=steering.amplitudeRad,
            start_time_s=steering.startTimeS,
            rise_time_s=steering.riseTimeS,
            frequency_hz=steering.frequencyHz,
            sample_times_s=tuple(steering.sampleTimesS),
            sample_angles_rad=tuple(steering.sampleAnglesRad),
        ),
        BicycleInitialState(
            lateral_velocity_mps=initial.lateralVelocityMps,
            yaw_rate_radps=initial.yawRateRadps,
        ),
        BicycleDomainLimits(
            maximum_abs_steering_rad=limits.maximumAbsSteeringRad,
            maximum_abs_sideslip_rad=limits.maximumAbsSideslipRad,
            maximum_abs_tire_slip_rad=limits.maximumAbsTireSlipRad,
        ),
        _dynamics_settings(request.settings),
    )
    diagnostics = result.diagnostics
    return BicycleSimulationResponse(
        schemaVersion="1.0.0",
        modelName="linear_planar_bicycle",
        calculationStatus=result.calculation_status,
        validationStatus=_phase3_validation(result.calculation_status),
        solverVersion=result.solver_version,
        units={
            "time": "s",
            "length": "m",
            "angle": "rad",
            "velocity": "m/s",
            "angularVelocity": "rad/s",
            "acceleration": "m/s^2",
            "force": "N",
            "corneringStiffness": "N/rad",
        },
        inputProvenance=DynamicsInputProvenanceResponse(
            dataClassification=request.dataClassification,
            sourceLabel=request.sourceLabel,
            inputSha256=_request_input_sha256(request),
        ),
        diagnostics=BicycleDiagnosticsResponse(
            solverSuccess=diagnostics.solver_success,
            finiteStates=diagnostics.finite_states,
            stable=diagnostics.stable,
            domainAccepted=diagnostics.domain_accepted,
            functionEvaluations=diagnostics.function_evaluations,
            jacobianEvaluations=diagnostics.jacobian_evaluations,
            luDecompositions=diagnostics.lu_decompositions,
            integrationMethod=diagnostics.integration_method,
            relativeTolerance=diagnostics.relative_tolerance,
            absoluteTolerance=diagnostics.absolute_tolerance,
            maximumStepS=diagnostics.maximum_step_s,
            acceptedSteps=diagnostics.accepted_steps,
            minimumAcceptedStepS=diagnostics.minimum_accepted_step_s,
            maximumAcceptedStepS=diagnostics.maximum_accepted_step_s,
            eigenvaluesReal=(
                list(diagnostics.eigenvalues_real)
                if diagnostics.eigenvalues_real is not None
                else None
            ),
            eigenvaluesImag=(
                list(diagnostics.eigenvalues_imag)
                if diagnostics.eigenvalues_imag is not None
                else None
            ),
            understeerCoefficientS2PerM=diagnostics.understeer_coefficient_s2_per_m,
            characteristicSpeedMps=diagnostics.characteristic_speed_mps,
            criticalSpeedMps=diagnostics.critical_speed_mps,
            steadyStateYawRateGainPerS=diagnostics.steady_state_yaw_rate_gain_per_s,
            steadyStateSideslipGain=diagnostics.steady_state_sideslip_gain,
            maximumAbsSideslipRad=diagnostics.maximum_abs_sideslip_rad,
            maximumAbsFrontSlipRad=diagnostics.maximum_abs_front_slip_rad,
            maximumAbsRearSlipRad=diagnostics.maximum_abs_rear_slip_rad,
            message=diagnostics.message,
        ),
        assumptions=[
            "LINEAR_PLANAR_BICYCLE",
            "CONSTANT_LONGITUDINAL_SPEED",
            "SMALL_STEERING_SIDESLIP_AND_TIRE_SLIP_ANGLES",
            "LINEAR_AXLE_CORNERING_STIFFNESSES",
            "NO_LOAD_TRANSFER_COMBINED_SLIP_ROLL_OR_AERO",
        ],
        warnings=list(result.warnings),
        samples=[
            BicycleSampleResponse(
                timeS=item.time_s,
                steeringRad=item.steering_rad,
                lateralVelocityMps=item.lateral_velocity_mps,
                yawRateRadps=item.yaw_rate_radps,
                sideslipRad=item.sideslip_rad,
                lateralAccelerationMps2=item.lateral_acceleration_mps2,
                frontSlipAngleRad=item.front_slip_angle_rad,
                rearSlipAngleRad=item.rear_slip_angle_rad,
                frontLateralForceN=item.front_lateral_force_n,
                rearLateralForceN=item.rear_lateral_force_n,
            )
            for item in result.samples
        ],
    )


def _optimization_candidate_response(candidate: Any) -> OptimizationCandidateResponse:
    return OptimizationCandidateResponse(
        variableValues=dict(candidate.variable_values),
        metrics=dict(candidate.metrics),
        normalizedObjectives=dict(candidate.normalized_objectives),
        weightedObjective=candidate.weighted_objective,
    )


@app.post(
    "/api/v1/optimization/run",
    response_model=EngineeringOptimizationResponse,
)
async def engineering_optimization(
    request: EngineeringOptimizationRequest,
) -> EngineeringOptimizationResponse:
    try:
        variables, evaluator, available_objectives = build_optimization_adapter(request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    objective_definitions = tuple(
        ObjectiveDefinition(
            name=item.id,
            weight=item.weight,
            normalization=item.normalization,
            goal=item.goal,
            target=item.targetValue,
        )
        for item in request.objectives
    )
    settings = request.settings
    result = await run_in_threadpool(
        run_optimization,
        variables,
        objective_definitions,
        evaluator,
        OptimizationSettings(
            seed=settings.seed,
            maximum_generations=settings.maximumGenerations,
            population_multiplier=settings.populationMultiplier,
            convergence_tolerance=settings.convergenceTolerance,
            pareto_points=settings.paretoPoints,
            sensitivity_step_fraction=settings.sensitivityStepFraction,
        ),
    )
    if request.model == "kinematics":
        project = request.project
        if project is None:
            raise RuntimeError("Validated kinematics optimization payload is missing")
        classification = project.dataClassification
        source_label = project.name
    else:
        dynamics_payload = {
            "quarter_car": request.quarterCar,
            "full_car": request.fullCar,
            "bicycle": request.bicycle,
        }[request.model]
        if dynamics_payload is None:
            raise RuntimeError("Validated dynamics optimization payload is missing")
        classification = dynamics_payload.dataClassification
        source_label = dynamics_payload.sourceLabel
    diagnostics = result.diagnostics
    return EngineeringOptimizationResponse(
        schemaVersion="1.0.0",
        model=request.model,
        calculationStatus=result.calculation_status,
        validationStatus=_phase3_validation(result.calculation_status),
        solverVersion=result.solver_version,
        units={
            "designVariables": "SI",
            "objectives": "declared per objective identifier",
            "sensitivity": "objective unit / design-variable unit",
        },
        availableObjectives=list(available_objectives),
        baseline=(
            _optimization_candidate_response(result.baseline)
            if result.baseline is not None
            else None
        ),
        optimized=(
            _optimization_candidate_response(result.optimized)
            if result.optimized is not None
            else None
        ),
        paretoFront=[
            _optimization_candidate_response(candidate) for candidate in result.pareto_front
        ],
        convergence=[
            OptimizationConvergenceResponse(
                generation=item.generation,
                bestWeightedObjective=item.best_weighted_objective,
                convergenceIndicator=item.convergence_indicator,
            )
            for item in result.convergence
        ],
        sensitivities=[
            OptimizationSensitivityResponse(
                variablePath=item.variable_name,
                metricId=item.metric_name,
                derivative=item.derivative,
                step=item.step,
                method=item.method,
            )
            for item in result.sensitivities
        ],
        diagnostics=OptimizationDiagnosticsResponse(
            success=diagnostics.success,
            message=diagnostics.message,
            method=diagnostics.method,
            evaluations=diagnostics.evaluations,
            feasibleEvaluations=diagnostics.feasible_evaluations,
            rejectedEvaluations=diagnostics.rejected_evaluations,
            generations=diagnostics.generations,
            seed=diagnostics.seed,
        ),
        provenance=OptimizationProvenanceResponse(
            inputSha256=_request_input_sha256(request),
            dataClassification=classification,
            sourceLabel=source_label,
        ),
        warnings=list(result.warnings),
    )


@app.get("/api/v1/capabilities")
async def capabilities() -> dict[str, Any]:
    return {
        "implemented": [
            "project_validation",
            "static_geometry_diagnostics",
            "double_wishbone_kinematics_sweep",
            "quasi_static_upright_equilibrium",
            "vehicle_load_transfer",
            "actuation_motion_ratio_and_linear_spring",
            "velocity_explicit_linear_damper",
            "linear_quarter_car_2dof_dynamics",
            "linear_full_car_7dof_dynamics",
            "linear_planar_bicycle_handling",
            "step_smooth_bump_half_sine_sine_and_sampled_road_inputs",
            "deterministic_bounded_engineering_optimization",
            "normalized_weighted_multi_objective_and_pareto",
            "baseline_comparison_and_local_sensitivity",
        ],
        "notImplemented": [
            "rocker_kinematic_closure",
            "structural_stress_and_fatigue",
            "reports",
        ],
        "modelStatus": "unvalidated",
        "solverVersion": KINEMATICS_SOLVER_VERSION,
        "quasiStaticSolverVersion": QUASI_STATIC_SOLVER_VERSION,
        "dynamicsSolverVersion": DYNAMICS_SOLVER_VERSION,
        "fullCarSolverVersion": FULL_CAR_SOLVER_VERSION,
        "bicycleSolverVersion": BICYCLE_SOLVER_VERSION,
        "optimizationSolverVersion": OPTIMIZATION_SOLVER_VERSION,
        "qualityStates": [
            "VERIFIED_NUMERICALLY",
            "REFERENCE_BENCHMARKED",
            "UNVALIDATED_PHYSICALLY",
            "FAILED",
            "NOT_COMPUTABLE",
        ],
    }
