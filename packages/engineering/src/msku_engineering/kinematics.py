"""Verified numerical rigid-body double-wishbone kinematics.

The moving upright is represented by one translation and one rotation vector.
Five measured rigid-link lengths plus prescribed wheel-centre Z displacement
form six nonlinear constraints. No force, compliance, or dynamics model is
included here.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from math import atan2, cos, pi, sin
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation

from .geometry import GeometryError

Corner = Literal["front_left", "front_right"]
CalculationStatus = Literal["VERIFIED_NUMERICALLY", "FAILED"]

KINEMATICS_SOLVER_VERSION = "2.5.0"
REFERENCE_STATUS: Literal["REFERENCE_BENCHMARKED"] = "REFERENCE_BENCHMARKED"
PHYSICAL_STATUS: Literal["UNVALIDATED_PHYSICALLY"] = "UNVALIDATED_PHYSICALLY"

MOVING_IDS = ("uca_outboard", "lca_outboard", "tie_rod_outboard", "wheel_center")
CONSTRAINED_LINKS = (
    ("uca_front_inboard", "uca_outboard"),
    ("uca_rear_inboard", "uca_outboard"),
    ("lca_front_inboard", "lca_outboard"),
    ("lca_rear_inboard", "lca_outboard"),
    ("tie_rod_inboard", "tie_rod_outboard"),
)


@dataclass(frozen=True)
class SolverSettings:
    residual_tolerance_m: float = 1.0e-8
    max_function_evaluations: int = 500
    rank_relative_tolerance: float = 1.0e-9
    condition_limit: float = 1.0e10
    continuity_position_limit_m: float = 0.030
    continuity_rotation_limit_rad: float = 0.35
    max_travel_step_m: float = 0.025


DEFAULT_SOLVER_SETTINGS = SolverSettings()


@dataclass(frozen=True)
class SolverDiagnostics:
    converged: bool
    optimizer_success: bool
    residuals_accepted: bool
    jacobian_accepted: bool
    continuity_accepted: bool
    residual_norm_m: float | None
    max_abs_residual_m: float | None
    jacobian_rank: int
    jacobian_condition: float | None
    function_evaluations: int
    message: str


@dataclass(frozen=True)
class KinematicMetrics:
    camber_rad: float
    camber_change_rad: float
    camber_gain_rad_per_m: float | None
    toe_rad: float
    bump_steer_rad: float
    bump_steer_gradient_rad_per_m: float | None
    caster_rad: float
    kpi_rad: float
    track_change_m: float
    roll_center_height_m: float | None
    instant_center_y_m: float | None
    instant_center_z_m: float | None


@dataclass(frozen=True)
class KinematicPose:
    hardpoints: dict[str, tuple[float, float, float]]
    wheel_axis: tuple[float, float, float]
    translation: tuple[float, float, float]
    rotation_vector: tuple[float, float, float]


@dataclass(frozen=True)
class KinematicState:
    travel_m: float
    calculation_status: CalculationStatus
    pose: KinematicPose | None
    metrics: KinematicMetrics | None
    diagnostics: SolverDiagnostics
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class SweepResult:
    states: tuple[KinematicState, ...]
    all_converged: bool
    calculation_status: CalculationStatus
    residual_tolerance_m: float
    solver_version: str = KINEMATICS_SOLVER_VERSION
    reference_status: Literal["REFERENCE_BENCHMARKED"] = REFERENCE_STATUS
    physical_status: Literal["UNVALIDATED_PHYSICALLY"] = PHYSICAL_STATUS


def _as_points(points: Mapping[str, Sequence[float]]) -> dict[str, NDArray[np.float64]]:
    required = {point_id for link in CONSTRAINED_LINKS for point_id in link} | {"wheel_center"}
    resolved: dict[str, NDArray[np.float64]] = {}
    for point_id in required:
        if point_id not in points:
            raise GeometryError(f"Missing required hardpoint: {point_id}")
        value = np.asarray(points[point_id], dtype=np.float64)
        if value.shape != (3,) or not np.all(np.isfinite(value)):
            raise GeometryError(f"Hardpoint {point_id} must contain three finite coordinates")
        resolved[point_id] = value
    return resolved


def _tuple3(values: Sequence[float] | NDArray[np.float64]) -> tuple[float, float, float]:
    return float(values[0]), float(values[1]), float(values[2])


def _rotation_x(angle: float) -> NDArray[np.float64]:
    return np.asarray(
        [[1.0, 0.0, 0.0], [0.0, cos(angle), -sin(angle)], [0.0, sin(angle), cos(angle)]],
        dtype=np.float64,
    )


def _rotation_z(angle: float) -> NDArray[np.float64]:
    return np.asarray(
        [[cos(angle), -sin(angle), 0.0], [sin(angle), cos(angle), 0.0], [0.0, 0.0, 1.0]],
        dtype=np.float64,
    )


def _wrapped_angle(angle: float) -> float:
    return (angle + pi) % (2.0 * pi) - pi


def static_wheel_axis(corner: Corner, camber_rad: float, toe_rad: float) -> NDArray[np.float64]:
    """Return the outward wheel-axis unit vector for the configured alignment.

    Positive camber tilts the wheel top outward. Positive toe is toe-in for both sides.
    The resulting closed form is
    ``[sin(toe) cos(camber), side cos(toe) cos(camber), -sin(camber)]``.
    """
    if corner not in ("front_left", "front_right"):
        raise GeometryError(f"Unsupported suspension corner: {corner}")
    if not np.isfinite(camber_rad) or not np.isfinite(toe_rad):
        raise GeometryError("Static camber and toe must be finite")
    side = 1.0 if corner == "front_left" else -1.0
    nominal_axis = np.asarray([0.0, side, 0.0], dtype=np.float64)
    axis = _rotation_z(-side * toe_rad) @ _rotation_x(-side * camber_rad) @ nominal_axis
    return axis / np.linalg.norm(axis)


def wheel_angles(axis: NDArray[np.float64], corner: Corner) -> tuple[float, float]:
    """Extract signed camber and toe from an outward-pointing wheel axis."""
    if corner not in ("front_left", "front_right"):
        raise GeometryError(f"Unsupported suspension corner: {corner}")
    side = 1.0 if corner == "front_left" else -1.0
    norm = float(np.linalg.norm(axis))
    if not np.isfinite(norm) or norm <= 1.0e-12:
        raise GeometryError("Wheel axis must be a finite nonzero vector")
    normalized = axis / norm
    horizontal = float(np.hypot(normalized[0], normalized[1]))
    if horizontal <= 1.0e-10:
        raise GeometryError("Wheel toe is undefined when the wheel axis is vertical")
    if side * float(normalized[1]) <= 0.0:
        raise GeometryError("Wheel axis reversed across the vehicle centre plane")
    toe = atan2(float(normalized[0]), float(side * normalized[1]))
    camber = atan2(float(-normalized[2]), horizontal)
    return camber, toe


def _transform_point(
    point: NDArray[np.float64],
    wheel_center: NDArray[np.float64],
    translation: NDArray[np.float64],
    rotation_matrix: NDArray[np.float64],
) -> NDArray[np.float64]:
    return wheel_center + translation + rotation_matrix @ (point - wheel_center)


def _transformed_points(
    static_points: Mapping[str, NDArray[np.float64]], parameters: NDArray[np.float64]
) -> dict[str, NDArray[np.float64]]:
    wheel_center = static_points["wheel_center"]
    translation = parameters[:3]
    rotation_matrix = Rotation.from_rotvec(parameters[3:]).as_matrix()
    return {
        point_id: _transform_point(
            static_points[point_id], wheel_center, translation, rotation_matrix
        )
        for point_id in MOVING_IDS
    }


def _constraint_residuals(
    static_points: Mapping[str, NDArray[np.float64]],
    target_lengths: Mapping[tuple[str, str], float],
    parameters: NDArray[np.float64],
    travel_m: float,
) -> NDArray[np.float64]:
    """Evaluate physical constraints independently of optimizer termination state."""
    transformed = _transformed_points(static_points, parameters)
    link_residuals = [
        np.linalg.norm(transformed[end] - static_points[start]) - target_lengths[(start, end)]
        for start, end in CONSTRAINED_LINKS
    ]
    target_z = static_points["wheel_center"][2] + travel_m
    wheel_z_residual = transformed["wheel_center"][2] - target_z
    return np.asarray([*link_residuals, wheel_z_residual], dtype=np.float64)


def _scaled_constraint_jacobian(
    static_points: Mapping[str, NDArray[np.float64]],
    target_lengths: Mapping[tuple[str, str], float],
    parameters: NDArray[np.float64],
    travel_m: float,
    characteristic_length_m: float,
) -> NDArray[np.float64]:
    """Return a dimensionless central-difference Jacobian.

    Translation variables are scaled by a characteristic suspension length and
    rotation variables remain in radians. Residuals are divided by the same
    length, so rank and condition checks do not mix metre and radian columns.
    """
    dimensionless_step = 1.0e-6
    jacobian = np.empty((6, 6), dtype=np.float64)
    for column in range(6):
        physical_step = (
            dimensionless_step * characteristic_length_m
            if column < 3
            else dimensionless_step
        )
        forward = parameters.copy()
        backward = parameters.copy()
        forward[column] += physical_step
        backward[column] -= physical_step
        delta = (
            _constraint_residuals(static_points, target_lengths, forward, travel_m)
            - _constraint_residuals(static_points, target_lengths, backward, travel_m)
        ) / characteristic_length_m
        jacobian[:, column] = delta / (2.0 * dimensionless_step)
    return jacobian


def _virtual_inboard(
    front: NDArray[np.float64], rear: NDArray[np.float64], outboard_x: float
) -> NDArray[np.float64] | None:
    axis = rear - front
    axis_norm = float(np.linalg.norm(axis))
    if axis_norm <= 1.0e-12 or abs(float(axis[0])) / axis_norm <= 1.0e-8:
        return None
    parameter = (outboard_x - float(front[0])) / float(axis[0])
    return front + parameter * axis


def _line_intersection_yz(
    first_origin: NDArray[np.float64],
    first_end: NDArray[np.float64],
    second_origin: NDArray[np.float64],
    second_end: NDArray[np.float64],
) -> tuple[float, float] | None:
    first_direction = first_end[1:3] - first_origin[1:3]
    second_direction = second_end[1:3] - second_origin[1:3]
    first_norm = float(np.linalg.norm(first_direction))
    second_norm = float(np.linalg.norm(second_direction))
    if first_norm <= 1.0e-10 or second_norm <= 1.0e-10:
        return None
    matrix = np.column_stack((first_direction / first_norm, -second_direction / second_norm))
    if float(np.linalg.cond(matrix)) > 1.0e8:
        return None
    parameters = np.linalg.solve(
        np.column_stack((first_direction, -second_direction)),
        second_origin[1:3] - first_origin[1:3],
    )
    intersection = first_origin[1:3] + parameters[0] * first_direction
    return float(intersection[0]), float(intersection[1])


def _rigid_wheel_contact_patch(
    wheel_center: NDArray[np.float64], wheel_axis: NDArray[np.float64], wheel_radius_m: float
) -> NDArray[np.float64] | None:
    vertical = np.asarray([0.0, 0.0, 1.0], dtype=np.float64)
    axis = wheel_axis / np.linalg.norm(wheel_axis)
    downward_in_wheel_plane = -(vertical - float(np.dot(vertical, axis)) * axis)
    direction_norm = float(np.linalg.norm(downward_in_wheel_plane))
    if direction_norm <= 1.0e-10:
        return None
    return wheel_center + wheel_radius_m * downward_in_wheel_plane / direction_norm


def _roll_center(
    points: Mapping[str, NDArray[np.float64]],
    wheel_axis: NDArray[np.float64],
    wheel_radius_m: float,
) -> tuple[float | None, float | None, float | None, str | None]:
    """Compute symmetric-axle geometric roll-centre height in front view.

    The construction is supported only when each wishbone chassis pivot axis
    intersects the ball-joint X plane and the projected arm lines have a stable
    finite intersection. The opposite corner is assumed to be an exact mirror.
    """
    upper_inner = _virtual_inboard(
        points["uca_front_inboard"],
        points["uca_rear_inboard"],
        float(points["uca_outboard"][0]),
    )
    lower_inner = _virtual_inboard(
        points["lca_front_inboard"],
        points["lca_rear_inboard"],
        float(points["lca_outboard"][0]),
    )
    if upper_inner is None or lower_inner is None:
        return None, None, None, "ROLL_CENTER_UNSUPPORTED_PIVOT_AXIS"
    instant_center = _line_intersection_yz(
        upper_inner,
        points["uca_outboard"],
        lower_inner,
        points["lca_outboard"],
    )
    if instant_center is None:
        return None, None, None, "ROLL_CENTER_UNSUPPORTED_PARALLEL_OR_DEGENERATE_ARMS"

    contact_patch = _rigid_wheel_contact_patch(
        points["wheel_center"], wheel_axis, wheel_radius_m
    )
    if contact_patch is None:
        return None, instant_center[0], instant_center[1], "ROLL_CENTER_CONTACT_PATCH_UNDEFINED"
    instant_y, instant_z = instant_center
    contact_y = float(contact_patch[1])
    contact_z = float(contact_patch[2])
    denominator = instant_y - contact_y
    scale = max(abs(instant_y), abs(contact_y), 1.0)
    if abs(denominator) <= 1.0e-10 * scale:
        return None, instant_y, instant_z, "ROLL_CENTER_UNDEFINED_SWING_ARM"
    parameter = -contact_y / denominator
    roll_center_z = contact_z + parameter * (instant_z - contact_z)
    return roll_center_z - contact_z, instant_y, instant_z, None


def _metrics(
    static_points: Mapping[str, NDArray[np.float64]],
    current_points: Mapping[str, NDArray[np.float64]],
    rotation_matrix: NDArray[np.float64],
    wheel_radius_m: float,
    static_camber_rad: float,
    static_toe_rad: float,
    corner: Corner,
) -> tuple[KinematicMetrics, tuple[str, ...], NDArray[np.float64]]:
    side = 1.0 if corner == "front_left" else -1.0
    wheel_axis = rotation_matrix @ static_wheel_axis(corner, static_camber_rad, static_toe_rad)
    camber, toe = wheel_angles(wheel_axis, corner)

    lower = current_points["lca_outboard"]
    upper = current_points["uca_outboard"]
    kingpin = upper - lower
    if float(kingpin[2]) <= 1.0e-8:
        raise GeometryError("Kingpin axis is horizontal or inverted in the solved pose")
    caster = atan2(float(-kingpin[0]), float(kingpin[2]))
    kpi = atan2(float(side * (lower[1] - upper[1])), float(kingpin[2]))
    track_change = float(
        side * (current_points["wheel_center"][1] - static_points["wheel_center"][1])
    )
    roll_height, instant_y, instant_z, roll_warning = _roll_center(
        current_points, wheel_axis, wheel_radius_m
    )
    warnings = (roll_warning,) if roll_warning else ()

    return (
        KinematicMetrics(
            camber_rad=camber,
            camber_change_rad=camber - static_camber_rad,
            camber_gain_rad_per_m=None,
            toe_rad=toe,
            bump_steer_rad=_wrapped_angle(toe - static_toe_rad),
            bump_steer_gradient_rad_per_m=None,
            caster_rad=caster,
            kpi_rad=kpi,
            track_change_m=track_change,
            roll_center_height_m=roll_height,
            instant_center_y_m=instant_y,
            instant_center_z_m=instant_z,
        ),
        warnings,
        wheel_axis,
    )


def _failed_state(
    travel_m: float,
    diagnostics: SolverDiagnostics,
    warning: str,
) -> KinematicState:
    return KinematicState(travel_m, "FAILED", None, None, diagnostics, (warning,))


def solve_pose(
    points: Mapping[str, Sequence[float]],
    travel_m: float,
    wheel_radius_m: float,
    static_camber_rad: float = 0.0,
    static_toe_rad: float = 0.0,
    corner: Corner = "front_left",
    initial_parameters: Sequence[float] | NDArray[np.float64] | None = None,
    settings: SolverSettings = DEFAULT_SOLVER_SETTINGS,
) -> tuple[KinematicState, NDArray[np.float64] | None]:
    """Solve one wheel-travel pose and return the next continuation seed."""
    static_points = _as_points(points)
    if not np.isfinite(wheel_radius_m) or wheel_radius_m <= 0.0:
        raise GeometryError("Wheel radius must be positive and finite")
    if not np.isfinite(travel_m):
        raise GeometryError("Wheel travel must be finite")
    if (
        settings.residual_tolerance_m <= 0.0
        or settings.max_function_evaluations < 1
        or settings.rank_relative_tolerance <= 0.0
        or settings.condition_limit <= 1.0
        or settings.continuity_position_limit_m <= 0.0
        or settings.continuity_rotation_limit_rad <= 0.0
        or settings.max_travel_step_m <= 0.0
    ):
        raise GeometryError("Solver tolerances, limits, and evaluation count must be positive")

    target_lengths = {
        (start, end): float(np.linalg.norm(static_points[end] - static_points[start]))
        for start, end in CONSTRAINED_LINKS
    }
    if any(length <= 1.0e-6 for length in target_lengths.values()):
        raise GeometryError("All constrained links must be longer than 1 micrometre")
    characteristic_length = max(wheel_radius_m, max(target_lengths.values()))

    initial = np.zeros(6, dtype=np.float64)
    if initial_parameters is not None:
        supplied = np.asarray(initial_parameters, dtype=np.float64)
        if supplied.shape != (6,) or not np.all(np.isfinite(supplied)):
            raise GeometryError("Initial solver parameters must contain six finite values")
        initial[:] = supplied
    initial[2] = travel_m

    def residual(parameters: NDArray[np.float64]) -> NDArray[np.float64]:
        return _constraint_residuals(static_points, target_lengths, parameters, travel_m)

    try:
        result = least_squares(
            residual,
            initial,
            method="trf",
            xtol=1.0e-13,
            ftol=1.0e-13,
            gtol=1.0e-13,
            max_nfev=settings.max_function_evaluations,
            x_scale=np.asarray(
                [characteristic_length] * 3 + [1.0, 1.0, 1.0], dtype=np.float64
            ),
        )
    except (ValueError, FloatingPointError) as exc:
        diagnostics = SolverDiagnostics(
            False, False, False, False, True, None, None, 0, None, 0, str(exc)
        )
        return _failed_state(travel_m, diagnostics, "SOLVER_EXCEPTION"), None

    independently_evaluated = residual(result.x)
    finite_solution = bool(
        np.all(np.isfinite(result.x)) and np.all(np.isfinite(independently_evaluated))
    )
    residual_norm = float(np.linalg.norm(independently_evaluated)) if finite_solution else None
    max_residual = (
        float(np.max(np.abs(independently_evaluated))) if finite_solution else None
    )
    residuals_accepted = bool(
        max_residual is not None and max_residual <= settings.residual_tolerance_m
    )

    rank = 0
    condition: float | None = None
    if finite_solution:
        jacobian = _scaled_constraint_jacobian(
            static_points,
            target_lengths,
            np.asarray(result.x, dtype=np.float64),
            travel_m,
            characteristic_length,
        )
        singular_values = np.linalg.svd(jacobian, compute_uv=False)
        if singular_values.size and singular_values[0] > 0.0:
            threshold = settings.rank_relative_tolerance * singular_values[0]
            rank = int(np.sum(singular_values > threshold))
            if singular_values[-1] > 0.0:
                condition = float(singular_values[0] / singular_values[-1])
    jacobian_accepted = bool(
        rank == 6 and condition is not None and condition <= settings.condition_limit
    )
    converged = bool(
        result.success and finite_solution and residuals_accepted and jacobian_accepted
    )

    failure_reasons: list[str] = []
    if not result.success:
        failure_reasons.append("optimizer did not report success")
    if not finite_solution:
        failure_reasons.append("solution or independently evaluated residuals are non-finite")
    if not residuals_accepted:
        measured = "non-finite" if max_residual is None else f"{max_residual:.3e} m"
        failure_reasons.append(
            f"maximum independently evaluated residual {measured} exceeds "
            f"{settings.residual_tolerance_m:.3e} m"
        )
    if rank < 6:
        failure_reasons.append(f"scaled constraint Jacobian rank is {rank}, expected 6")
    if condition is None or condition > settings.condition_limit:
        failure_reasons.append("scaled constraint Jacobian is singular or ill-conditioned")
    message = "; ".join(failure_reasons) if failure_reasons else str(result.message)
    diagnostics = SolverDiagnostics(
        converged=converged,
        optimizer_success=bool(result.success),
        residuals_accepted=residuals_accepted,
        jacobian_accepted=jacobian_accepted,
        continuity_accepted=True,
        residual_norm_m=residual_norm,
        max_abs_residual_m=max_residual,
        jacobian_rank=rank,
        jacobian_condition=condition,
        function_evaluations=int(result.nfev),
        message=message,
    )
    if not converged:
        return _failed_state(travel_m, diagnostics, "NON_CONVERGENCE"), None

    translation = np.asarray(result.x[:3], dtype=np.float64)
    rotation_vector = np.asarray(result.x[3:], dtype=np.float64)
    rotation_matrix = Rotation.from_rotvec(rotation_vector).as_matrix()
    current_points = dict(static_points)
    current_points.update(_transformed_points(static_points, np.asarray(result.x)))
    try:
        metrics, warnings, wheel_axis = _metrics(
            static_points,
            current_points,
            rotation_matrix,
            wheel_radius_m,
            static_camber_rad,
            static_toe_rad,
            corner,
        )
    except GeometryError as exc:
        post_diagnostics = replace(
            diagnostics,
            converged=False,
            message=f"Solved constraints but rejected derived geometry: {exc}",
        )
        return _failed_state(travel_m, post_diagnostics, "DERIVED_GEOMETRY_INVALID"), None

    pose = KinematicPose(
        hardpoints={point_id: _tuple3(point) for point_id, point in current_points.items()},
        wheel_axis=_tuple3(wheel_axis),
        translation=_tuple3(translation),
        rotation_vector=_tuple3(rotation_vector),
    )
    return (
        KinematicState(
            travel_m,
            "VERIFIED_NUMERICALLY",
            pose,
            metrics,
            diagnostics,
            warnings,
        ),
        np.asarray(result.x, dtype=np.float64).copy(),
    )


def _relative_rotation_magnitude(first: KinematicPose, second: KinematicPose) -> float:
    first_rotation = Rotation.from_rotvec(np.asarray(first.rotation_vector))
    second_rotation = Rotation.from_rotvec(np.asarray(second.rotation_vector))
    return float((second_rotation * first_rotation.inv()).magnitude())


def _continuity_failure(
    state: KinematicState,
    previous: KinematicState,
    settings: SolverSettings,
) -> KinematicState | None:
    if state.pose is None or previous.pose is None:
        return None
    translation_jump = float(
        np.linalg.norm(np.asarray(state.pose.translation) - np.asarray(previous.pose.translation))
    )
    rotation_jump = _relative_rotation_magnitude(previous.pose, state.pose)
    reasons: list[str] = []
    if translation_jump > settings.continuity_position_limit_m:
        reasons.append(
            f"pose translation jump {translation_jump:.3e} m exceeds "
            f"{settings.continuity_position_limit_m:.3e} m"
        )
    if rotation_jump > settings.continuity_rotation_limit_rad:
        reasons.append(
            f"pose rotation jump {rotation_jump:.3e} rad exceeds "
            f"{settings.continuity_rotation_limit_rad:.3e} rad"
        )
    if not reasons:
        return None
    diagnostics = replace(
        state.diagnostics,
        converged=False,
        continuity_accepted=False,
        message="; ".join(reasons),
    )
    return _failed_state(state.travel_m, diagnostics, "CONTINUITY_REJECTED")


def _aborted_state(travel_m: float, message: str) -> KinematicState:
    diagnostics = SolverDiagnostics(
        converged=False,
        optimizer_success=False,
        residuals_accepted=False,
        jacobian_accepted=False,
        continuity_accepted=False,
        residual_norm_m=None,
        max_abs_residual_m=None,
        jacobian_rank=0,
        jacobian_condition=None,
        function_evaluations=0,
        message=message,
    )
    return _failed_state(travel_m, diagnostics, "CONTINUATION_ABORTED")


def _apply_gradients(states: list[KinematicState]) -> None:
    """Apply finite differences only within contiguous numerically verified blocks."""
    block_start = 0
    while block_start < len(states):
        while (
            block_start < len(states)
            and states[block_start].calculation_status != "VERIFIED_NUMERICALLY"
        ):
            block_start += 1
        if block_start >= len(states):
            break
        block_end = block_start
        while (
            block_end + 1 < len(states)
            and states[block_end + 1].calculation_status == "VERIFIED_NUMERICALLY"
        ):
            block_end += 1
        block_indices = list(range(block_start, block_end + 1))
        if len(block_indices) >= 2:
            travel = np.asarray([states[index].travel_m for index in block_indices])
            metrics = [states[index].metrics for index in block_indices]
            camber = np.asarray([item.camber_rad for item in metrics if item is not None])
            toe = np.unwrap(np.asarray([item.toe_rad for item in metrics if item is not None]))
            edge_order: Literal[1, 2] = 2 if len(block_indices) >= 3 else 1
            camber_gradient = np.gradient(camber, travel, edge_order=edge_order)
            toe_gradient = np.gradient(toe, travel, edge_order=edge_order)
            for offset, result_index in enumerate(block_indices):
                state = states[result_index]
                if state.metrics is None:
                    continue
                warnings = list(state.warnings)
                if offset in (0, len(block_indices) - 1):
                    warnings.append("ONE_SIDED_GRADIENT")
                if (
                    (result_index > 0 and states[result_index - 1].calculation_status == "FAILED")
                    or (
                        result_index + 1 < len(states)
                        and states[result_index + 1].calculation_status == "FAILED"
                    )
                ):
                    warnings.append("GRADIENT_ADJACENT_TO_FAILED_STATE")
                states[result_index] = replace(
                    state,
                    metrics=replace(
                        state.metrics,
                        camber_gain_rad_per_m=float(camber_gradient[offset]),
                        bump_steer_gradient_rad_per_m=float(toe_gradient[offset]),
                    ),
                    warnings=tuple(dict.fromkeys(warnings)),
                )
        block_start = block_end + 1


def solve_sweep(
    points: Mapping[str, Sequence[float]],
    start_travel_m: float,
    end_travel_m: float,
    steps: int,
    wheel_radius_m: float,
    static_camber_rad: float = 0.0,
    static_toe_rad: float = 0.0,
    corner: Corner = "front_left",
    settings: SolverSettings = DEFAULT_SOLVER_SETTINGS,
) -> SweepResult:
    """Solve a travel sweep from static in both directions using continuation."""
    if steps < 2 or steps > 401:
        raise ValueError("Sweep steps must be between 2 and 401")
    if end_travel_m <= start_travel_m:
        raise ValueError("Sweep end must be greater than sweep start")
    travels = [float(value) for value in np.linspace(start_travel_m, end_travel_m, steps)]
    maximum_step = max(
        abs(second - first) for first, second in zip(travels, travels[1:], strict=False)
    )
    if maximum_step > settings.max_travel_step_m + 1.0e-12:
        raise ValueError(
            f"Sweep travel step {maximum_step:.3e} m exceeds the verified maximum "
            f"{settings.max_travel_step_m:.3e} m"
        )

    static_state, static_parameters = solve_pose(
        points,
        0.0,
        wheel_radius_m,
        static_camber_rad,
        static_toe_rad,
        corner,
        None,
        settings,
    )
    if static_parameters is None:
        states = tuple(
            static_state
            if abs(travel) <= 1.0e-14
            else _aborted_state(travel, "Static pose failed; sweep was not attempted.")
            for travel in travels
        )
        return SweepResult(states, False, "FAILED", settings.residual_tolerance_m)

    indexed = list(enumerate(travels))
    zero_indices = [index for index, travel in indexed if abs(travel) <= 1.0e-14]
    positive = sorted((item for item in indexed if item[1] > 1.0e-14), key=lambda item: item[1])
    negative = sorted(
        (item for item in indexed if item[1] < -1.0e-14),
        key=lambda item: item[1],
        reverse=True,
    )
    solved: dict[int, KinematicState] = {index: static_state for index in zero_indices}

    for branch in (positive, negative):
        previous_parameters = static_parameters.copy()
        previous_state = static_state
        branch_failed = False
        for index, travel in branch:
            if branch_failed:
                solved[index] = _aborted_state(
                    travel, "Not attempted because the previous continuation point failed."
                )
                continue
            state, parameters = solve_pose(
                points,
                travel,
                wheel_radius_m,
                static_camber_rad,
                static_toe_rad,
                corner,
                previous_parameters,
                settings,
            )
            if parameters is not None:
                continuity_failure = _continuity_failure(state, previous_state, settings)
                if continuity_failure is not None:
                    state = continuity_failure
                    parameters = None
            solved[index] = state
            if parameters is None:
                branch_failed = True
                continue
            previous_parameters = parameters
            previous_state = state

    ordered = [solved[index] for index in range(len(travels))]
    _apply_gradients(ordered)
    all_converged = all(
        state.calculation_status == "VERIFIED_NUMERICALLY" for state in ordered
    )
    return SweepResult(
        states=tuple(ordered),
        all_converged=all_converged,
        calculation_status="VERIFIED_NUMERICALLY" if all_converged else "FAILED",
        residual_tolerance_m=settings.residual_tolerance_m,
    )
