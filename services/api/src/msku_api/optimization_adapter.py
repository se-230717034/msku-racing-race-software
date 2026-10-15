"""Verified-model adapters for the generic Phase 5 optimization engine."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from math import sqrt

import numpy as np
from msku_engineering import (
    BicycleDomainLimits,
    BicycleInitialState,
    BicycleParameters,
    DesignVariable,
    DynamicsSettings,
    FullCarCornerParameters,
    FullCarInitialState,
    FullCarParameters,
    FullCarRoadInputs,
    ModelEvaluation,
    QuarterCarInitialState,
    QuarterCarParameters,
    RoadProfile,
    SolverSettings,
    SteeringProfile,
    link_lengths,
    simulate_bicycle,
    simulate_full_car,
    simulate_quarter_car,
    solve_sweep,
    validate_corner,
)

from .models import (
    BicycleSimulationRequest,
    DynamicsSettingsInput,
    EngineeringOptimizationRequest,
    FullCarSimulationRequest,
    QuarterCarSimulationRequest,
    RoadProfileInput,
)

KINEMATICS_OBJECTIVES = (
    "bump_steer_rms_rad",
    "camber_variation_rms_rad",
    "roll_center_migration_rms_m",
    "maximum_abs_track_change_m",
)
QUARTER_CAR_OBJECTIVES = (
    "sprung_acceleration_rms_mps2",
    "maximum_abs_suspension_travel_m",
)
FULL_CAR_OBJECTIVES = (
    "body_heave_acceleration_rms_mps2",
    "maximum_abs_suspension_travel_m",
    "maximum_abs_pitch_rad",
    "maximum_abs_roll_rad",
)
BICYCLE_OBJECTIVES = (
    "final_yaw_rate_radps",
    "maximum_abs_sideslip_rad",
    "lateral_acceleration_rms_mps2",
    "final_lateral_acceleration_mps2",
)
AVAILABLE_OBJECTIVES = {
    "kinematics": KINEMATICS_OBJECTIVES,
    "quarter_car": QUARTER_CAR_OBJECTIVES,
    "full_car": FULL_CAR_OBJECTIVES,
    "bicycle": BICYCLE_OBJECTIVES,
}

_QUARTER_FIELDS = {
    "parameters.suspensionStiffnessNPerM": "suspension_stiffness_n_per_m",
    "parameters.suspensionDampingNsPerM": "suspension_damping_ns_per_m",
    "parameters.tireStiffnessNPerM": "tire_stiffness_n_per_m",
    "parameters.tireDampingNsPerM": "tire_damping_ns_per_m",
}
_FULL_CORNER_FIELDS = {
    "unsprungMassKg": "unsprung_mass_kg",
    "suspensionStiffnessNPerM": "suspension_stiffness_n_per_m",
    "suspensionDampingNsPerM": "suspension_damping_ns_per_m",
    "tireStiffnessNPerM": "tire_stiffness_n_per_m",
    "tireDampingNsPerM": "tire_damping_ns_per_m",
}
_BICYCLE_FIELDS = {
    "parameters.frontCorneringStiffnessNPerRad": "front_cornering_stiffness_n_per_rad",
    "parameters.rearCorneringStiffnessNPerRad": "rear_cornering_stiffness_n_per_rad",
    "parameters.speedMps": "speed_mps",
}


def _road(value: RoadProfileInput) -> RoadProfile:
    return RoadProfile(
        kind=value.kind,
        amplitude_m=value.amplitudeM,
        start_time_s=value.startTimeS,
        duration_s=value.durationS,
        frequency_hz=value.frequencyHz,
        sample_times_s=tuple(value.sampleTimesS),
        sample_displacements_m=tuple(value.sampleDisplacementsM),
    )


def _settings(value: DynamicsSettingsInput) -> DynamicsSettings:
    return DynamicsSettings(
        duration_s=value.durationS,
        output_samples=value.outputSamples,
        relative_tolerance=value.relativeTolerance,
        absolute_tolerance=value.absoluteTolerance,
        maximum_step_s=value.maximumStepS,
        method=value.method,
    )


def _rms(values: list[float]) -> float:
    array = np.asarray(values, dtype=np.float64)
    return float(sqrt(float(np.mean(array * array))))


def _require_objectives(request: EngineeringOptimizationRequest) -> None:
    supported = AVAILABLE_OBJECTIVES[request.model]
    unsupported = sorted({item.id for item in request.objectives} - set(supported))
    if unsupported:
        raise ValueError(
            f"Unsupported or unverified {request.model} objectives: {', '.join(unsupported)}"
        )


def _kinematics_adapter(
    request: EngineeringOptimizationRequest,
) -> tuple[tuple[DesignVariable, ...], Callable[[Mapping[str, float]], ModelEvaluation]]:
    project = request.project
    sweep = request.kinematicsSweep
    if project is None or sweep is None:
        raise ValueError("Kinematics optimization requires project and sweep payloads")
    solver = request.kinematicsSolver
    solver_settings = SolverSettings(
        residual_tolerance_m=solver.residualToleranceM if solver else 1.0e-8,
        max_function_evaluations=solver.maxFunctionEvaluations if solver else 500,
    )
    base_points = {
        item.id: (item.position.x, item.position.y, item.position.z)
        for item in project.suspension.hardpoints
    }
    axis_index = {"x": 0, "y": 1, "z": 2}
    parsed_paths: dict[str, tuple[str, int]] = {}
    variables: list[DesignVariable] = []
    for item in request.designVariables:
        parts = item.path.split(".")
        if len(parts) != 3 or parts[0] != "hardpoints" or parts[2] not in axis_index:
            raise ValueError(
                f"Unsupported kinematics variable path {item.path}; expected hardpoints.<id>.<axis>"
            )
        point_id = parts[1]
        if point_id not in base_points:
            raise ValueError(f"Unknown hardpoint in design variable: {point_id}")
        index = axis_index[parts[2]]
        parsed_paths[item.path] = (point_id, index)
        variables.append(
            DesignVariable(
                item.path,
                base_points[point_id][index],
                item.lowerBound,
                item.upperBound,
            )
        )

    def evaluate(values: Mapping[str, float]) -> ModelEvaluation:
        points = {name: list(point) for name, point in base_points.items()}
        for path, value in values.items():
            point_id, index = parsed_paths[path]
            points[point_id][index] = value
        immutable = {name: tuple(point) for name, point in points.items()}
        try:
            if min(link_lengths(immutable).values()) < request.constraints.minimumLinkLengthM:
                return ModelEvaluation({}, False, ("MINIMUM_LINK_LENGTH_VIOLATION",))
            geometry_errors = tuple(
                item.code
                for item in validate_corner(
                    immutable,
                    project.suspension.wheel.radius,
                    project.suspension.wheel.width,
                    project.suspension.corner,
                )
                if item.severity == "error"
            )
            if geometry_errors:
                return ModelEvaluation({}, False, geometry_errors)
            travel_limit = request.constraints.maximumAbsSuspensionTravelM
            if travel_limit is not None and max(
                abs(sweep.startTravelM), abs(sweep.endTravelM)
            ) > travel_limit:
                return ModelEvaluation({}, False, ("SUSPENSION_TRAVEL_LIMIT_EXCEEDED",))
            result = solve_sweep(
                immutable,
                sweep.startTravelM,
                sweep.endTravelM,
                sweep.steps,
                project.suspension.wheel.radius,
                project.suspension.wheel.staticCamberRad,
                project.suspension.wheel.staticToeRad,
                project.suspension.corner,
                solver_settings,
            )
        except (ValueError, FloatingPointError):
            return ModelEvaluation({}, False, ("KINEMATICS_EVALUATION_EXCEPTION",))
        if not result.all_converged:
            return ModelEvaluation({}, False, ("KINEMATICS_SWEEP_FAILED",))
        metrics = [item.metrics for item in result.states]
        if any(item is None for item in metrics):
            return ModelEvaluation({}, False, ("KINEMATICS_METRICS_MISSING",))
        accepted = [item for item in metrics if item is not None]
        roll_centres = [item.roll_center_height_m for item in accepted]
        values_out = {
            "bump_steer_rms_rad": _rms([item.bump_steer_rad for item in accepted]),
            "camber_variation_rms_rad": _rms(
                [item.camber_change_rad for item in accepted]
            ),
            "maximum_abs_track_change_m": max(abs(item.track_change_m) for item in accepted),
        }
        requested_ids = {item.id for item in request.objectives}
        if "roll_center_migration_rms_m" in requested_ids:
            if any(value is None for value in roll_centres):
                return ModelEvaluation({}, False, ("ROLL_CENTER_NOT_COMPUTABLE",))
            zero_index = min(
                range(len(result.states)), key=lambda index: abs(result.states[index].travel_m)
            )
            reference = roll_centres[zero_index]
            if reference is None:
                return ModelEvaluation({}, False, ("ROLL_CENTER_NOT_COMPUTABLE",))
            values_out["roll_center_migration_rms_m"] = _rms(
                [float(value) - reference for value in roll_centres if value is not None]
            )
        return ModelEvaluation(values_out, True)

    return tuple(variables), evaluate


def _quarter_parameters(payload: QuarterCarSimulationRequest) -> QuarterCarParameters:
    value = payload.parameters
    return QuarterCarParameters(
        sprung_mass_kg=value.sprungMassKg,
        unsprung_mass_kg=value.unsprungMassKg,
        suspension_stiffness_n_per_m=value.suspensionStiffnessNPerM,
        suspension_damping_ns_per_m=value.suspensionDampingNsPerM,
        tire_stiffness_n_per_m=value.tireStiffnessNPerM,
        tire_damping_ns_per_m=value.tireDampingNsPerM,
        static_tire_load_n=value.staticTireLoadN,
    )


def _quarter_adapter(
    request: EngineeringOptimizationRequest,
) -> tuple[tuple[DesignVariable, ...], Callable[[Mapping[str, float]], ModelEvaluation]]:
    payload = request.quarterCar
    if payload is None:
        raise ValueError("Quarter-car optimization payload is missing")
    base = _quarter_parameters(payload)
    variables: list[DesignVariable] = []
    mapped: dict[str, str] = {}
    for item in request.designVariables:
        field = _QUARTER_FIELDS.get(item.path)
        if field is None:
            raise ValueError(f"Unsupported quarter-car design variable: {item.path}")
        mapped[item.path] = field
        variables.append(
            DesignVariable(
                item.path, float(getattr(base, field)), item.lowerBound, item.upperBound
            )
        )

    def evaluate(values: Mapping[str, float]) -> ModelEvaluation:
        updates = {mapped[path]: value for path, value in values.items()}
        parameters = QuarterCarParameters(**{**base.__dict__, **updates})
        initial = payload.initialState
        result = simulate_quarter_car(
            parameters,
            _road(payload.road),
            QuarterCarInitialState(
                sprung_displacement_m=initial.sprungDisplacementM,
                sprung_velocity_mps=initial.sprungVelocityMps,
                unsprung_displacement_m=initial.unsprungDisplacementM,
                unsprung_velocity_mps=initial.unsprungVelocityMps,
            ),
            _settings(payload.settings),
        )
        if result.calculation_status != "VERIFIED_NUMERICALLY" or not result.samples:
            return ModelEvaluation({}, False, tuple(result.warnings) or ("QUARTER_CAR_FAILED",))
        if (
            request.constraints.requireWheelContact
            and result.diagnostics.contact_accepted is not True
        ):
            return ModelEvaluation({}, False, ("WHEEL_CONTACT_NOT_VERIFIED",))
        maximum_travel = max(abs(item.suspension_travel_m) for item in result.samples)
        limit = request.constraints.maximumAbsSuspensionTravelM
        if limit is not None and maximum_travel > limit:
            return ModelEvaluation({}, False, ("SUSPENSION_TRAVEL_LIMIT_EXCEEDED",))
        return ModelEvaluation(
            {
                "sprung_acceleration_rms_mps2": _rms(
                    [item.sprung_acceleration_mps2 for item in result.samples]
                ),
                "maximum_abs_suspension_travel_m": maximum_travel,
            },
            True,
        )

    return tuple(variables), evaluate


def _full_parameters(payload: FullCarSimulationRequest) -> FullCarParameters:
    return FullCarParameters(
        sprung_mass_kg=payload.parameters.sprungMassKg,
        pitch_inertia_kg_m2=payload.parameters.pitchInertiaKgM2,
        roll_inertia_kg_m2=payload.parameters.rollInertiaKgM2,
        corners=tuple(
            FullCarCornerParameters(
                x_position_m=item.xPositionM,
                y_position_m=item.yPositionM,
                unsprung_mass_kg=item.unsprungMassKg,
                suspension_stiffness_n_per_m=item.suspensionStiffnessNPerM,
                suspension_damping_ns_per_m=item.suspensionDampingNsPerM,
                tire_stiffness_n_per_m=item.tireStiffnessNPerM,
                tire_damping_ns_per_m=item.tireDampingNsPerM,
                static_tire_load_n=item.staticTireLoadN,
            )
            for item in payload.parameters.corners
        ),
    )


def _full_adapter(
    request: EngineeringOptimizationRequest,
) -> tuple[tuple[DesignVariable, ...], Callable[[Mapping[str, float]], ModelEvaluation]]:
    payload = request.fullCar
    if payload is None:
        raise ValueError("Full-car optimization payload is missing")
    base = _full_parameters(payload)
    parsed: dict[str, tuple[int, str]] = {}
    variables: list[DesignVariable] = []
    for item in request.designVariables:
        parts = item.path.split(".")
        if len(parts) != 4 or parts[:2] != ["parameters", "corners"]:
            raise ValueError(f"Unsupported full-car design variable: {item.path}")
        try:
            index = int(parts[2])
        except ValueError as exc:
            raise ValueError(f"Invalid full-car corner index in {item.path}") from exc
        field = _FULL_CORNER_FIELDS.get(parts[3])
        if index not in range(4) or field is None:
            raise ValueError(f"Unsupported full-car design variable: {item.path}")
        parsed[item.path] = (index, field)
        variables.append(
            DesignVariable(
                item.path,
                float(getattr(base.corners[index], field)),
                item.lowerBound,
                item.upperBound,
            )
        )

    def evaluate(values: Mapping[str, float]) -> ModelEvaluation:
        corners = list(base.corners)
        for path, value in values.items():
            index, field = parsed[path]
            corners[index] = FullCarCornerParameters(**{**corners[index].__dict__, field: value})
        parameters = FullCarParameters(
            base.sprung_mass_kg,
            base.pitch_inertia_kg_m2,
            base.roll_inertia_kg_m2,
            tuple(corners),
        )
        initial = payload.initialState
        result = simulate_full_car(
            parameters,
            FullCarRoadInputs(tuple(_road(item) for item in payload.roadProfiles)),
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
            _settings(payload.settings),
        )
        if result.calculation_status != "VERIFIED_NUMERICALLY" or not result.samples:
            return ModelEvaluation({}, False, tuple(result.warnings) or ("FULL_CAR_FAILED",))
        if (
            request.constraints.requireWheelContact
            and result.diagnostics.contact_accepted is not True
        ):
            return ModelEvaluation({}, False, ("WHEEL_CONTACT_NOT_VERIFIED",))
        maximum_travel = max(
            abs(value) for item in result.samples for value in item.suspension_travels_m
        )
        limit = request.constraints.maximumAbsSuspensionTravelM
        if limit is not None and maximum_travel > limit:
            return ModelEvaluation({}, False, ("SUSPENSION_TRAVEL_LIMIT_EXCEEDED",))
        return ModelEvaluation(
            {
                "body_heave_acceleration_rms_mps2": _rms(
                    [item.body_heave_acceleration_mps2 for item in result.samples]
                ),
                "maximum_abs_suspension_travel_m": maximum_travel,
                "maximum_abs_pitch_rad": max(abs(item.pitch_rad) for item in result.samples),
                "maximum_abs_roll_rad": max(abs(item.roll_rad) for item in result.samples),
            },
            True,
        )

    return tuple(variables), evaluate


def _bicycle_parameters(payload: BicycleSimulationRequest) -> BicycleParameters:
    value = payload.parameters
    return BicycleParameters(
        mass_kg=value.massKg,
        yaw_inertia_kg_m2=value.yawInertiaKgM2,
        cg_to_front_axle_m=value.cgToFrontAxleM,
        cg_to_rear_axle_m=value.cgToRearAxleM,
        front_cornering_stiffness_n_per_rad=value.frontCorneringStiffnessNPerRad,
        rear_cornering_stiffness_n_per_rad=value.rearCorneringStiffnessNPerRad,
        speed_mps=value.speedMps,
    )


def _bicycle_adapter(
    request: EngineeringOptimizationRequest,
) -> tuple[tuple[DesignVariable, ...], Callable[[Mapping[str, float]], ModelEvaluation]]:
    payload = request.bicycle
    if payload is None:
        raise ValueError("Bicycle optimization payload is missing")
    base = _bicycle_parameters(payload)
    mapped: dict[str, str] = {}
    variables: list[DesignVariable] = []
    for item in request.designVariables:
        field = _BICYCLE_FIELDS.get(item.path)
        if field is None:
            raise ValueError(f"Unsupported bicycle design variable: {item.path}")
        mapped[item.path] = field
        variables.append(
            DesignVariable(
                item.path, float(getattr(base, field)), item.lowerBound, item.upperBound
            )
        )

    def evaluate(values: Mapping[str, float]) -> ModelEvaluation:
        parameters = BicycleParameters(
            **{**base.__dict__, **{mapped[path]: value for path, value in values.items()}}
        )
        steering = payload.steering
        initial = payload.initialState
        limits = payload.domainLimits
        result = simulate_bicycle(
            parameters,
            SteeringProfile(
                kind=steering.kind,
                amplitude_rad=steering.amplitudeRad,
                start_time_s=steering.startTimeS,
                rise_time_s=steering.riseTimeS,
                frequency_hz=steering.frequencyHz,
                sample_times_s=tuple(steering.sampleTimesS),
                sample_angles_rad=tuple(steering.sampleAnglesRad),
            ),
            BicycleInitialState(initial.lateralVelocityMps, initial.yawRateRadps),
            BicycleDomainLimits(
                limits.maximumAbsSteeringRad,
                limits.maximumAbsSideslipRad,
                limits.maximumAbsTireSlipRad,
            ),
            _settings(payload.settings),
        )
        if result.calculation_status != "VERIFIED_NUMERICALLY" or not result.samples:
            return ModelEvaluation({}, False, tuple(result.warnings) or ("BICYCLE_FAILED",))
        if request.constraints.requireStableHandling and result.diagnostics.stable is not True:
            return ModelEvaluation({}, False, ("HANDLING_MODEL_UNSTABLE",))
        final = result.samples[-1]
        return ModelEvaluation(
            {
                "final_yaw_rate_radps": final.yaw_rate_radps,
                "maximum_abs_sideslip_rad": max(
                    abs(item.sideslip_rad) for item in result.samples
                ),
                "lateral_acceleration_rms_mps2": _rms(
                    [item.lateral_acceleration_mps2 for item in result.samples]
                ),
                "final_lateral_acceleration_mps2": final.lateral_acceleration_mps2,
            },
            True,
        )

    return tuple(variables), evaluate


def build_optimization_adapter(
    request: EngineeringOptimizationRequest,
) -> tuple[
    tuple[DesignVariable, ...],
    Callable[[Mapping[str, float]], ModelEvaluation],
    tuple[str, ...],
]:
    """Validate model paths/objectives and return the corresponding verified adapter."""
    _require_objectives(request)
    adapters = {
        "kinematics": _kinematics_adapter,
        "quarter_car": _quarter_adapter,
        "full_car": _full_adapter,
        "bicycle": _bicycle_adapter,
    }
    variables, evaluator = adapters[request.model](request)
    return variables, evaluator, AVAILABLE_OBJECTIVES[request.model]
