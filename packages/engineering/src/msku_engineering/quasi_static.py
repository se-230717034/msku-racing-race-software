"""Verified-numerical quasi-static force and load-transfer models.

The models in this module solve static equilibrium only. They do not include
transient dynamics, compliance, fatigue, joint friction, tyre constitutive
behaviour, or structural stress. Coordinates use SI units in the project
right-handed vehicle frame: +X forward, +Y left, +Z up.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

import numpy as np
from numpy.typing import NDArray

QUASI_STATIC_SOLVER_VERSION = "3.0.0"
COILOVER_SOLVER_VERSION = "3.1.0"
REFERENCE_STATUS: Literal["REFERENCE_BENCHMARKED"] = "REFERENCE_BENCHMARKED"
PHYSICAL_STATUS: Literal["UNVALIDATED_PHYSICALLY"] = "UNVALIDATED_PHYSICALLY"

CalculationStatus = Literal["VERIFIED_NUMERICALLY", "NOT_COMPUTABLE", "FAILED"]
MemberState = Literal["TENSION", "COMPRESSION", "ZERO"]
Vector3 = tuple[float, float, float]


@dataclass(frozen=True)
class TwoForceMember:
    """Ideal pin-jointed axial member connected to a rigid upright.

    Positive solved force is tension. Consequently, the force on the upright
    points from the member's upright joint toward its chassis joint.
    """

    id: str
    chassis_point_m: Vector3
    upright_point_m: Vector3


@dataclass(frozen=True)
class ExternalWrench:
    """Force and free moment applied to the upright at an explicit point."""

    force_n: Vector3
    moment_nm: Vector3
    application_point_m: Vector3


@dataclass(frozen=True)
class EquilibriumSettings:
    force_tolerance_n: float = 1.0e-6
    moment_tolerance_nm: float = 1.0e-6
    rank_relative_tolerance: float = 1.0e-10
    condition_limit: float = 1.0e10
    minimum_member_length_m: float = 1.0e-6


DEFAULT_EQUILIBRIUM_SETTINGS = EquilibriumSettings()


@dataclass(frozen=True)
class MemberForce:
    id: str
    axial_force_n: float
    state: MemberState
    force_on_upright_n: Vector3
    chassis_reaction_n: Vector3
    upright_point_m: Vector3


@dataclass(frozen=True)
class EquilibriumDiagnostics:
    matrix_rows: int
    matrix_columns: int
    matrix_rank: int
    condition_number: float | None
    force_residual_n: Vector3
    moment_residual_nm: Vector3
    force_residual_norm_n: float
    moment_residual_norm_nm: float
    characteristic_length_m: float
    message: str


@dataclass(frozen=True)
class EquilibriumResult:
    calculation_status: CalculationStatus
    member_forces: tuple[MemberForce, ...]
    diagnostics: EquilibriumDiagnostics
    warnings: tuple[str, ...]
    solver_version: str = QUASI_STATIC_SOLVER_VERSION
    reference_status: Literal["REFERENCE_BENCHMARKED"] = REFERENCE_STATUS
    physical_status: Literal["UNVALIDATED_PHYSICALLY"] = PHYSICAL_STATUS


@dataclass(frozen=True)
class VehicleLoadTransferInput:
    mass_kg: float
    wheelbase_m: float
    cg_from_front_axle_m: float
    cg_height_m: float
    front_track_m: float
    rear_track_m: float
    longitudinal_acceleration_mps2: float = 0.0
    lateral_acceleration_mps2: float = 0.0
    gravity_mps2: float = 9.80665
    front_roll_stiffness_nm_per_rad: float | None = None
    rear_roll_stiffness_nm_per_rad: float | None = None


@dataclass(frozen=True)
class AxleLoads:
    front_n: float
    rear_n: float


@dataclass(frozen=True)
class WheelLoads:
    front_left_n: float
    front_right_n: float
    rear_left_n: float
    rear_right_n: float


@dataclass(frozen=True)
class LoadTransferResult:
    calculation_status: CalculationStatus
    axle_loads: AxleLoads | None
    wheel_loads: WheelLoads | None
    longitudinal_transfer_n: float | None
    front_lateral_transfer_n: float | None
    rear_lateral_transfer_n: float | None
    total_weight_n: float | None
    force_residual_n: float | None
    warnings: tuple[str, ...]
    model_name: str = "rigid_body_with_elastic_roll_stiffness_distribution"
    solver_version: str = QUASI_STATIC_SOLVER_VERSION
    reference_status: Literal["REFERENCE_BENCHMARKED"] = REFERENCE_STATUS
    physical_status: Literal["UNVALIDATED_PHYSICALLY"] = PHYSICAL_STATUS


@dataclass(frozen=True)
class SpringSample:
    wheel_travel_m: float
    spring_length_m: float
    spring_compression_m: float
    motion_ratio: float
    spring_force_n: float
    stored_energy_j: float
    wheel_force_n: float
    wheel_rate_n_per_m: float


@dataclass(frozen=True)
class ActuationSeriesResult:
    calculation_status: CalculationStatus
    samples: tuple[SpringSample, ...]
    warnings: tuple[str, ...]
    solver_version: str = QUASI_STATIC_SOLVER_VERSION
    reference_status: Literal["REFERENCE_BENCHMARKED"] = REFERENCE_STATUS
    physical_status: Literal["UNVALIDATED_PHYSICALLY"] = PHYSICAL_STATUS


@dataclass(frozen=True)
class DamperForceResult:
    calculation_status: CalculationStatus
    force_n: float | None
    warning: str | None


@dataclass(frozen=True)
class CoiloverSample:
    """One spring-damper state using compression-positive conventions.

    ``damper_force_n`` is the signed generalized force opposing coilover
    compression velocity. ``total_axial_force_n`` is positive when the
    coilover pushes its mounts apart.
    """

    wheel_travel_m: float
    wheel_velocity_mps: float
    coilover_length_m: float
    coilover_compression_m: float
    coilover_compression_velocity_mps: float
    motion_ratio: float
    spring_force_n: float
    damper_force_n: float
    total_axial_force_n: float
    wheel_force_n: float
    stored_energy_j: float
    remaining_compression_travel_m: float | None
    remaining_rebound_travel_m: float | None


@dataclass(frozen=True)
class CoiloverSeriesResult:
    calculation_status: CalculationStatus
    samples: tuple[CoiloverSample, ...]
    warnings: tuple[str, ...]
    solver_version: str = COILOVER_SOLVER_VERSION
    reference_status: Literal["REFERENCE_BENCHMARKED"] = REFERENCE_STATUS
    physical_status: Literal["UNVALIDATED_PHYSICALLY"] = PHYSICAL_STATUS


def _vector3(value: Sequence[float], name: str) -> NDArray[np.float64]:
    result = np.asarray(value, dtype=np.float64)
    if result.shape != (3,) or not np.all(np.isfinite(result)):
        raise ValueError(f"{name} must contain three finite values")
    return result


def _tuple3(value: NDArray[np.float64]) -> Vector3:
    return float(value[0]), float(value[1]), float(value[2])


def _empty_diagnostics(message: str) -> EquilibriumDiagnostics:
    return EquilibriumDiagnostics(
        matrix_rows=6,
        matrix_columns=0,
        matrix_rank=0,
        condition_number=None,
        force_residual_n=(0.0, 0.0, 0.0),
        moment_residual_nm=(0.0, 0.0, 0.0),
        force_residual_norm_n=0.0,
        moment_residual_norm_nm=0.0,
        characteristic_length_m=0.0,
        message=message,
    )


def solve_upright_equilibrium(
    members: Sequence[TwoForceMember],
    external_wrench: ExternalWrench,
    reference_point_m: Sequence[float],
    settings: EquilibriumSettings = DEFAULT_EQUILIBRIUM_SETTINGS,
) -> EquilibriumResult:
    """Solve rigid-upright 3D equilibrium for ideal axial member forces.

    A dimensionless SVD is used for rank and condition diagnostics. Acceptance
    is decided independently from the least-squares termination by evaluating
    physical force and moment residuals in N and N*m.
    """
    if not members:
        return EquilibriumResult(
            calculation_status="NOT_COMPUTABLE",
            member_forces=(),
            diagnostics=_empty_diagnostics("No suspension members were supplied."),
            warnings=("MISSING_FORCE_PATH",),
        )
    if (
        settings.force_tolerance_n <= 0.0
        or settings.moment_tolerance_nm <= 0.0
        or settings.rank_relative_tolerance <= 0.0
        or settings.condition_limit <= 1.0
        or settings.minimum_member_length_m <= 0.0
    ):
        raise ValueError("Equilibrium tolerances and length limits must be positive")

    reference = _vector3(reference_point_m, "reference_point_m")
    force = _vector3(external_wrench.force_n, "external force")
    free_moment = _vector3(external_wrench.moment_nm, "external moment")
    application = _vector3(external_wrench.application_point_m, "application point")

    columns: list[NDArray[np.float64]] = []
    directions: list[NDArray[np.float64]] = []
    upright_points: list[NDArray[np.float64]] = []
    characteristic_distances: list[float] = []
    member_ids: set[str] = set()
    for member in members:
        if not member.id or member.id in member_ids:
            raise ValueError("Member identifiers must be non-empty and unique")
        member_ids.add(member.id)
        chassis = _vector3(member.chassis_point_m, f"{member.id} chassis point")
        upright = _vector3(member.upright_point_m, f"{member.id} upright point")
        link = chassis - upright
        length = float(np.linalg.norm(link))
        if length < settings.minimum_member_length_m:
            diagnostics = _empty_diagnostics(f"Member {member.id} has degenerate length.")
            return EquilibriumResult(
                calculation_status="FAILED",
                member_forces=(),
                diagnostics=diagnostics,
                warnings=("DEGENERATE_MEMBER",),
            )
        direction = link / length
        lever = upright - reference
        columns.append(np.concatenate((direction, np.cross(lever, direction))))
        directions.append(direction)
        upright_points.append(upright)
        characteristic_distances.extend((length, float(np.linalg.norm(lever))))

    external_moment_at_reference = free_moment + np.cross(application - reference, force)
    physical_matrix = np.column_stack(columns)
    physical_rhs = -np.concatenate((force, external_moment_at_reference))
    characteristic_length = max(max(characteristic_distances), 1.0e-6)
    scaled_matrix = physical_matrix.copy()
    scaled_matrix[3:, :] /= characteristic_length
    scaled_rhs = physical_rhs.copy()
    scaled_rhs[3:] /= characteristic_length

    singular_values = np.linalg.svd(scaled_matrix, compute_uv=False)
    largest = float(singular_values[0]) if singular_values.size else 0.0
    threshold = settings.rank_relative_tolerance * largest
    rank = int(np.count_nonzero(singular_values > threshold)) if largest > 0.0 else 0
    required_rank = len(members)
    smallest = float(singular_values[-1]) if singular_values.size else 0.0
    condition = largest / smallest if smallest > threshold else None

    def diagnostics_for(
        message: str,
        force_residual: NDArray[np.float64] | None = None,
        moment_residual: NDArray[np.float64] | None = None,
    ) -> EquilibriumDiagnostics:
        force_value = np.zeros(3) if force_residual is None else force_residual
        moment_value = np.zeros(3) if moment_residual is None else moment_residual
        return EquilibriumDiagnostics(
            matrix_rows=6,
            matrix_columns=len(members),
            matrix_rank=rank,
            condition_number=condition,
            force_residual_n=_tuple3(force_value),
            moment_residual_nm=_tuple3(moment_value),
            force_residual_norm_n=float(np.linalg.norm(force_value)),
            moment_residual_norm_nm=float(np.linalg.norm(moment_value)),
            characteristic_length_m=characteristic_length,
            message=message,
        )

    if len(members) > 6:
        return EquilibriumResult(
            calculation_status="NOT_COMPUTABLE",
            member_forces=(),
            diagnostics=diagnostics_for(
                "More than six unknown member forces make this rigid-body "
                "equilibrium statically indeterminate."
            ),
            warnings=("STATICALLY_INDETERMINATE_REQUIRES_STIFFNESS_MODEL",),
        )
    if rank < required_rank:
        return EquilibriumResult(
            calculation_status="FAILED",
            member_forces=(),
            diagnostics=diagnostics_for(
                "The member wrench matrix is rank deficient; member forces are not unique."
            ),
            warnings=("SINGULAR_OR_UNDERDETERMINED_FORCE_PATH",),
        )
    if condition is None or condition > settings.condition_limit:
        return EquilibriumResult(
            calculation_status="FAILED",
            member_forces=(),
            diagnostics=diagnostics_for("The member wrench matrix is ill-conditioned."),
            warnings=("ILL_CONDITIONED_FORCE_PATH",),
        )

    axial_forces, _, _, _ = np.linalg.lstsq(scaled_matrix, scaled_rhs, rcond=None)
    physical_residual = physical_matrix @ axial_forces - physical_rhs
    force_residual = physical_residual[:3]
    moment_residual = physical_residual[3:]
    force_ok = float(np.linalg.norm(force_residual)) <= settings.force_tolerance_n
    moment_ok = float(np.linalg.norm(moment_residual)) <= settings.moment_tolerance_nm
    if not force_ok or not moment_ok:
        return EquilibriumResult(
            calculation_status="NOT_COMPUTABLE",
            member_forces=(),
            diagnostics=diagnostics_for(
                "The supplied force and moment are outside the span of the "
                "available member force paths.",
                force_residual,
                moment_residual,
            ),
            warnings=("INCONSISTENT_EXTERNAL_WRENCH", "ACTUATION_FORCE_PATH_MAY_BE_MISSING"),
        )

    forces: list[MemberForce] = []
    zero_threshold = max(settings.force_tolerance_n, 1.0e-12)
    for member, magnitude, direction, upright in zip(
        members, axial_forces, directions, upright_points, strict=True
    ):
        value = float(magnitude)
        state: MemberState = (
            "ZERO" if abs(value) <= zero_threshold else "TENSION" if value > 0.0 else "COMPRESSION"
        )
        force_on_upright = value * direction
        forces.append(
            MemberForce(
                id=member.id,
                axial_force_n=value,
                state=state,
                force_on_upright_n=_tuple3(force_on_upright),
                chassis_reaction_n=_tuple3(-force_on_upright),
                upright_point_m=_tuple3(upright),
            )
        )

    return EquilibriumResult(
        calculation_status="VERIFIED_NUMERICALLY",
        member_forces=tuple(forces),
        diagnostics=diagnostics_for(
            "Independent force and moment residual checks passed.",
            force_residual,
            moment_residual,
        ),
        warnings=(
            "IDEAL_TWO_FORCE_MEMBERS_AND_PIN_JOINTS",
            "MEMBER_AXIAL_LOADS_ARE_NOT_STRESS_OR_FASTENER_LOADS",
        ),
    )


def calculate_vehicle_load_transfer(inputs: VehicleLoadTransferInput) -> LoadTransferResult:
    """Calculate rigid-body static/longitudinal/lateral normal loads.

    Positive longitudinal acceleration is forward and transfers normal load to
    the rear axle. Positive lateral acceleration is to vehicle left and loads
    the right-side wheels. Lateral front/rear distribution is calculated only
    when both axle roll stiffnesses are explicitly supplied.
    """
    scalar_values = np.asarray(
        [
            inputs.mass_kg,
            inputs.wheelbase_m,
            inputs.cg_from_front_axle_m,
            inputs.cg_height_m,
            inputs.front_track_m,
            inputs.rear_track_m,
            inputs.longitudinal_acceleration_mps2,
            inputs.lateral_acceleration_mps2,
            inputs.gravity_mps2,
        ],
        dtype=np.float64,
    )
    if not np.all(np.isfinite(scalar_values)):
        return LoadTransferResult(
            "FAILED", None, None, None, None, None, None, None, ("NONFINITE_INPUT",)
        )
    if (
        inputs.mass_kg <= 0.0
        or inputs.wheelbase_m <= 0.0
        or not 0.0 <= inputs.cg_from_front_axle_m <= inputs.wheelbase_m
        or inputs.cg_height_m < 0.0
        or inputs.front_track_m <= 0.0
        or inputs.rear_track_m <= 0.0
        or inputs.gravity_mps2 <= 0.0
    ):
        return LoadTransferResult(
            "FAILED", None, None, None, None, None, None, None, ("INVALID_VEHICLE_INPUT",)
        )

    weight = inputs.mass_kg * inputs.gravity_mps2
    static_front = weight * (inputs.wheelbase_m - inputs.cg_from_front_axle_m) / inputs.wheelbase_m
    static_rear = weight * inputs.cg_from_front_axle_m / inputs.wheelbase_m
    longitudinal_transfer = (
        inputs.mass_kg
        * inputs.longitudinal_acceleration_mps2
        * inputs.cg_height_m
        / inputs.wheelbase_m
    )
    front_axle = static_front - longitudinal_transfer
    rear_axle = static_rear + longitudinal_transfer
    axles = AxleLoads(front_n=front_axle, rear_n=rear_axle)
    axle_residual = front_axle + rear_axle - weight

    if front_axle < 0.0 or rear_axle < 0.0:
        return LoadTransferResult(
            "FAILED",
            axles,
            None,
            longitudinal_transfer,
            None,
            None,
            weight,
            axle_residual,
            ("NONPHYSICAL_NEGATIVE_AXLE_LOAD",),
        )

    lateral_requested = abs(inputs.lateral_acceleration_mps2) > 1.0e-12
    stiffnesses = (inputs.front_roll_stiffness_nm_per_rad, inputs.rear_roll_stiffness_nm_per_rad)
    if lateral_requested and any(value is None for value in stiffnesses):
        return LoadTransferResult(
            "NOT_COMPUTABLE",
            axles,
            None,
            longitudinal_transfer,
            None,
            None,
            weight,
            axle_residual,
            ("LATERAL_DISTRIBUTION_REQUIRES_FRONT_AND_REAR_ROLL_STIFFNESS",),
        )
    if any(value is not None and (not np.isfinite(value) or value <= 0.0) for value in stiffnesses):
        return LoadTransferResult(
            "FAILED",
            axles,
            None,
            longitudinal_transfer,
            None,
            None,
            weight,
            axle_residual,
            ("INVALID_ROLL_STIFFNESS",),
        )

    front_lateral = 0.0
    rear_lateral = 0.0
    if lateral_requested:
        front_stiffness = float(inputs.front_roll_stiffness_nm_per_rad)  # type: ignore[arg-type]
        rear_stiffness = float(inputs.rear_roll_stiffness_nm_per_rad)  # type: ignore[arg-type]
        front_fraction = front_stiffness / (front_stiffness + rear_stiffness)
        roll_moment = inputs.mass_kg * inputs.lateral_acceleration_mps2 * inputs.cg_height_m
        front_lateral = front_fraction * roll_moment / inputs.front_track_m
        rear_lateral = (1.0 - front_fraction) * roll_moment / inputs.rear_track_m

    wheels = WheelLoads(
        front_left_n=front_axle / 2.0 - front_lateral,
        front_right_n=front_axle / 2.0 + front_lateral,
        rear_left_n=rear_axle / 2.0 - rear_lateral,
        rear_right_n=rear_axle / 2.0 + rear_lateral,
    )
    values = (wheels.front_left_n, wheels.front_right_n, wheels.rear_left_n, wheels.rear_right_n)
    if min(values) < 0.0:
        return LoadTransferResult(
            "FAILED",
            axles,
            None,
            longitudinal_transfer,
            front_lateral,
            rear_lateral,
            weight,
            sum(values) - weight,
            ("NONPHYSICAL_NEGATIVE_WHEEL_LOAD", "WHEEL_UNLOADING_EXCEEDS_MODEL_DOMAIN"),
        )
    warnings = [
        "QUASI_STATIC_RIGID_BODY_MODEL",
        "AERODYNAMIC_UNSPRUNG_GEOMETRIC_AND_COMPLIANCE_EFFECTS_EXCLUDED",
    ]
    if min(values) <= 1.0e-6:
        warnings.append("WHEEL_UNLOADED")
    return LoadTransferResult(
        "VERIFIED_NUMERICALLY",
        axles,
        wheels,
        longitudinal_transfer,
        front_lateral,
        rear_lateral,
        weight,
        sum(values) - weight,
        tuple(warnings),
    )


def calculate_actuation_series(
    wheel_travel_m: Sequence[float],
    spring_length_m: Sequence[float],
    reference_spring_length_m: float,
    spring_rate_n_per_m: float,
    preload_n: float = 0.0,
    compression_only: bool = True,
) -> ActuationSeriesResult:
    """Calculate motion ratio and energy-consistent wheel force from geometry samples.

    Motion ratio is ``d(spring compression) / d(wheel bump)``. Input spring
    lengths must originate from an explicit actuation geometry or measurement;
    this function never invents rocker or mounting coordinates.
    """
    travel = np.asarray(wheel_travel_m, dtype=np.float64)
    lengths = np.asarray(spring_length_m, dtype=np.float64)
    scalars = np.asarray([reference_spring_length_m, spring_rate_n_per_m, preload_n])
    if (
        travel.ndim != 1
        or lengths.ndim != 1
        or travel.size < 3
        or travel.size != lengths.size
        or not np.all(np.isfinite(travel))
        or not np.all(np.isfinite(lengths))
        or not np.all(np.isfinite(scalars))
        or np.any(np.diff(travel) <= 0.0)
        or np.any(lengths <= 0.0)
        or reference_spring_length_m <= 0.0
        or spring_rate_n_per_m <= 0.0
        or preload_n < 0.0
    ):
        return ActuationSeriesResult("FAILED", (), ("INVALID_ACTUATION_SERIES_INPUT",))

    compression = reference_spring_length_m - lengths
    motion_ratio = np.asarray(
        np.gradient(compression.tolist(), travel.tolist(), edge_order=2), dtype=np.float64
    )
    spring_force = preload_n + spring_rate_n_per_m * compression
    if compression_only and np.any(spring_force < -1.0e-9):
        return ActuationSeriesResult(
            "NOT_COMPUTABLE", (), ("COMPRESSION_ONLY_SPRING_WOULD_REQUIRE_TENSION",)
        )
    energy = preload_n * compression + 0.5 * spring_rate_n_per_m * compression**2
    wheel_force = -spring_force * motion_ratio
    motion_ratio_gradient = np.asarray(
        np.gradient(motion_ratio.tolist(), travel.tolist(), edge_order=2), dtype=np.float64
    )
    wheel_rate = spring_rate_n_per_m * motion_ratio**2 + spring_force * motion_ratio_gradient
    samples = tuple(
        SpringSample(
            wheel_travel_m=float(travel[index]),
            spring_length_m=float(lengths[index]),
            spring_compression_m=float(compression[index]),
            motion_ratio=float(motion_ratio[index]),
            spring_force_n=float(spring_force[index]),
            stored_energy_j=float(energy[index]),
            wheel_force_n=float(wheel_force[index]),
            wheel_rate_n_per_m=float(wheel_rate[index]),
        )
        for index in range(travel.size)
    )
    return ActuationSeriesResult(
        "VERIFIED_NUMERICALLY",
        samples,
        (
            "SPRING_LENGTH_SERIES_MUST_HAVE_EXPLICIT_GEOMETRIC_OR_MEASURED_PROVENANCE",
            "IDEAL_LINEAR_SPRING_NO_HYSTERESIS_OR_FRICTION",
        ),
    )


def calculate_damper_force(
    velocity_mps: float | None,
    compression_coefficient_ns_per_m: float,
    rebound_coefficient_ns_per_m: float,
) -> DamperForceResult:
    """Return force opposing an explicitly supplied damper compression velocity."""
    if velocity_mps is None:
        return DamperForceResult("NOT_COMPUTABLE", None, "DAMPER_VELOCITY_REQUIRED")
    values = np.asarray(
        [velocity_mps, compression_coefficient_ns_per_m, rebound_coefficient_ns_per_m],
        dtype=np.float64,
    )
    if not np.all(np.isfinite(values)) or min(values[1], values[2]) < 0.0:
        return DamperForceResult("FAILED", None, "INVALID_DAMPER_INPUT")
    coefficient = (
        compression_coefficient_ns_per_m if velocity_mps >= 0.0 else rebound_coefficient_ns_per_m
    )
    return DamperForceResult("VERIFIED_NUMERICALLY", -coefficient * velocity_mps, None)


def calculate_coilover_series(
    wheel_travel_m: Sequence[float],
    wheel_velocity_mps: Sequence[float],
    coilover_length_m: Sequence[float],
    reference_coilover_length_m: float,
    spring_rate_n_per_m: float,
    preload_n: float,
    compression_coefficient_ns_per_m: float,
    rebound_coefficient_ns_per_m: float,
    minimum_coilover_length_m: float | None = None,
    maximum_coilover_length_m: float | None = None,
    compression_only: bool = True,
) -> CoiloverSeriesResult:
    """Evaluate a geometrically supplied coilover length history.

    Motion ratio is ``d(compression)/d(wheel bump)``. Coilover compression
    velocity is derived only from that ratio and the explicitly supplied wheel
    velocity. No velocity is inferred from UI timing or sample spacing.
    """

    velocity = np.asarray(wheel_velocity_mps, dtype=np.float64)
    lengths = np.asarray(coilover_length_m, dtype=np.float64)
    scalars = np.asarray(
        [
            reference_coilover_length_m,
            spring_rate_n_per_m,
            preload_n,
            compression_coefficient_ns_per_m,
            rebound_coefficient_ns_per_m,
        ],
        dtype=np.float64,
    )
    if (
        velocity.ndim != 1
        or lengths.ndim != 1
        or velocity.size != lengths.size
        or velocity.size != len(wheel_travel_m)
        or not np.all(np.isfinite(velocity))
        or not np.all(np.isfinite(lengths))
        or not np.all(np.isfinite(scalars))
        or compression_coefficient_ns_per_m < 0.0
        or rebound_coefficient_ns_per_m < 0.0
    ):
        return CoiloverSeriesResult("FAILED", (), ("INVALID_COILOVER_SERIES_INPUT",))

    limits = (minimum_coilover_length_m, maximum_coilover_length_m)
    if any(value is not None and (not np.isfinite(value) or value <= 0.0) for value in limits):
        return CoiloverSeriesResult("FAILED", (), ("INVALID_COILOVER_TRAVEL_LIMIT",))
    if (
        minimum_coilover_length_m is not None
        and maximum_coilover_length_m is not None
        and minimum_coilover_length_m >= maximum_coilover_length_m
    ):
        return CoiloverSeriesResult("FAILED", (), ("INVALID_COILOVER_TRAVEL_LIMIT",))

    spring = calculate_actuation_series(
        wheel_travel_m,
        coilover_length_m,
        reference_coilover_length_m,
        spring_rate_n_per_m,
        preload_n,
        compression_only,
    )
    if spring.calculation_status != "VERIFIED_NUMERICALLY":
        return CoiloverSeriesResult(spring.calculation_status, (), spring.warnings)

    for index, length in enumerate(lengths):
        below_minimum = (
            minimum_coilover_length_m is not None
            and length < minimum_coilover_length_m - 1.0e-12
        )
        above_maximum = (
            maximum_coilover_length_m is not None
            and length > maximum_coilover_length_m + 1.0e-12
        )
        if below_minimum or above_maximum:
            return CoiloverSeriesResult(
                "NOT_COMPUTABLE",
                (),
                (f"COILOVER_TRAVEL_LIMIT_EXCEEDED_AT_INDEX_{index}",),
            )

    samples: list[CoiloverSample] = []
    for index, spring_sample in enumerate(spring.samples):
        compression_velocity = spring_sample.motion_ratio * float(velocity[index])
        damper = calculate_damper_force(
            compression_velocity,
            compression_coefficient_ns_per_m,
            rebound_coefficient_ns_per_m,
        )
        if damper.calculation_status != "VERIFIED_NUMERICALLY" or damper.force_n is None:
            return CoiloverSeriesResult(
                damper.calculation_status,
                (),
                (damper.warning or "DAMPER_FORCE_NOT_COMPUTABLE",),
            )
        total_axial_force = spring_sample.spring_force_n - damper.force_n
        samples.append(
            CoiloverSample(
                wheel_travel_m=spring_sample.wheel_travel_m,
                wheel_velocity_mps=float(velocity[index]),
                coilover_length_m=spring_sample.spring_length_m,
                coilover_compression_m=spring_sample.spring_compression_m,
                coilover_compression_velocity_mps=compression_velocity,
                motion_ratio=spring_sample.motion_ratio,
                spring_force_n=spring_sample.spring_force_n,
                damper_force_n=damper.force_n,
                total_axial_force_n=total_axial_force,
                wheel_force_n=-total_axial_force * spring_sample.motion_ratio,
                stored_energy_j=spring_sample.stored_energy_j,
                remaining_compression_travel_m=(
                    spring_sample.spring_length_m - minimum_coilover_length_m
                    if minimum_coilover_length_m is not None
                    else None
                ),
                remaining_rebound_travel_m=(
                    maximum_coilover_length_m - spring_sample.spring_length_m
                    if maximum_coilover_length_m is not None
                    else None
                ),
            )
        )
    return CoiloverSeriesResult(
        "VERIFIED_NUMERICALLY",
        tuple(samples),
        (
            *spring.warnings,
            "DAMPER_VELOCITY_DERIVED_FROM_EXPLICIT_WHEEL_VELOCITY_AND_LOCAL_MOTION_RATIO",
            "LINEAR_SPRING_AND_PIECEWISE_LINEAR_DAMPER_UNVALIDATED_PHYSICALLY",
        ),
    )
