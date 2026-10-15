"""Numerically verified time-domain vehicle-dynamics models.

Only the two-degree-of-freedom quarter-car model is implemented. Coordinates
are perturbations from static equilibrium in SI units, so gravity and preload
must not be added again. Positive vertical displacement is upward.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from math import cos, pi, sin, sqrt
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from scipy.integrate import solve_ivp

DYNAMICS_SOLVER_VERSION = "4.0.0"
REFERENCE_STATUS: Literal["REFERENCE_BENCHMARKED"] = "REFERENCE_BENCHMARKED"
PHYSICAL_STATUS: Literal["UNVALIDATED_PHYSICALLY"] = "UNVALIDATED_PHYSICALLY"

CalculationStatus = Literal["VERIFIED_NUMERICALLY", "NOT_COMPUTABLE", "FAILED"]
RoadKind = Literal["step", "smooth_bump", "half_sine", "sine", "sampled"]
IntegrationMethod = Literal["DOP853", "Radau", "BDF"]


@dataclass(frozen=True)
class QuarterCarParameters:
    sprung_mass_kg: float
    unsprung_mass_kg: float
    suspension_stiffness_n_per_m: float
    suspension_damping_ns_per_m: float
    tire_stiffness_n_per_m: float
    tire_damping_ns_per_m: float = 0.0
    static_tire_load_n: float | None = None


@dataclass(frozen=True)
class RoadProfile:
    kind: RoadKind
    amplitude_m: float = 0.0
    start_time_s: float = 0.0
    duration_s: float = 0.1
    frequency_hz: float = 1.0
    sample_times_s: tuple[float, ...] = ()
    sample_displacements_m: tuple[float, ...] = ()


@dataclass(frozen=True)
class QuarterCarInitialState:
    sprung_displacement_m: float = 0.0
    sprung_velocity_mps: float = 0.0
    unsprung_displacement_m: float = 0.0
    unsprung_velocity_mps: float = 0.0


@dataclass(frozen=True)
class DynamicsSettings:
    duration_s: float = 2.0
    output_samples: int = 501
    relative_tolerance: float = 1.0e-8
    absolute_tolerance: float = 1.0e-10
    maximum_step_s: float = 0.005
    method: IntegrationMethod = "DOP853"


DEFAULT_INITIAL_STATE = QuarterCarInitialState()
DEFAULT_DYNAMICS_SETTINGS = DynamicsSettings()


@dataclass(frozen=True)
class QuarterCarSample:
    time_s: float
    road_displacement_m: float
    road_velocity_mps: float
    sprung_displacement_m: float
    sprung_velocity_mps: float
    sprung_acceleration_mps2: float
    unsprung_displacement_m: float
    unsprung_velocity_mps: float
    unsprung_acceleration_mps2: float
    suspension_travel_m: float
    tire_compression_m: float
    suspension_force_on_sprung_n: float
    tire_force_increment_n: float
    total_tire_contact_force_n: float | None
    mechanical_energy_j: float
    dissipated_power_w: float
    road_input_power_w: float


@dataclass(frozen=True)
class DynamicsDiagnostics:
    solver_success: bool
    finite_states: bool
    contact_accepted: bool | None
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
    initial_energy_j: float | None
    final_energy_j: float | None
    road_input_work_j: float | None
    dissipated_energy_j: float | None
    energy_balance_residual_j: float | None
    relative_energy_balance_error: float | None
    minimum_total_contact_force_n: float | None
    message: str


@dataclass(frozen=True)
class QuarterCarResult:
    calculation_status: CalculationStatus
    samples: tuple[QuarterCarSample, ...]
    diagnostics: DynamicsDiagnostics
    warnings: tuple[str, ...]
    natural_frequencies_hz: tuple[float, float] | None
    solver_version: str = DYNAMICS_SOLVER_VERSION
    reference_status: Literal["REFERENCE_BENCHMARKED"] = REFERENCE_STATUS
    physical_status: Literal["UNVALIDATED_PHYSICALLY"] = PHYSICAL_STATUS


def _finite(values: tuple[float, ...]) -> bool:
    return bool(np.all(np.isfinite(np.asarray(values, dtype=np.float64))))


def validate_road_profile(
    road: RoadProfile,
    duration_s: float,
    tire_damping_ns_per_m: float,
) -> str | None:
    """Validate one scalar road input against a simulation interval."""
    if road.kind not in ("step", "smooth_bump", "half_sine", "sine", "sampled"):
        return "Unsupported road profile."
    if not _finite((road.amplitude_m, road.start_time_s, road.duration_s, road.frequency_hz)):
        return "Road parameters must be finite."
    if road.start_time_s < 0.0 or road.start_time_s > duration_s:
        return "Road start time must lie inside the simulation interval."
    if road.kind in ("smooth_bump", "half_sine") and road.duration_s <= 0.0:
        return "Bump duration must be positive."
    if road.kind == "sine" and road.frequency_hz <= 0.0:
        return "Sine frequency must be positive."
    if road.kind == "step" and tire_damping_ns_per_m > 0.0:
        return "A displacement step has undefined road velocity and cannot use tire damping."
    if road.kind == "sampled":
        if len(road.sample_times_s) < 2 or len(road.sample_times_s) != len(
            road.sample_displacements_m
        ):
            return "Sampled road arrays must have equal length and at least two points."
        if not _finite((*road.sample_times_s, *road.sample_displacements_m)):
            return "Sampled road values must be finite."
        if any(
            second <= first
            for first, second in zip(road.sample_times_s, road.sample_times_s[1:], strict=True)
        ):
            return "Sampled road time coordinates must be strictly increasing."
    return None


def road_breakpoints(profile: RoadProfile, duration_s: float) -> tuple[float, ...]:
    """Return integration boundaries required by a piecewise road definition."""
    breakpoints: set[float] = {0.0, duration_s}
    if profile.kind in ("step", "smooth_bump", "half_sine", "sine"):
        breakpoints.add(profile.start_time_s)
    if profile.kind in ("smooth_bump", "half_sine"):
        breakpoints.add(profile.start_time_s + profile.duration_s)
    if profile.kind == "sampled":
        breakpoints.update(profile.sample_times_s)
    return tuple(sorted(point for point in breakpoints if 0.0 <= point <= duration_s))


def _validate_inputs(
    parameters: QuarterCarParameters,
    road: RoadProfile,
    initial: QuarterCarInitialState,
    settings: DynamicsSettings,
) -> str | None:
    parameter_values = (
        parameters.sprung_mass_kg,
        parameters.unsprung_mass_kg,
        parameters.suspension_stiffness_n_per_m,
        parameters.suspension_damping_ns_per_m,
        parameters.tire_stiffness_n_per_m,
        parameters.tire_damping_ns_per_m,
    )
    if not _finite(parameter_values):
        return "Vehicle parameters must be finite."
    if (
        parameters.sprung_mass_kg <= 0.0
        or parameters.unsprung_mass_kg <= 0.0
        or parameters.suspension_stiffness_n_per_m <= 0.0
        or parameters.suspension_damping_ns_per_m < 0.0
        or parameters.tire_stiffness_n_per_m <= 0.0
        or parameters.tire_damping_ns_per_m < 0.0
    ):
        return "Masses and stiffnesses must be positive; damping must be nonnegative."
    if parameters.static_tire_load_n is not None and (
        not np.isfinite(parameters.static_tire_load_n) or parameters.static_tire_load_n < 0.0
    ):
        return "Static tire load must be finite and nonnegative when supplied."
    initial_values = (
        initial.sprung_displacement_m,
        initial.sprung_velocity_mps,
        initial.unsprung_displacement_m,
        initial.unsprung_velocity_mps,
    )
    if not _finite(initial_values):
        return "Initial states must be finite."
    setting_values = (
        settings.duration_s,
        settings.relative_tolerance,
        settings.absolute_tolerance,
        settings.maximum_step_s,
    )
    if not _finite(setting_values):
        return "Simulation settings must be finite."
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
    return validate_road_profile(road, settings.duration_s, parameters.tire_damping_ns_per_m)


def road_state(profile: RoadProfile, time_s: float) -> tuple[float, float]:
    """Return road displacement and velocity using the declared interpolation."""
    if not np.isfinite(time_s):
        raise ValueError("Road evaluation time must be finite")
    relative = time_s - profile.start_time_s
    if profile.kind == "step":
        return (profile.amplitude_m if relative >= 0.0 else 0.0), 0.0
    if profile.kind == "smooth_bump":
        if relative < 0.0 or relative > profile.duration_s:
            return 0.0, 0.0
        angle = 2.0 * pi * relative / profile.duration_s
        return (
            0.5 * profile.amplitude_m * (1.0 - cos(angle)),
            profile.amplitude_m * pi / profile.duration_s * sin(angle),
        )
    if profile.kind == "half_sine":
        if relative < 0.0 or relative > profile.duration_s:
            return 0.0, 0.0
        angle = pi * relative / profile.duration_s
        return (
            profile.amplitude_m * sin(angle),
            profile.amplitude_m * pi / profile.duration_s * cos(angle),
        )
    if profile.kind == "sine":
        if relative < 0.0:
            return 0.0, 0.0
        angle = 2.0 * pi * profile.frequency_hz * relative
        return (
            profile.amplitude_m * sin(angle),
            profile.amplitude_m * 2.0 * pi * profile.frequency_hz * cos(angle),
        )
    if profile.kind == "sampled":
        times = profile.sample_times_s
        values = profile.sample_displacements_m
        if time_s <= times[0]:
            return values[0], 0.0
        if time_s >= times[-1]:
            return values[-1], 0.0
        index = int(np.searchsorted(np.asarray(times), time_s, side="right") - 1)
        dt = times[index + 1] - times[index]
        slope = (values[index + 1] - values[index]) / dt
        return values[index] + slope * (time_s - times[index]), slope
    raise ValueError(f"Unsupported road profile: {profile.kind}")


def quarter_car_natural_frequencies(parameters: QuarterCarParameters) -> tuple[float, float]:
    """Return the two undamped natural frequencies in ascending Hz."""
    ms = parameters.sprung_mass_kg
    mu = parameters.unsprung_mass_kg
    ks = parameters.suspension_stiffness_n_per_m
    kt = parameters.tire_stiffness_n_per_m
    if min(ms, mu, ks, kt) <= 0.0 or not _finite((ms, mu, ks, kt)):
        raise ValueError("Masses and stiffnesses must be finite and positive")
    coefficient = ks * mu + ms * (ks + kt)
    discriminant = coefficient**2 - 4.0 * ms * mu * ks * kt
    if discriminant < 0.0 and abs(discriminant) <= 1.0e-12 * coefficient**2:
        discriminant = 0.0
    if discriminant < 0.0:
        raise ValueError("Natural-frequency discriminant is negative")
    lambda_low = (coefficient - sqrt(discriminant)) / (2.0 * ms * mu)
    lambda_high = (coefficient + sqrt(discriminant)) / (2.0 * ms * mu)
    if lambda_low <= 0.0 or lambda_high <= 0.0:
        raise ValueError("Natural frequencies are nonpositive")
    return sqrt(lambda_low) / (2.0 * pi), sqrt(lambda_high) / (2.0 * pi)


def _failed_result(
    settings: DynamicsSettings,
    message: str,
    warning: str,
    *,
    nfev: int = 0,
    njev: int = 0,
    nlu: int = 0,
    finite_states: bool = False,
    contact_accepted: bool | None = None,
    minimum_contact_n: float | None = None,
    natural_frequencies_hz: tuple[float, float] | None = None,
    accepted_step_sizes: tuple[float, ...] = (),
) -> QuarterCarResult:
    return QuarterCarResult(
        calculation_status="FAILED",
        samples=(),
        diagnostics=DynamicsDiagnostics(
            solver_success=False,
            finite_states=finite_states,
            contact_accepted=contact_accepted,
            function_evaluations=nfev,
            jacobian_evaluations=njev,
            lu_decompositions=nlu,
            integration_method=settings.method,
            relative_tolerance=settings.relative_tolerance,
            absolute_tolerance=settings.absolute_tolerance,
            maximum_step_s=settings.maximum_step_s,
            accepted_steps=len(accepted_step_sizes),
            minimum_accepted_step_s=min(accepted_step_sizes) if accepted_step_sizes else None,
            maximum_accepted_step_s=max(accepted_step_sizes) if accepted_step_sizes else None,
            initial_energy_j=None,
            final_energy_j=None,
            road_input_work_j=None,
            dissipated_energy_j=None,
            energy_balance_residual_j=None,
            relative_energy_balance_error=None,
            minimum_total_contact_force_n=minimum_contact_n,
            message=message,
        ),
        warnings=(warning,),
        natural_frequencies_hz=natural_frequencies_hz,
    )


def simulate_quarter_car(
    parameters: QuarterCarParameters,
    road: RoadProfile,
    initial: QuarterCarInitialState = DEFAULT_INITIAL_STATE,
    settings: DynamicsSettings = DEFAULT_DYNAMICS_SETTINGS,
) -> QuarterCarResult:
    """Integrate the linear bilateral-contact quarter-car equations."""
    invalid = _validate_inputs(parameters, road, initial, settings)
    if invalid is not None:
        return _failed_result(settings, invalid, "INVALID_DYNAMICS_INPUT")
    natural_frequencies = quarter_car_natural_frequencies(parameters)

    ms = parameters.sprung_mass_kg
    mu = parameters.unsprung_mass_kg
    ks = parameters.suspension_stiffness_n_per_m
    cs = parameters.suspension_damping_ns_per_m
    kt = parameters.tire_stiffness_n_per_m
    ct = parameters.tire_damping_ns_per_m

    def derivative(time_s: float, state: NDArray[np.float64]) -> NDArray[np.float64]:
        sprung_z, sprung_v, unsprung_z, unsprung_v = state
        road_z, road_v = road_state(road, time_s)
        suspension_force = -ks * (sprung_z - unsprung_z) - cs * (sprung_v - unsprung_v)
        tire_force = kt * (road_z - unsprung_z) + ct * (road_v - unsprung_v)
        return np.asarray(
            [sprung_v, suspension_force / ms, unsprung_v, (-suspension_force + tire_force) / mu],
            dtype=np.float64,
        )

    jacobian = np.asarray(
        [
            [0.0, 1.0, 0.0, 0.0],
            [-ks / ms, -cs / ms, ks / ms, cs / ms],
            [0.0, 0.0, 0.0, 1.0],
            [ks / mu, cs / mu, -(ks + kt) / mu, -(cs + ct) / mu],
        ],
        dtype=np.float64,
    )
    initial_vector = np.asarray(
        [
            initial.sprung_displacement_m,
            initial.sprung_velocity_mps,
            initial.unsprung_displacement_m,
            initial.unsprung_velocity_mps,
        ],
        dtype=np.float64,
    )
    output_times = np.linspace(0.0, settings.duration_s, settings.output_samples)
    ordered_breakpoints = road_breakpoints(road, settings.duration_s)
    intervals = list(zip(ordered_breakpoints, ordered_breakpoints[1:], strict=False))

    solutions: list[Callable[[float], NDArray[np.float64]]] = []
    state_at_start = initial_vector
    nfev = 0
    njev = 0
    nlu = 0
    accepted_step_sizes: list[float] = []
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
                jac=jacobian,
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
        accepted_step_sizes.extend(float(value) for value in np.diff(solution.t))
        if not solution.success or solution.sol is None:
            return _failed_result(
                settings,
                str(solution.message),
                "INTEGRATION_FAILED",
                nfev=nfev,
                njev=njev,
                nlu=nlu,
                natural_frequencies_hz=natural_frequencies,
                accepted_step_sizes=tuple(accepted_step_sizes),
            )
        solutions.append(solution.sol)
        state_at_start = np.asarray(solution.y[:, -1], dtype=np.float64)

    states = np.empty((4, output_times.size), dtype=np.float64)
    for index, time_s in enumerate(output_times):
        solution_index = min(
            int(np.searchsorted(np.asarray(ordered_breakpoints), time_s, side="right") - 1),
            len(solutions) - 1,
        )
        dense_solution = solutions[solution_index]
        states[:, index] = np.asarray(dense_solution(float(time_s)), dtype=np.float64)
    finite_states = bool(np.all(np.isfinite(states)))
    if not finite_states:
        return _failed_result(
            settings,
            "The integrator returned non-finite state values.",
            "NONFINITE_INTEGRATED_STATE",
            nfev=nfev,
            njev=njev,
            nlu=nlu,
            natural_frequencies_hz=natural_frequencies,
            accepted_step_sizes=tuple(accepted_step_sizes),
        )

    samples: list[QuarterCarSample] = []
    energies: list[float] = []
    dissipated_powers: list[float] = []
    road_powers: list[float] = []
    contacts: list[float] = []
    for index, time_s in enumerate(output_times):
        sprung_z, sprung_v, unsprung_z, unsprung_v = states[:, index]
        road_z, road_v = road_state(road, float(time_s))
        state_derivative = derivative(float(time_s), states[:, index])
        suspension_travel = sprung_z - unsprung_z
        tire_compression = road_z - unsprung_z
        suspension_force = -ks * suspension_travel - cs * (sprung_v - unsprung_v)
        tire_force = kt * tire_compression + ct * (road_v - unsprung_v)
        total_contact = (
            parameters.static_tire_load_n + tire_force
            if parameters.static_tire_load_n is not None
            else None
        )
        if total_contact is not None:
            contacts.append(float(total_contact))
        energy = (
            0.5 * ms * sprung_v**2
            + 0.5 * mu * unsprung_v**2
            + 0.5 * ks * suspension_travel**2
            + 0.5 * kt * (unsprung_z - road_z) ** 2
        )
        dissipated_power = cs * (sprung_v - unsprung_v) ** 2 + ct * (unsprung_v - road_v) ** 2
        road_power = tire_force * road_v
        energies.append(float(energy))
        dissipated_powers.append(float(dissipated_power))
        road_powers.append(float(road_power))
        samples.append(
            QuarterCarSample(
                time_s=float(time_s),
                road_displacement_m=float(road_z),
                road_velocity_mps=float(road_v),
                sprung_displacement_m=float(sprung_z),
                sprung_velocity_mps=float(sprung_v),
                sprung_acceleration_mps2=float(state_derivative[1]),
                unsprung_displacement_m=float(unsprung_z),
                unsprung_velocity_mps=float(unsprung_v),
                unsprung_acceleration_mps2=float(state_derivative[3]),
                suspension_travel_m=float(suspension_travel),
                tire_compression_m=float(tire_compression),
                suspension_force_on_sprung_n=float(suspension_force),
                tire_force_increment_n=float(tire_force),
                total_tire_contact_force_n=(
                    float(total_contact) if total_contact is not None else None
                ),
                mechanical_energy_j=float(energy),
                dissipated_power_w=float(dissipated_power),
                road_input_power_w=float(road_power),
            )
        )

    minimum_contact = min(contacts) if contacts else None
    contact_accepted = minimum_contact is None or minimum_contact >= -1.0e-8
    if not contact_accepted:
        return _failed_result(
            settings,
            "The bilateral linear tire predicts negative total normal force; contact is lost.",
            "TIRE_CONTACT_LOSS_UNSUPPORTED",
            nfev=nfev,
            njev=njev,
            nlu=nlu,
            finite_states=True,
            contact_accepted=False,
            minimum_contact_n=minimum_contact,
            natural_frequencies_hz=natural_frequencies,
            accepted_step_sizes=tuple(accepted_step_sizes),
        )

    initial_energy = energies[0]
    final_energy = energies[-1]
    road_work: float | None = None
    dissipated_energy: float | None = None
    balance_residual: float | None = None
    relative_balance_error: float | None = None
    warnings = [
        "LINEAR_TWO_DOF_QUARTER_CAR",
        "COORDINATES_RELATIVE_TO_STATIC_EQUILIBRIUM_GRAVITY_NOT_REAPPLIED",
        "BILATERAL_LINEAR_TIRE_NO_IMPACT_MODEL",
        "PHYSICAL_VALIDATION_EVIDENCE_NOT_ATTACHED",
    ]
    if road.kind == "step":
        warnings.append("STEP_ENERGY_BALANCE_NOT_EVALUATED_DISPLACEMENT_IS_DISCONTINUOUS")
    else:
        road_work = float(np.trapezoid(np.asarray(road_powers), output_times))
        dissipated_energy = float(np.trapezoid(np.asarray(dissipated_powers), output_times))
        balance_residual = final_energy - initial_energy - road_work + dissipated_energy
        scale = max(
            max(abs(value) for value in energies),
            abs(road_work),
            abs(dissipated_energy),
            1.0e-12,
        )
        relative_balance_error = abs(balance_residual) / scale
        if relative_balance_error > 1.0e-3:
            warnings.append("ENERGY_BALANCE_OUTPUT_QUADRATURE_ERROR_ABOVE_1E_3")
    if parameters.static_tire_load_n is None:
        warnings.append("TOTAL_CONTACT_FORCE_NOT_AVAILABLE_STATIC_TIRE_LOAD_MISSING")

    diagnostics = DynamicsDiagnostics(
        solver_success=True,
        finite_states=True,
        contact_accepted=(True if parameters.static_tire_load_n is not None else None),
        function_evaluations=nfev,
        jacobian_evaluations=njev,
        lu_decompositions=nlu,
        integration_method=settings.method,
        relative_tolerance=settings.relative_tolerance,
        absolute_tolerance=settings.absolute_tolerance,
        maximum_step_s=settings.maximum_step_s,
        accepted_steps=len(accepted_step_sizes),
        minimum_accepted_step_s=min(accepted_step_sizes) if accepted_step_sizes else None,
        maximum_accepted_step_s=max(accepted_step_sizes) if accepted_step_sizes else None,
        initial_energy_j=initial_energy,
        final_energy_j=final_energy,
        road_input_work_j=road_work,
        dissipated_energy_j=dissipated_energy,
        energy_balance_residual_j=balance_residual,
        relative_energy_balance_error=relative_balance_error,
        minimum_total_contact_force_n=minimum_contact,
        message="Integration reached the requested final time and all acceptance checks passed.",
    )
    return QuarterCarResult(
        calculation_status="VERIFIED_NUMERICALLY",
        samples=tuple(samples),
        diagnostics=diagnostics,
        warnings=tuple(warnings),
        natural_frequencies_hz=natural_frequencies,
    )
