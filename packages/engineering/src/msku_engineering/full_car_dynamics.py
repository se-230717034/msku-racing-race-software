"""Linear seven-degree-of-freedom full-car vertical ride model.

Coordinates are perturbations from static equilibrium in the documented
right-handed vehicle frame (+X forward, +Y left, +Z upward). Small pitch is
positive about +Y (front moves downward); small roll is positive about +X
(left side moves upward).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from scipy.integrate import solve_ivp
from scipy.linalg import eigh

from .vehicle_dynamics import (
    CalculationStatus,
    DynamicsSettings,
    IntegrationMethod,
    RoadProfile,
    road_breakpoints,
    road_state,
    validate_road_profile,
)

FULL_CAR_SOLVER_VERSION = "5.0.0"
CORNER_NAMES = ("front_left", "front_right", "rear_left", "rear_right")


@dataclass(frozen=True)
class FullCarCornerParameters:
    x_position_m: float
    y_position_m: float
    unsprung_mass_kg: float
    suspension_stiffness_n_per_m: float
    suspension_damping_ns_per_m: float
    tire_stiffness_n_per_m: float
    tire_damping_ns_per_m: float = 0.0
    static_tire_load_n: float | None = None


@dataclass(frozen=True)
class FullCarParameters:
    sprung_mass_kg: float
    pitch_inertia_kg_m2: float
    roll_inertia_kg_m2: float
    corners: tuple[FullCarCornerParameters, ...]


@dataclass(frozen=True)
class FullCarRoadInputs:
    profiles: tuple[RoadProfile, ...]


@dataclass(frozen=True)
class FullCarInitialState:
    body_heave_m: float = 0.0
    body_heave_velocity_mps: float = 0.0
    pitch_rad: float = 0.0
    pitch_rate_radps: float = 0.0
    roll_rad: float = 0.0
    roll_rate_radps: float = 0.0
    unsprung_displacements_m: tuple[float, ...] = (0.0, 0.0, 0.0, 0.0)
    unsprung_velocities_mps: tuple[float, ...] = (0.0, 0.0, 0.0, 0.0)


@dataclass(frozen=True)
class FullCarSample:
    time_s: float
    road_displacements_m: tuple[float, ...]
    road_velocities_mps: tuple[float, ...]
    body_heave_m: float
    body_heave_velocity_mps: float
    body_heave_acceleration_mps2: float
    pitch_rad: float
    pitch_rate_radps: float
    pitch_acceleration_radps2: float
    roll_rad: float
    roll_rate_radps: float
    roll_acceleration_radps2: float
    unsprung_displacements_m: tuple[float, ...]
    unsprung_velocities_mps: tuple[float, ...]
    unsprung_accelerations_mps2: tuple[float, ...]
    suspension_travels_m: tuple[float, ...]
    tire_compressions_m: tuple[float, ...]
    suspension_forces_on_body_n: tuple[float, ...]
    tire_force_increments_n: tuple[float, ...]
    total_tire_contact_forces_n: tuple[float | None, ...]
    mechanical_energy_j: float
    dissipated_power_w: float
    road_input_power_w: float


@dataclass(frozen=True)
class FullCarDiagnostics:
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
    mass_matrix_condition: float | None
    stiffness_matrix_condition: float | None
    initial_energy_j: float | None
    final_energy_j: float | None
    road_input_work_j: float | None
    dissipated_energy_j: float | None
    energy_balance_residual_j: float | None
    relative_energy_balance_error: float | None
    minimum_total_contact_force_n: float | None
    contact_loss_corner: str | None
    message: str


@dataclass(frozen=True)
class FullCarResult:
    calculation_status: CalculationStatus
    samples: tuple[FullCarSample, ...]
    diagnostics: FullCarDiagnostics
    warnings: tuple[str, ...]
    natural_frequencies_hz: tuple[float, ...] | None
    solver_version: str = FULL_CAR_SOLVER_VERSION
    reference_status: str = "REFERENCE_BENCHMARKED"
    physical_status: str = "UNVALIDATED_PHYSICALLY"


DEFAULT_FULL_CAR_INITIAL_STATE = FullCarInitialState()
DEFAULT_FULL_CAR_SETTINGS = DynamicsSettings()


def _finite(values: tuple[float, ...]) -> bool:
    return bool(np.all(np.isfinite(np.asarray(values, dtype=np.float64))))


def _validate(
    parameters: FullCarParameters,
    roads: FullCarRoadInputs,
    initial: FullCarInitialState,
    settings: DynamicsSettings,
) -> str | None:
    if len(parameters.corners) != 4 or len(roads.profiles) != 4:
        return "A full-car model requires exactly four ordered corners and four road inputs."
    if len(initial.unsprung_displacements_m) != 4 or len(initial.unsprung_velocities_mps) != 4:
        return "A full-car initial state requires four unsprung displacements and velocities."
    primary = (
        parameters.sprung_mass_kg,
        parameters.pitch_inertia_kg_m2,
        parameters.roll_inertia_kg_m2,
        settings.duration_s,
        settings.relative_tolerance,
        settings.absolute_tolerance,
        settings.maximum_step_s,
    )
    if not _finite(primary):
        return "Full-car parameters and solver settings must be finite."
    if min(primary[:3]) <= 0.0:
        return "Sprung mass and body inertias must be positive."
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
    initial_values = (
        initial.body_heave_m,
        initial.body_heave_velocity_mps,
        initial.pitch_rad,
        initial.pitch_rate_radps,
        initial.roll_rad,
        initial.roll_rate_radps,
        *initial.unsprung_displacements_m,
        *initial.unsprung_velocities_mps,
    )
    if not _finite(initial_values):
        return "Initial states must be finite."
    for index, (corner, road) in enumerate(zip(parameters.corners, roads.profiles, strict=True)):
        values = (
            corner.x_position_m,
            corner.y_position_m,
            corner.unsprung_mass_kg,
            corner.suspension_stiffness_n_per_m,
            corner.suspension_damping_ns_per_m,
            corner.tire_stiffness_n_per_m,
            corner.tire_damping_ns_per_m,
        )
        if not _finite(values):
            return f"Corner {CORNER_NAMES[index]} parameters must be finite."
        if (
            corner.unsprung_mass_kg <= 0.0
            or corner.suspension_stiffness_n_per_m <= 0.0
            or corner.suspension_damping_ns_per_m < 0.0
            or corner.tire_stiffness_n_per_m <= 0.0
            or corner.tire_damping_ns_per_m < 0.0
        ):
            return "Corner masses and stiffnesses must be positive; damping must be nonnegative."
        if corner.static_tire_load_n is not None and (
            not np.isfinite(corner.static_tire_load_n) or corner.static_tire_load_n < 0.0
        ):
            return "Static tire loads must be finite and nonnegative when supplied."
        road_error = validate_road_profile(
            road, settings.duration_s, corner.tire_damping_ns_per_m
        )
        if road_error is not None:
            return f"{CORNER_NAMES[index]} road: {road_error}"
    expected_signs = (
        parameters.corners[0].x_position_m > 0.0
        and parameters.corners[1].x_position_m > 0.0
        and parameters.corners[2].x_position_m < 0.0
        and parameters.corners[3].x_position_m < 0.0
        and parameters.corners[0].y_position_m > 0.0
        and parameters.corners[2].y_position_m > 0.0
        and parameters.corners[1].y_position_m < 0.0
        and parameters.corners[3].y_position_m < 0.0
    )
    if not expected_signs:
        return "Corner positions must follow FL, FR, RL, RR ordering in the vehicle frame."
    load_presence = [corner.static_tire_load_n is not None for corner in parameters.corners]
    if any(load_presence) and not all(load_presence):
        return "Static tire loads must be supplied for all four corners or omitted for all."
    return None


def assemble_full_car_matrices(
    parameters: FullCarParameters,
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    """Assemble physical M, C, K matrices for q=[z, pitch, roll, zu_FL..zu_RR]."""
    mass = np.diag(
        [
            parameters.sprung_mass_kg,
            parameters.pitch_inertia_kg_m2,
            parameters.roll_inertia_kg_m2,
            *(corner.unsprung_mass_kg for corner in parameters.corners),
        ]
    ).astype(np.float64)
    damping = np.zeros((7, 7), dtype=np.float64)
    stiffness = np.zeros((7, 7), dtype=np.float64)
    for index, corner in enumerate(parameters.corners):
        deformation = np.zeros(7, dtype=np.float64)
        deformation[:3] = (1.0, -corner.x_position_m, corner.y_position_m)
        deformation[3 + index] = -1.0
        damping += corner.suspension_damping_ns_per_m * np.outer(
            deformation, deformation
        )
        stiffness += corner.suspension_stiffness_n_per_m * np.outer(
            deformation, deformation
        )
        damping[3 + index, 3 + index] += corner.tire_damping_ns_per_m
        stiffness[3 + index, 3 + index] += corner.tire_stiffness_n_per_m
    return mass, damping, stiffness


def full_car_natural_frequencies(parameters: FullCarParameters) -> tuple[float, ...]:
    mass, _, stiffness = assemble_full_car_matrices(parameters)
    eigenvalues = eigh(stiffness, mass, eigvals_only=True, check_finite=True)
    if np.any(eigenvalues <= 0.0) or not np.all(np.isfinite(eigenvalues)):
        raise ValueError("Full-car generalized stiffness eigenvalues must be finite and positive.")
    return tuple(float(np.sqrt(value) / (2.0 * np.pi)) for value in eigenvalues)


def _failed(
    settings: DynamicsSettings,
    message: str,
    warning: str,
    *,
    frequencies: tuple[float, ...] | None = None,
    nfev: int = 0,
    njev: int = 0,
    nlu: int = 0,
    steps: tuple[float, ...] = (),
    finite: bool = False,
    contact: bool | None = None,
    minimum_contact: float | None = None,
    contact_corner: str | None = None,
    mass_condition: float | None = None,
    stiffness_condition: float | None = None,
) -> FullCarResult:
    return FullCarResult(
        calculation_status="FAILED",
        samples=(),
        diagnostics=FullCarDiagnostics(
            solver_success=False,
            finite_states=finite,
            contact_accepted=contact,
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
            mass_matrix_condition=mass_condition,
            stiffness_matrix_condition=stiffness_condition,
            initial_energy_j=None,
            final_energy_j=None,
            road_input_work_j=None,
            dissipated_energy_j=None,
            energy_balance_residual_j=None,
            relative_energy_balance_error=None,
            minimum_total_contact_force_n=minimum_contact,
            contact_loss_corner=contact_corner,
            message=message,
        ),
        warnings=(warning,),
        natural_frequencies_hz=frequencies,
    )


def simulate_full_car(
    parameters: FullCarParameters,
    roads: FullCarRoadInputs,
    initial: FullCarInitialState = DEFAULT_FULL_CAR_INITIAL_STATE,
    settings: DynamicsSettings = DEFAULT_FULL_CAR_SETTINGS,
) -> FullCarResult:
    """Integrate the passive linear 7DOF ride model with four independent roads."""
    invalid = _validate(parameters, roads, initial, settings)
    if invalid is not None:
        return _failed(settings, invalid, "INVALID_FULL_CAR_INPUT")
    mass, damping, stiffness = assemble_full_car_matrices(parameters)
    mass_condition = float(np.linalg.cond(mass))
    stiffness_condition = float(np.linalg.cond(stiffness))
    if not np.isfinite(mass_condition) or not np.isfinite(stiffness_condition):
        return _failed(
            settings,
            "Full-car system matrices are singular or non-finite.",
            "INVALID_FULL_CAR_MATRICES",
            mass_condition=mass_condition,
            stiffness_condition=stiffness_condition,
        )
    frequencies = full_car_natural_frequencies(parameters)
    inverse_mass = 1.0 / np.diag(mass)

    def applied_force(time_s: float) -> NDArray[np.float64]:
        force = np.zeros(7, dtype=np.float64)
        for index, (corner, road) in enumerate(
            zip(parameters.corners, roads.profiles, strict=True)
        ):
            road_z, road_v = road_state(road, time_s)
            force[3 + index] = (
                corner.tire_stiffness_n_per_m * road_z
                + corner.tire_damping_ns_per_m * road_v
            )
        return force

    state_matrix = np.block(
        [
            [np.zeros((7, 7), dtype=np.float64), np.eye(7, dtype=np.float64)],
            [-inverse_mass[:, None] * stiffness, -inverse_mass[:, None] * damping],
        ]
    )

    def derivative(time_s: float, state: NDArray[np.float64]) -> NDArray[np.float64]:
        coordinates = state[:7]
        velocities = state[7:]
        accelerations = inverse_mass * (
            applied_force(time_s) - damping @ velocities - stiffness @ coordinates
        )
        return np.concatenate((velocities, accelerations))

    initial_coordinates = np.asarray(
        [
            initial.body_heave_m,
            initial.pitch_rad,
            initial.roll_rad,
            *initial.unsprung_displacements_m,
        ],
        dtype=np.float64,
    )
    initial_velocities = np.asarray(
        [
            initial.body_heave_velocity_mps,
            initial.pitch_rate_radps,
            initial.roll_rate_radps,
            *initial.unsprung_velocities_mps,
        ],
        dtype=np.float64,
    )
    state_at_start = np.concatenate((initial_coordinates, initial_velocities))
    combined_breakpoints = {0.0, settings.duration_s}
    for road in roads.profiles:
        combined_breakpoints.update(road_breakpoints(road, settings.duration_s))
    ordered_breakpoints = tuple(sorted(combined_breakpoints))
    intervals = tuple(zip(ordered_breakpoints, ordered_breakpoints[1:], strict=False))

    def evaluate_total_contacts(
        time_s: float, state: NDArray[np.float64]
    ) -> tuple[float, ...] | None:
        if parameters.corners[0].static_tire_load_n is None:
            return None
        values: list[float] = []
        for index, (corner, road) in enumerate(
            zip(parameters.corners, roads.profiles, strict=True)
        ):
            road_z, road_v = road_state(road, time_s)
            increment = corner.tire_stiffness_n_per_m * (road_z - state[3 + index])
            increment += corner.tire_damping_ns_per_m * (road_v - state[10 + index])
            static_load = corner.static_tire_load_n
            if static_load is None:
                raise RuntimeError("Validated all-or-none contact load invariant was broken")
            values.append(float(static_load + increment))
        return tuple(values)

    solutions: list[Callable[[float], NDArray[np.float64]]] = []
    accepted_steps: list[float] = []
    nfev = 0
    njev = 0
    nlu = 0
    minimum_contact: float | None = None
    contact_corner: str | None = None
    for start, end in intervals:
        contacts_at_start = evaluate_total_contacts(start, state_at_start)
        if contacts_at_start is not None and min(contacts_at_start) < -1.0e-8:
            corner_index = int(np.argmin(np.asarray(contacts_at_start)))
            return _failed(
                settings,
                "A wheel has negative total normal force at an integration boundary.",
                "TIRE_CONTACT_LOSS_UNSUPPORTED",
                frequencies=frequencies,
                nfev=nfev,
                njev=njev,
                nlu=nlu,
                steps=tuple(accepted_steps),
                finite=True,
                contact=False,
                minimum_contact=min(contacts_at_start),
                contact_corner=CORNER_NAMES[corner_index],
                mass_condition=mass_condition,
                stiffness_condition=stiffness_condition,
            )

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
                jac=state_matrix,
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
                "FULL_CAR_INTEGRATION_FAILED",
                frequencies=frequencies,
                nfev=nfev,
                njev=njev,
                nlu=nlu,
                steps=tuple(accepted_steps),
                mass_condition=mass_condition,
                stiffness_condition=stiffness_condition,
            )
        for time_s, state in zip(solution.t, solution.y.T, strict=True):
            contacts = evaluate_total_contacts(float(time_s), np.asarray(state, dtype=np.float64))
            if contacts is not None:
                local_minimum = min(contacts)
                if minimum_contact is None or local_minimum < minimum_contact:
                    minimum_contact = local_minimum
                    contact_corner = CORNER_NAMES[int(np.argmin(np.asarray(contacts)))]
        if minimum_contact is not None and minimum_contact < -1.0e-8:
            return _failed(
                settings,
                "The bilateral tire model predicts negative total normal force.",
                "TIRE_CONTACT_LOSS_UNSUPPORTED",
                frequencies=frequencies,
                nfev=nfev,
                njev=njev,
                nlu=nlu,
                steps=tuple(accepted_steps),
                finite=True,
                contact=False,
                minimum_contact=minimum_contact,
                contact_corner=contact_corner,
                mass_condition=mass_condition,
                stiffness_condition=stiffness_condition,
            )
        solutions.append(solution.sol)
        state_at_start = np.asarray(solution.y[:, -1], dtype=np.float64)

    output_times = np.linspace(0.0, settings.duration_s, settings.output_samples)
    states = np.empty((14, output_times.size), dtype=np.float64)
    for index, time_s in enumerate(output_times):
        solution_index = min(
            int(np.searchsorted(np.asarray(ordered_breakpoints), time_s, side="right") - 1),
            len(solutions) - 1,
        )
        states[:, index] = np.asarray(solutions[solution_index](float(time_s)), dtype=np.float64)
    if not np.all(np.isfinite(states)):
        return _failed(
            settings,
            "The full-car integrator returned non-finite states.",
            "NONFINITE_FULL_CAR_STATE",
            frequencies=frequencies,
            nfev=nfev,
            njev=njev,
            nlu=nlu,
            steps=tuple(accepted_steps),
            mass_condition=mass_condition,
            stiffness_condition=stiffness_condition,
        )

    samples: list[FullCarSample] = []
    energies: list[float] = []
    dissipated_powers: list[float] = []
    road_powers: list[float] = []
    output_contacts: list[float] = []
    for index, time_s in enumerate(output_times):
        state = states[:, index]
        coordinates = state[:7]
        velocities = state[7:]
        acceleration = derivative(float(time_s), state)[7:]
        road_values = tuple(road_state(road, float(time_s)) for road in roads.profiles)
        body_coordinates = coordinates[0] + np.asarray(
            [
                -corner.x_position_m * coordinates[1]
                + corner.y_position_m * coordinates[2]
                for corner in parameters.corners
            ]
        )
        body_velocities = velocities[0] + np.asarray(
            [
                -corner.x_position_m * velocities[1]
                + corner.y_position_m * velocities[2]
                for corner in parameters.corners
            ]
        )
        suspension_travels = body_coordinates - coordinates[3:]
        suspension_velocities = body_velocities - velocities[3:]
        tire_compressions = np.asarray(
            [road_values[i][0] - coordinates[3 + i] for i in range(4)]
        )
        tire_relative_velocities = np.asarray(
            [road_values[i][1] - velocities[3 + i] for i in range(4)]
        )
        suspension_forces = np.asarray(
            [
                -corner.suspension_stiffness_n_per_m * suspension_travels[i]
                - corner.suspension_damping_ns_per_m * suspension_velocities[i]
                for i, corner in enumerate(parameters.corners)
            ]
        )
        tire_forces = np.asarray(
            [
                corner.tire_stiffness_n_per_m * tire_compressions[i]
                + corner.tire_damping_ns_per_m * tire_relative_velocities[i]
                for i, corner in enumerate(parameters.corners)
            ]
        )
        output_total_contacts = tuple(
            (
                float(corner.static_tire_load_n + tire_forces[i])
                if corner.static_tire_load_n is not None
                else None
            )
            for i, corner in enumerate(parameters.corners)
        )
        output_contacts.extend(value for value in output_total_contacts if value is not None)
        energy = 0.5 * float(velocities @ mass @ velocities)
        energy += 0.5 * sum(
            corner.suspension_stiffness_n_per_m * suspension_travels[i] ** 2
            + corner.tire_stiffness_n_per_m * tire_compressions[i] ** 2
            for i, corner in enumerate(parameters.corners)
        )
        dissipated_power = sum(
            corner.suspension_damping_ns_per_m * suspension_velocities[i] ** 2
            + corner.tire_damping_ns_per_m * tire_relative_velocities[i] ** 2
            for i, corner in enumerate(parameters.corners)
        )
        road_power = sum(tire_forces[i] * road_values[i][1] for i in range(4))
        energies.append(float(energy))
        dissipated_powers.append(float(dissipated_power))
        road_powers.append(float(road_power))
        samples.append(
            FullCarSample(
                time_s=float(time_s),
                road_displacements_m=tuple(float(value[0]) for value in road_values),
                road_velocities_mps=tuple(float(value[1]) for value in road_values),
                body_heave_m=float(coordinates[0]),
                body_heave_velocity_mps=float(velocities[0]),
                body_heave_acceleration_mps2=float(acceleration[0]),
                pitch_rad=float(coordinates[1]),
                pitch_rate_radps=float(velocities[1]),
                pitch_acceleration_radps2=float(acceleration[1]),
                roll_rad=float(coordinates[2]),
                roll_rate_radps=float(velocities[2]),
                roll_acceleration_radps2=float(acceleration[2]),
                unsprung_displacements_m=tuple(float(value) for value in coordinates[3:]),
                unsprung_velocities_mps=tuple(float(value) for value in velocities[3:]),
                unsprung_accelerations_mps2=tuple(float(value) for value in acceleration[3:]),
                suspension_travels_m=tuple(float(value) for value in suspension_travels),
                tire_compressions_m=tuple(float(value) for value in tire_compressions),
                suspension_forces_on_body_n=tuple(float(value) for value in suspension_forces),
                tire_force_increments_n=tuple(float(value) for value in tire_forces),
                total_tire_contact_forces_n=output_total_contacts,
                mechanical_energy_j=float(energy),
                dissipated_power_w=float(dissipated_power),
                road_input_power_w=float(road_power),
            )
        )

    if output_contacts:
        output_minimum = min(output_contacts)
        if minimum_contact is None or output_minimum < minimum_contact:
            minimum_contact = output_minimum
    initial_energy = energies[0]
    final_energy = energies[-1]
    any_step = any(road.kind == "step" for road in roads.profiles)
    road_work: float | None = None
    dissipated_energy: float | None = None
    energy_residual: float | None = None
    relative_energy_error: float | None = None
    warnings = [
        "LINEAR_SEVEN_DOF_FULL_CAR",
        "COORDINATES_RELATIVE_TO_STATIC_EQUILIBRIUM_GRAVITY_NOT_REAPPLIED",
        "SMALL_PITCH_AND_ROLL_ANGLES",
        "BILATERAL_LINEAR_TIRES_NO_IMPACT_MODEL",
        "PHYSICAL_VALIDATION_EVIDENCE_NOT_ATTACHED",
    ]
    if any_step:
        warnings.append("STEP_ENERGY_BALANCE_NOT_EVALUATED_DISPLACEMENT_IS_DISCONTINUOUS")
    else:
        road_work = float(np.trapezoid(np.asarray(road_powers), output_times))
        dissipated_energy = float(np.trapezoid(np.asarray(dissipated_powers), output_times))
        energy_residual = final_energy - initial_energy - road_work + dissipated_energy
        scale = max(
            max(abs(value) for value in energies),
            abs(road_work),
            abs(dissipated_energy),
            1e-12,
        )
        relative_energy_error = abs(energy_residual) / scale
        if relative_energy_error > 1.0e-3:
            warnings.append("ENERGY_BALANCE_OUTPUT_QUADRATURE_ERROR_ABOVE_1E_3")
    has_static_loads = parameters.corners[0].static_tire_load_n is not None
    if not has_static_loads:
        warnings.append("TOTAL_CONTACT_FORCE_NOT_AVAILABLE_STATIC_TIRE_LOADS_MISSING")
    return FullCarResult(
        calculation_status="VERIFIED_NUMERICALLY",
        samples=tuple(samples),
        diagnostics=FullCarDiagnostics(
            solver_success=True,
            finite_states=True,
            contact_accepted=True if has_static_loads else None,
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
            mass_matrix_condition=mass_condition,
            stiffness_matrix_condition=stiffness_condition,
            initial_energy_j=initial_energy,
            final_energy_j=final_energy,
            road_input_work_j=road_work,
            dissipated_energy_j=dissipated_energy,
            energy_balance_residual_j=energy_residual,
            relative_energy_balance_error=relative_energy_error,
            minimum_total_contact_force_n=minimum_contact,
            contact_loss_corner=None,
            message="Integration reached final time and all full-car acceptance checks passed.",
        ),
        warnings=tuple(warnings),
        natural_frequencies_hz=frequencies,
    )
