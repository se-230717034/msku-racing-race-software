"""Constant-speed linear planar bicycle handling model.

The vehicle frame is right handed: +X forward, +Y left, +Z upward. Positive
steering turns the front road wheel left, positive lateral tire force acts left,
and positive yaw rate is counter-clockwise viewed from above.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from math import cos, pi, sin, sqrt
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from scipy.integrate import solve_ivp

from .vehicle_dynamics import CalculationStatus, DynamicsSettings, IntegrationMethod

BICYCLE_SOLVER_VERSION = "5.0.0"
SteeringKind = Literal["step", "smooth_step", "sine", "sampled"]


@dataclass(frozen=True)
class BicycleParameters:
    mass_kg: float
    yaw_inertia_kg_m2: float
    cg_to_front_axle_m: float
    cg_to_rear_axle_m: float
    front_cornering_stiffness_n_per_rad: float
    rear_cornering_stiffness_n_per_rad: float
    speed_mps: float


@dataclass(frozen=True)
class SteeringProfile:
    kind: SteeringKind
    amplitude_rad: float = 0.0
    start_time_s: float = 0.0
    rise_time_s: float = 0.1
    frequency_hz: float = 1.0
    sample_times_s: tuple[float, ...] = ()
    sample_angles_rad: tuple[float, ...] = ()


@dataclass(frozen=True)
class BicycleInitialState:
    lateral_velocity_mps: float = 0.0
    yaw_rate_radps: float = 0.0


@dataclass(frozen=True)
class BicycleDomainLimits:
    maximum_abs_steering_rad: float = 0.15
    maximum_abs_sideslip_rad: float = 0.15
    maximum_abs_tire_slip_rad: float = 0.15


@dataclass(frozen=True)
class BicycleSample:
    time_s: float
    steering_rad: float
    lateral_velocity_mps: float
    yaw_rate_radps: float
    sideslip_rad: float
    lateral_acceleration_mps2: float
    front_slip_angle_rad: float
    rear_slip_angle_rad: float
    front_lateral_force_n: float
    rear_lateral_force_n: float


@dataclass(frozen=True)
class BicycleDiagnostics:
    solver_success: bool
    finite_states: bool
    stable: bool | None
    domain_accepted: bool
    function_evaluations: int
    jacobian_evaluations: int
    lu_decompositions: int
    integration_method: IntegrationMethod
    relative_tolerance: float
    absolute_tolerance: float
    maximum_step_s: float
    accepted_steps: int
    minimum_accepted_step_s: float | None
    maximum_accepted_step_s: float | None
    eigenvalues_real: tuple[float, float] | None
    eigenvalues_imag: tuple[float, float] | None
    understeer_coefficient_s2_per_m: float | None
    characteristic_speed_mps: float | None
    critical_speed_mps: float | None
    steady_state_yaw_rate_gain_per_s: float | None
    steady_state_sideslip_gain: float | None
    maximum_abs_sideslip_rad: float | None
    maximum_abs_front_slip_rad: float | None
    maximum_abs_rear_slip_rad: float | None
    message: str


@dataclass(frozen=True)
class BicycleResult:
    calculation_status: CalculationStatus
    samples: tuple[BicycleSample, ...]
    diagnostics: BicycleDiagnostics
    warnings: tuple[str, ...]
    solver_version: str = BICYCLE_SOLVER_VERSION
    reference_status: str = "REFERENCE_BENCHMARKED"
    physical_status: str = "UNVALIDATED_PHYSICALLY"


DEFAULT_BICYCLE_INITIAL_STATE = BicycleInitialState()
DEFAULT_BICYCLE_DOMAIN_LIMITS = BicycleDomainLimits()
DEFAULT_BICYCLE_SETTINGS = DynamicsSettings()


def _finite(values: tuple[float, ...]) -> bool:
    return bool(np.all(np.isfinite(np.asarray(values, dtype=np.float64))))


def steering_angle(profile: SteeringProfile, time_s: float) -> float:
    if not np.isfinite(time_s):
        raise ValueError("Steering evaluation time must be finite")
    relative = time_s - profile.start_time_s
    if profile.kind == "step":
        return profile.amplitude_rad if relative >= 0.0 else 0.0
    if profile.kind == "smooth_step":
        if relative <= 0.0:
            return 0.0
        if relative >= profile.rise_time_s:
            return profile.amplitude_rad
        return 0.5 * profile.amplitude_rad * (
            1.0 - cos(pi * relative / profile.rise_time_s)
        )
    if profile.kind == "sine":
        if relative < 0.0:
            return 0.0
        return profile.amplitude_rad * sin(2.0 * pi * profile.frequency_hz * relative)
    if profile.kind == "sampled":
        if time_s <= profile.sample_times_s[0]:
            return profile.sample_angles_rad[0]
        if time_s >= profile.sample_times_s[-1]:
            return profile.sample_angles_rad[-1]
        index = int(np.searchsorted(np.asarray(profile.sample_times_s), time_s, side="right") - 1)
        span = profile.sample_times_s[index + 1] - profile.sample_times_s[index]
        fraction = (time_s - profile.sample_times_s[index]) / span
        return profile.sample_angles_rad[index] + fraction * (
            profile.sample_angles_rad[index + 1] - profile.sample_angles_rad[index]
        )
    raise ValueError(f"Unsupported steering profile: {profile.kind}")


def steering_breakpoints(profile: SteeringProfile, duration_s: float) -> tuple[float, ...]:
    points: set[float] = {0.0, duration_s}
    if profile.kind in ("step", "smooth_step", "sine"):
        points.add(profile.start_time_s)
    if profile.kind == "smooth_step":
        points.add(profile.start_time_s + profile.rise_time_s)
    if profile.kind == "sampled":
        points.update(profile.sample_times_s)
    return tuple(sorted(point for point in points if 0.0 <= point <= duration_s))


def bicycle_state_matrices(
    parameters: BicycleParameters,
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Return xdot=A*x+B*delta for x=[lateral velocity, yaw rate]."""
    mass = parameters.mass_kg
    inertia = parameters.yaw_inertia_kg_m2
    front = parameters.cg_to_front_axle_m
    rear = parameters.cg_to_rear_axle_m
    cf = parameters.front_cornering_stiffness_n_per_rad
    cr = parameters.rear_cornering_stiffness_n_per_rad
    speed = parameters.speed_mps
    matrix = np.asarray(
        [
            [
                -(cf + cr) / (mass * speed),
                (-front * cf + rear * cr) / (mass * speed) - speed,
            ],
            [
                (-front * cf + rear * cr) / (inertia * speed),
                -(front**2 * cf + rear**2 * cr) / (inertia * speed),
            ],
        ],
        dtype=np.float64,
    )
    input_vector = np.asarray([cf / mass, front * cf / inertia], dtype=np.float64)
    return matrix, input_vector


def steady_state_bicycle_response(parameters: BicycleParameters) -> tuple[float, float]:
    """Return analytical yaw-rate and sideslip gains per radian of steady steer."""
    mass = parameters.mass_kg
    front = parameters.cg_to_front_axle_m
    rear = parameters.cg_to_rear_axle_m
    wheelbase = front + rear
    cf = parameters.front_cornering_stiffness_n_per_rad
    cr = parameters.rear_cornering_stiffness_n_per_rad
    speed = parameters.speed_mps
    denominator = wheelbase + mass * speed**2 / wheelbase * (rear / cf - front / cr)
    if abs(denominator) <= 1.0e-12 * max(wheelbase, 1.0):
        raise ValueError("Steady-state bicycle response denominator is singular")
    yaw_gain = speed / denominator
    sideslip_gain = rear * yaw_gain / speed - mass * front * speed * yaw_gain / (
        wheelbase * cr
    )
    return yaw_gain, sideslip_gain


def _validate(
    parameters: BicycleParameters,
    steering: SteeringProfile,
    initial: BicycleInitialState,
    limits: BicycleDomainLimits,
    settings: DynamicsSettings,
) -> str | None:
    values = (
        parameters.mass_kg,
        parameters.yaw_inertia_kg_m2,
        parameters.cg_to_front_axle_m,
        parameters.cg_to_rear_axle_m,
        parameters.front_cornering_stiffness_n_per_rad,
        parameters.rear_cornering_stiffness_n_per_rad,
        parameters.speed_mps,
        initial.lateral_velocity_mps,
        initial.yaw_rate_radps,
        limits.maximum_abs_steering_rad,
        limits.maximum_abs_sideslip_rad,
        limits.maximum_abs_tire_slip_rad,
        settings.duration_s,
        settings.relative_tolerance,
        settings.absolute_tolerance,
        settings.maximum_step_s,
        steering.amplitude_rad,
        steering.start_time_s,
        steering.rise_time_s,
        steering.frequency_hz,
    )
    if not _finite(values):
        return "Bicycle model inputs must be finite."
    if min(values[:7]) <= 0.0:
        return "Mass, inertia, axle distances, cornering stiffnesses, and speed must be positive."
    if parameters.speed_mps < 0.5:
        return "The linear dynamic bicycle model requires speed >= 0.5 m/s."
    if min(
        limits.maximum_abs_steering_rad,
        limits.maximum_abs_sideslip_rad,
        limits.maximum_abs_tire_slip_rad,
    ) <= 0.0:
        return "Linear-domain angle limits must be positive."
    if (
        settings.duration_s <= 0.0
        or settings.output_samples < 2
        or settings.output_samples > 20_001
        or not 1.0e-12 <= settings.relative_tolerance <= 1.0e-2
        or not 1.0e-14 <= settings.absolute_tolerance <= 1.0e-3
        or settings.maximum_step_s <= 0.0
        or settings.maximum_step_s > settings.duration_s
        or settings.method not in ("DOP853", "Radau", "BDF")
    ):
        return "Simulation duration, samples, tolerances, step, or method are invalid."
    if steering.start_time_s < 0.0 or steering.start_time_s > settings.duration_s:
        return "Steering start time must lie inside the simulation interval."
    if steering.kind == "smooth_step" and steering.rise_time_s <= 0.0:
        return "Smooth-step rise time must be positive."
    if steering.kind == "sine" and steering.frequency_hz <= 0.0:
        return "Steering sine frequency must be positive."
    if steering.kind == "sampled":
        if len(steering.sample_times_s) < 2 or len(steering.sample_times_s) != len(
            steering.sample_angles_rad
        ):
            return "Sampled steering arrays must have equal length and at least two points."
        if not _finite((*steering.sample_times_s, *steering.sample_angles_rad)):
            return "Sampled steering values must be finite."
        if any(
            second <= first
            for first, second in zip(
                steering.sample_times_s, steering.sample_times_s[1:], strict=True
            )
        ):
            return "Sampled steering times must be strictly increasing."
    if steering.kind not in ("step", "smooth_step", "sine", "sampled"):
        return "Unsupported steering profile."
    return None


def _failed(
    settings: DynamicsSettings,
    message: str,
    warning: str,
    *,
    stable: bool | None = None,
    eigenvalues: NDArray[np.complex128] | None = None,
    nfev: int = 0,
    njev: int = 0,
    nlu: int = 0,
    steps: tuple[float, ...] = (),
    finite: bool = False,
    maximum_sideslip: float | None = None,
    maximum_front_slip: float | None = None,
    maximum_rear_slip: float | None = None,
    understeer: float | None = None,
    characteristic_speed: float | None = None,
    critical_speed: float | None = None,
    steady_gains: tuple[float, float] | None = None,
) -> BicycleResult:
    return BicycleResult(
        calculation_status="FAILED",
        samples=(),
        diagnostics=BicycleDiagnostics(
            solver_success=False,
            finite_states=finite,
            stable=stable,
            domain_accepted=False,
            function_evaluations=nfev,
            jacobian_evaluations=njev,
            lu_decompositions=nlu,
            integration_method=settings.method,
            relative_tolerance=settings.relative_tolerance,
            absolute_tolerance=settings.absolute_tolerance,
            maximum_step_s=settings.maximum_step_s,
            accepted_steps=len(steps),
            minimum_accepted_step_s=min(steps) if steps else None,
            maximum_accepted_step_s=max(steps) if steps else None,
            eigenvalues_real=(
                tuple(float(value.real) for value in eigenvalues)  # type: ignore[arg-type]
                if eigenvalues is not None
                else None
            ),
            eigenvalues_imag=(
                tuple(float(value.imag) for value in eigenvalues)  # type: ignore[arg-type]
                if eigenvalues is not None
                else None
            ),
            understeer_coefficient_s2_per_m=understeer,
            characteristic_speed_mps=characteristic_speed,
            critical_speed_mps=critical_speed,
            steady_state_yaw_rate_gain_per_s=(steady_gains[0] if steady_gains else None),
            steady_state_sideslip_gain=(steady_gains[1] if steady_gains else None),
            maximum_abs_sideslip_rad=maximum_sideslip,
            maximum_abs_front_slip_rad=maximum_front_slip,
            maximum_abs_rear_slip_rad=maximum_rear_slip,
            message=message,
        ),
        warnings=(warning,),
    )


def simulate_bicycle(
    parameters: BicycleParameters,
    steering: SteeringProfile,
    initial: BicycleInitialState = DEFAULT_BICYCLE_INITIAL_STATE,
    limits: BicycleDomainLimits = DEFAULT_BICYCLE_DOMAIN_LIMITS,
    settings: DynamicsSettings = DEFAULT_BICYCLE_SETTINGS,
) -> BicycleResult:
    """Integrate linear lateral/yaw dynamics at constant longitudinal speed."""
    invalid = _validate(parameters, steering, initial, limits, settings)
    if invalid is not None:
        return _failed(settings, invalid, "INVALID_BICYCLE_INPUT")
    matrix, input_vector = bicycle_state_matrices(parameters)
    eigenvalues = np.asarray(np.linalg.eigvals(matrix), dtype=np.complex128)
    stable = bool(np.max(eigenvalues.real) < 0.0)
    wheelbase = parameters.cg_to_front_axle_m + parameters.cg_to_rear_axle_m
    understeer = parameters.mass_kg / wheelbase * (
        parameters.cg_to_rear_axle_m / parameters.front_cornering_stiffness_n_per_rad
        - parameters.cg_to_front_axle_m / parameters.rear_cornering_stiffness_n_per_rad
    )
    characteristic_speed = sqrt(wheelbase / understeer) if understeer > 0.0 else None
    critical_speed = sqrt(-wheelbase / understeer) if understeer < 0.0 else None
    try:
        steady_gains = steady_state_bicycle_response(parameters)
    except ValueError:
        return _failed(
            settings,
            "Steady-state response is singular at the requested speed.",
            "BICYCLE_STEADY_STATE_SINGULAR",
            stable=stable,
            eigenvalues=eigenvalues,
            understeer=understeer,
            characteristic_speed=characteristic_speed,
            critical_speed=critical_speed,
        )

    def derivative(time_s: float, state: NDArray[np.float64]) -> NDArray[np.float64]:
        return matrix @ state + input_vector * steering_angle(steering, time_s)

    breakpoints = steering_breakpoints(steering, settings.duration_s)
    intervals = tuple(zip(breakpoints, breakpoints[1:], strict=False))
    state_at_start = np.asarray(
        [initial.lateral_velocity_mps, initial.yaw_rate_radps], dtype=np.float64
    )
    solutions: list[Callable[[float], NDArray[np.float64]]] = []
    accepted_steps: list[float] = []
    nfev = 0
    njev = 0
    nlu = 0
    for start, end in intervals:
        def interval_derivative(
            time_s: float,
            state: NDArray[np.float64],
            *,
            interval_start: float = start,
            interval_end: float = end,
        ) -> NDArray[np.float64]:
            evaluation_time = time_s
            if time_s >= interval_end and interval_end < settings.duration_s:
                evaluation_time = float(np.nextafter(interval_end, interval_start))
            return derivative(evaluation_time, state)

        if settings.method in ("Radau", "BDF"):
            solution = solve_ivp(
                interval_derivative,
                (start, end),
                state_at_start,
                method=settings.method,
                rtol=settings.relative_tolerance,
                atol=settings.absolute_tolerance,
                max_step=settings.maximum_step_s,
                dense_output=True,
                jac=matrix,
            )
        else:
            solution = solve_ivp(
                interval_derivative,
                (start, end),
                state_at_start,
                method=settings.method,
                rtol=settings.relative_tolerance,
                atol=settings.absolute_tolerance,
                max_step=settings.maximum_step_s,
                dense_output=True,
            )
        nfev += int(solution.nfev)
        njev += int(solution.njev)
        nlu += int(solution.nlu)
        accepted_steps.extend(float(value) for value in np.diff(solution.t))
        if not solution.success or solution.sol is None:
            return _failed(
                settings,
                str(solution.message),
                "BICYCLE_INTEGRATION_FAILED",
                stable=stable,
                eigenvalues=eigenvalues,
                nfev=nfev,
                njev=njev,
                nlu=nlu,
                steps=tuple(accepted_steps),
                understeer=understeer,
                characteristic_speed=characteristic_speed,
                critical_speed=critical_speed,
                steady_gains=steady_gains,
            )
        solutions.append(solution.sol)
        state_at_start = np.asarray(solution.y[:, -1], dtype=np.float64)

    output_times = np.linspace(0.0, settings.duration_s, settings.output_samples)
    states = np.empty((2, output_times.size), dtype=np.float64)
    for index, time_s in enumerate(output_times):
        solution_index = min(
            int(np.searchsorted(np.asarray(breakpoints), time_s, side="right") - 1),
            len(solutions) - 1,
        )
        states[:, index] = np.asarray(solutions[solution_index](float(time_s)), dtype=np.float64)
    if not np.all(np.isfinite(states)):
        return _failed(
            settings,
            "The bicycle integrator returned non-finite states.",
            "NONFINITE_BICYCLE_STATE",
            stable=stable,
            eigenvalues=eigenvalues,
            nfev=nfev,
            njev=njev,
            nlu=nlu,
            steps=tuple(accepted_steps),
            understeer=understeer,
            characteristic_speed=characteristic_speed,
            critical_speed=critical_speed,
            steady_gains=steady_gains,
        )

    samples: list[BicycleSample] = []
    maximum_sideslip = 0.0
    maximum_front_slip = 0.0
    maximum_rear_slip = 0.0
    maximum_steering = 0.0
    speed = parameters.speed_mps
    front = parameters.cg_to_front_axle_m
    rear = parameters.cg_to_rear_axle_m
    cf = parameters.front_cornering_stiffness_n_per_rad
    cr = parameters.rear_cornering_stiffness_n_per_rad
    for index, time_s in enumerate(output_times):
        lateral_velocity, yaw_rate = states[:, index]
        steer = steering_angle(steering, float(time_s))
        sideslip = lateral_velocity / speed
        front_slip = steer - (lateral_velocity + front * yaw_rate) / speed
        rear_slip = -(lateral_velocity - rear * yaw_rate) / speed
        front_force = cf * front_slip
        rear_force = cr * rear_slip
        lateral_acceleration = (front_force + rear_force) / parameters.mass_kg
        maximum_steering = max(maximum_steering, abs(steer))
        maximum_sideslip = max(maximum_sideslip, abs(sideslip))
        maximum_front_slip = max(maximum_front_slip, abs(front_slip))
        maximum_rear_slip = max(maximum_rear_slip, abs(rear_slip))
        samples.append(
            BicycleSample(
                time_s=float(time_s),
                steering_rad=float(steer),
                lateral_velocity_mps=float(lateral_velocity),
                yaw_rate_radps=float(yaw_rate),
                sideslip_rad=float(sideslip),
                lateral_acceleration_mps2=float(lateral_acceleration),
                front_slip_angle_rad=float(front_slip),
                rear_slip_angle_rad=float(rear_slip),
                front_lateral_force_n=float(front_force),
                rear_lateral_force_n=float(rear_force),
            )
        )
    domain_accepted = (
        maximum_steering <= limits.maximum_abs_steering_rad
        and maximum_sideslip <= limits.maximum_abs_sideslip_rad
        and maximum_front_slip <= limits.maximum_abs_tire_slip_rad
        and maximum_rear_slip <= limits.maximum_abs_tire_slip_rad
    )
    if not domain_accepted:
        return _failed(
            settings,
            "A steering, sideslip, or tire-slip angle exceeded the declared linear domain.",
            "LINEAR_BICYCLE_DOMAIN_EXCEEDED",
            stable=stable,
            eigenvalues=eigenvalues,
            nfev=nfev,
            njev=njev,
            nlu=nlu,
            steps=tuple(accepted_steps),
            finite=True,
            maximum_sideslip=maximum_sideslip,
            maximum_front_slip=maximum_front_slip,
            maximum_rear_slip=maximum_rear_slip,
            understeer=understeer,
            characteristic_speed=characteristic_speed,
            critical_speed=critical_speed,
            steady_gains=steady_gains,
        )
    warnings = [
        "LINEAR_PLANAR_BICYCLE_CONSTANT_SPEED",
        "SMALL_ANGLE_LINEAR_TIRE_FORCES",
        "NO_LOAD_TRANSFER_COMBINED_SLIP_OR_AERO",
        "PHYSICAL_VALIDATION_EVIDENCE_NOT_ATTACHED",
    ]
    if not stable:
        warnings.append("OPEN_LOOP_LINEAR_MODEL_UNSTABLE_AT_REQUESTED_SPEED")
    return BicycleResult(
        calculation_status="VERIFIED_NUMERICALLY",
        samples=tuple(samples),
        diagnostics=BicycleDiagnostics(
            solver_success=True,
            finite_states=True,
            stable=stable,
            domain_accepted=True,
            function_evaluations=nfev,
            jacobian_evaluations=njev,
            lu_decompositions=nlu,
            integration_method=settings.method,
            relative_tolerance=settings.relative_tolerance,
            absolute_tolerance=settings.absolute_tolerance,
            maximum_step_s=settings.maximum_step_s,
            accepted_steps=len(accepted_steps),
            minimum_accepted_step_s=min(accepted_steps) if accepted_steps else None,
            maximum_accepted_step_s=max(accepted_steps) if accepted_steps else None,
            eigenvalues_real=tuple(float(value.real) for value in eigenvalues),  # type: ignore[arg-type]
            eigenvalues_imag=tuple(float(value.imag) for value in eigenvalues),  # type: ignore[arg-type]
            understeer_coefficient_s2_per_m=understeer,
            characteristic_speed_mps=characteristic_speed,
            critical_speed_mps=critical_speed,
            steady_state_yaw_rate_gain_per_s=steady_gains[0],
            steady_state_sideslip_gain=steady_gains[1],
            maximum_abs_sideslip_rad=maximum_sideslip,
            maximum_abs_front_slip_rad=maximum_front_slip,
            maximum_abs_rear_slip_rad=maximum_rear_slip,
            message="Integration reached final time and linear-domain checks passed.",
        ),
        warnings=tuple(warnings),
    )
