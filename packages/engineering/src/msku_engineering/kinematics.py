"""Rigid-body double-wishbone kinematics.

The moving upright is represented by one translation and one rotation vector.
Five measured rigid-link lengths plus prescribed wheel-centre Z displacement
form six nonlinear constraints. No force, compliance, or dynamics model is
included here.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from math import atan2, cos, sin
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation

from .geometry import GeometryError

Corner = Literal["front_left", "front_right"]

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
    rank_tolerance: float = 1.0e-9
    condition_limit: float = 1.0e10
    continuity_position_limit_m: float = 0.030
    continuity_rotation_limit_rad: float = 0.35


DEFAULT_SOLVER_SETTINGS = SolverSettings()


@dataclass(frozen=True)
class SolverDiagnostics:
    converged: bool
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
    pose: KinematicPose | None
    metrics: KinematicMetrics | None
    diagnostics: SolverDiagnostics
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class SweepResult:
    states: tuple[KinematicState, ...]
    all_converged: bool
    residual_tolerance_m: float
    model_status: Literal["unvalidated"] = "unvalidated"


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


def static_wheel_axis(corner: Corner, camber_rad: float, toe_rad: float) -> NDArray[np.float64]:
    """Return the outward wheel-axis unit vector for the configured static alignment.

    Positive camber tilts the wheel top outward. Positive toe is toe-in for both sides.
    """
    side = 1.0 if corner == "front_left" else -1.0
    nominal_axis = np.asarray([0.0, side, 0.0], dtype=np.float64)
    axis = _rotation_z(-side * toe_rad) @ _rotation_x(-side * camber_rad) @ nominal_axis
    return axis / np.linalg.norm(axis)


def wheel_angles(axis: NDArray[np.float64], corner: Corner) -> tuple[float, float]:
    side = 1.0 if corner == "front_left" else -1.0
    normalized = axis / np.linalg.norm(axis)
    toe = atan2(float(normalized[0]), float(side * normalized[1]))
    camber = atan2(float(-normalized[2]), float(np.hypot(normalized[0], normalized[1])))
    return camber, toe


def _transform_point(
    point: NDArray[np.float64],
    wheel_center: NDArray[np.float64],
    translation: NDArray[np.float64],
    rotation_matrix: NDArray[np.float64],
) -> NDArray[np.float64]:
    return wheel_center + translation + rotation_matrix @ (point - wheel_center)


def _virtual_inboard(
    front: NDArray[np.float64], rear: NDArray[np.float64], outboard_x: float
) -> NDArray[np.float64] | None:
    delta_x = float(rear[0] - front[0])
    if abs(delta_x) < 1.0e-12:
        return None
    parameter = (outboard_x - float(front[0])) / delta_x
    return front + parameter * (rear - front)


def _line_intersection_yz(
    first_origin: NDArray[np.float64],
    first_end: NDArray[np.float64],
    second_origin: NDArray[np.float64],
    second_end: NDArray[np.float64],
) -> tuple[float, float] | None:
    first_direction = first_end[1:3] - first_origin[1:3]
    second_direction = second_end[1:3] - second_origin[1:3]
    matrix = np.column_stack((first_direction, -second_direction))
    determinant = float(np.linalg.det(matrix))
    if abs(determinant) < 1.0e-12:
        return None
    parameters = np.linalg.solve(matrix, second_origin[1:3] - first_origin[1:3])
    intersection = first_origin[1:3] + parameters[0] * first_direction
    return float(intersection[0]), float(intersection[1])


def _roll_center(
    points: Mapping[str, NDArray[np.float64]], wheel_radius_m: float
) -> tuple[float | None, float | None, float | None, str | None]:
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
        return None, None, None, "ROLL_CENTER_PIVOT_AXIS_PARALLEL"
    instant_center = _line_intersection_yz(
        upper_inner,
        points["uca_outboard"],
        lower_inner,
        points["lca_outboard"],
    )
    if instant_center is None:
        return None, None, None, "ROLL_CENTER_PARALLEL_ARMS"

    instant_y, instant_z = instant_center
    wheel_center = points["wheel_center"]
    contact_y = float(wheel_center[1])
    contact_z = float(wheel_center[2] - wheel_radius_m)
    denominator = instant_y - contact_y
    if abs(denominator) < 1.0e-12:
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
    caster = atan2(float(-kingpin[0]), float(kingpin[2]))
    kpi = atan2(float(side * (lower[1] - upper[1])), float(kingpin[2]))
    track_change = float(
        side * (current_points["wheel_center"][1] - static_points["wheel_center"][1])
    )
    roll_height, instant_y, instant_z, roll_warning = _roll_center(current_points, wheel_radius_m)
    warnings = (roll_warning,) if roll_warning else ()

    return (
        KinematicMetrics(
            camber_rad=camber,
            camber_change_rad=camber - static_camber_rad,
            camber_gain_rad_per_m=None,
            toe_rad=toe,
            bump_steer_rad=toe - static_toe_rad,
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
    wheel_center = static_points["wheel_center"]
    target_lengths = {
        (start, end): float(np.linalg.norm(static_points[end] - static_points[start]))
        for start, end in CONSTRAINED_LINKS
    }
    if not np.isfinite(travel_m):
        raise GeometryError("Wheel travel must be finite")

    initial = np.zeros(6, dtype=np.float64)
    if initial_parameters is not None:
        supplied = np.asarray(initial_parameters, dtype=np.float64)
        if supplied.shape != (6,) or not np.all(np.isfinite(supplied)):
            raise GeometryError("Initial solver parameters must contain six finite values")
        initial[:] = supplied
    initial[2] = travel_m

    def residual(parameters: NDArray[np.float64]) -> NDArray[np.float64]:
        translation = parameters[:3]
        rotation_matrix = Rotation.from_rotvec(parameters[3:]).as_matrix()
        transformed = {
            point_id: _transform_point(
                static_points[point_id], wheel_center, translation, rotation_matrix
            )
            for point_id in MOVING_IDS
        }
        link_residuals = [
            np.linalg.norm(transformed[end] - static_points[start]) - target_lengths[(start, end)]
            for start, end in CONSTRAINED_LINKS
        ]
        wheel_z_residual = transformed["wheel_center"][2] - (wheel_center[2] + travel_m)
        return np.asarray([*link_residuals, wheel_z_residual], dtype=np.float64)

    try:
        result = least_squares(
            residual,
            initial,
            method="trf",
            xtol=1.0e-13,
            ftol=1.0e-13,
            gtol=1.0e-13,
            max_nfev=settings.max_function_evaluations,
            x_scale="jac",
        )
    except (ValueError, FloatingPointError) as exc:
        diagnostics = SolverDiagnostics(False, None, None, 0, None, 0, str(exc))
        return KinematicState(travel_m, None, None, diagnostics, ("SOLVER_EXCEPTION",)), None

    residuals = residual(result.x)
    residual_norm = float(np.linalg.norm(residuals))
    max_residual = float(np.max(np.abs(residuals)))
    jacobian = np.asarray(result.jac, dtype=np.float64)
    singular_values = np.linalg.svd(jacobian, compute_uv=False)
    rank = int(np.sum(singular_values > settings.rank_tolerance))
    condition = (
        float(singular_values[0] / singular_values[-1])
        if singular_values.size and singular_values[-1] > 0
        else None
    )
    converged = bool(
        result.success
        and np.all(np.isfinite(result.x))
        and max_residual <= settings.residual_tolerance_m
        and rank == 6
        and condition is not None
        and condition <= settings.condition_limit
    )
    failure_reasons: list[str] = []
    if not result.success:
        failure_reasons.append("optimizer did not report success")
    if max_residual > settings.residual_tolerance_m:
        failure_reasons.append(
            f"maximum residual {max_residual:.3e} m exceeds {settings.residual_tolerance_m:.3e} m"
        )
    if rank < 6:
        failure_reasons.append(f"constraint Jacobian rank is {rank}, expected 6")
    if condition is None or condition > settings.condition_limit:
        failure_reasons.append("constraint Jacobian is singular or ill-conditioned")
    message = "; ".join(failure_reasons) if failure_reasons else str(result.message)
    diagnostics = SolverDiagnostics(
        converged,
        residual_norm,
        max_residual,
        rank,
        condition,
        int(result.nfev),
        message,
    )
    if not converged:
        return KinematicState(travel_m, None, None, diagnostics, ("NON_CONVERGENCE",)), None

    translation = result.x[:3]
    rotation_vector = result.x[3:]
    rotation_matrix = Rotation.from_rotvec(rotation_vector).as_matrix()
    current_points = dict(static_points)
    current_points.update(
        {
            point_id: _transform_point(
                static_points[point_id], wheel_center, translation, rotation_matrix
            )
            for point_id in MOVING_IDS
        }
    )
    metrics, warnings, wheel_axis = _metrics(
        static_points,
        current_points,
        rotation_matrix,
        wheel_radius_m,
        static_camber_rad,
        static_toe_rad,
        corner,
    )
    pose = KinematicPose(
        hardpoints={point_id: _tuple3(point) for point_id, point in current_points.items()},
        wheel_axis=_tuple3(wheel_axis),
        translation=_tuple3(translation),
        rotation_vector=_tuple3(rotation_vector),
    )
    return KinematicState(travel_m, pose, metrics, diagnostics, warnings), result.x.copy()


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
    indexed = list(enumerate(travels))
    positive = sorted((item for item in indexed if item[1] >= 0), key=lambda item: item[1])
    negative = sorted(
        (item for item in indexed if item[1] < 0),
        key=lambda item: item[1],
        reverse=True,
    )
    solved: dict[int, KinematicState] = {}

    for branch in (positive, negative):
        previous_parameters: NDArray[np.float64] | None = None
        previous_state: KinematicState | None = None
        for index, travel in branch:
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
            warnings = list(state.warnings)
            if state.pose and previous_state and previous_state.pose:
                current_translation = np.asarray(state.pose.translation)
                previous_translation = np.asarray(previous_state.pose.translation)
                translation_jump = float(np.linalg.norm(current_translation - previous_translation))
                current_rotation = np.asarray(state.pose.rotation_vector)
                previous_rotation = np.asarray(previous_state.pose.rotation_vector)
                rotation_jump = float(np.linalg.norm(current_rotation - previous_rotation))
                if translation_jump > settings.continuity_position_limit_m:
                    warnings.append("POSITION_CONTINUITY_JUMP")
                if rotation_jump > settings.continuity_rotation_limit_rad:
                    warnings.append("ROTATION_CONTINUITY_JUMP")
            state = replace(state, warnings=tuple(warnings))
            solved[index] = state
            if parameters is None:
                break
            previous_parameters = parameters
            previous_state = state

        if len(branch) > 0 and len([index for index, _ in branch if index in solved]) < len(branch):
            for index, travel in branch:
                if index not in solved:
                    diagnostics = SolverDiagnostics(
                        False,
                        None,
                        None,
                        0,
                        None,
                        0,
                        "Not attempted because the previous continuation point failed.",
                    )
                    solved[index] = KinematicState(
                        travel,
                        None,
                        None,
                        diagnostics,
                        ("CONTINUATION_ABORTED",),
                    )

    ordered = [solved[index] for index in range(len(travels))]
    successful_indices = [index for index, state in enumerate(ordered) if state.metrics is not None]
    if len(successful_indices) >= 2:
        successful_travel = np.asarray([ordered[index].travel_m for index in successful_indices])
        successful_metrics = [ordered[index].metrics for index in successful_indices]
        camber_values = np.asarray(
            [metrics.camber_rad for metrics in successful_metrics if metrics is not None]
        )
        toe_values = np.asarray(
            [metrics.toe_rad for metrics in successful_metrics if metrics is not None]
        )
        edge_order: Literal[1, 2] = 2 if len(successful_indices) >= 3 else 1
        camber_gradient = np.gradient(camber_values, successful_travel, edge_order=edge_order)
        toe_gradient = np.gradient(toe_values, successful_travel, edge_order=edge_order)
        for result_index, camber_gain, toe_gain in zip(
            successful_indices, camber_gradient, toe_gradient, strict=True
        ):
            state = ordered[result_index]
            if state.metrics is not None:
                ordered[result_index] = replace(
                    state,
                    metrics=replace(
                        state.metrics,
                        camber_gain_rad_per_m=float(camber_gain),
                        bump_steer_gradient_rad_per_m=float(toe_gain),
                    ),
                )

    return SweepResult(
        states=tuple(ordered),
        all_converged=all(state.diagnostics.converged for state in ordered),
        residual_tolerance_m=settings.residual_tolerance_m,
    )
