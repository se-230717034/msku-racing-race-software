from math import atan2, cos, isclose, sin

import numpy as np
import pytest
from msku_engineering.kinematics import (
    CONSTRAINED_LINKS,
    KinematicMetrics,
    KinematicState,
    SolverDiagnostics,
    SolverSettings,
    _apply_gradients,
    _roll_center,
    solve_pose,
    solve_sweep,
    static_wheel_axis,
    wheel_angles,
)
from scipy.optimize import root


def demo_points() -> dict[str, tuple[float, float, float]]:
    return {
        "uca_front_inboard": (0.18, 0.31, 0.46),
        "uca_rear_inboard": (-0.16, 0.30, 0.45),
        "uca_outboard": (0.01, 0.64, 0.40),
        "lca_front_inboard": (0.22, 0.27, 0.19),
        "lca_rear_inboard": (-0.19, 0.26, 0.18),
        "lca_outboard": (0.0, 0.68, 0.17),
        "tie_rod_inboard": (-0.12, 0.29, 0.25),
        "tie_rod_outboard": (-0.09, 0.67, 0.26),
        "wheel_center": (0.0, 0.72, 0.285),
    }


def distance(first: tuple[float, ...], second: tuple[float, ...]) -> float:
    return float(np.linalg.norm(np.asarray(second) - np.asarray(first)))


def test_zero_travel_is_static_identity() -> None:
    points = demo_points()
    state, _ = solve_pose(points, 0.0, 0.2286)
    assert state.diagnostics.converged
    assert state.calculation_status == "VERIFIED_NUMERICALLY"
    assert state.diagnostics.optimizer_success
    assert state.diagnostics.residuals_accepted
    assert state.diagnostics.jacobian_accepted
    assert state.diagnostics.max_abs_residual_m <= 1.0e-8
    assert state.pose is not None
    assert state.metrics is not None
    for point_id, expected in points.items():
        assert np.allclose(state.pose.hardpoints[point_id], expected, atol=1.0e-12)
    assert isclose(state.metrics.camber_rad, 0.0, abs_tol=1.0e-12)
    assert isclose(state.metrics.toe_rad, 0.0, abs_tol=1.0e-12)


def test_sweep_preserves_every_rigid_link() -> None:
    points = demo_points()
    result = solve_sweep(points, -0.04, 0.04, 17, 0.2286)
    assert result.all_converged
    for state in result.states:
        assert state.pose is not None
        for start, end in CONSTRAINED_LINKS:
            expected = distance(points[start], points[end])
            actual = distance(state.pose.hardpoints[start], state.pose.hardpoints[end])
            assert isclose(actual, expected, abs_tol=1.0e-8)


def test_sweep_has_finite_alignment_gradients() -> None:
    result = solve_sweep(demo_points(), -0.03, 0.03, 13, 0.2286)
    for state in result.states:
        assert state.metrics is not None
        assert state.metrics.camber_gain_rad_per_m is not None
        assert state.metrics.bump_steer_gradient_rad_per_m is not None
        assert np.isfinite(state.metrics.camber_gain_rad_per_m)
        assert np.isfinite(state.metrics.bump_steer_gradient_rad_per_m)


def test_left_right_mirror_has_symmetric_metrics() -> None:
    left = demo_points()
    right = {point_id: (point[0], -point[1], point[2]) for point_id, point in left.items()}
    left_state, _ = solve_pose(left, 0.02, 0.2286, corner="front_left")
    right_state, _ = solve_pose(right, 0.02, 0.2286, corner="front_right")
    assert left_state.metrics is not None
    assert right_state.metrics is not None
    for field in ("camber_rad", "toe_rad", "caster_rad", "kpi_rad", "track_change_m"):
        assert isclose(
            getattr(left_state.metrics, field),
            getattr(right_state.metrics, field),
            abs_tol=1.0e-9,
        )
    assert isclose(
        left_state.metrics.roll_center_height_m,
        right_state.metrics.roll_center_height_m,
        abs_tol=1.0e-9,
    )


def test_static_alignment_round_trips_on_both_sides() -> None:
    left = demo_points()
    right = {point_id: (point[0], -point[1], point[2]) for point_id, point in left.items()}
    for points, corner in ((left, "front_left"), (right, "front_right")):
        state, _ = solve_pose(
            points,
            0.0,
            0.2286,
            static_camber_rad=0.03,
            static_toe_rad=0.02,
            corner=corner,
        )
        assert state.metrics is not None
        assert isclose(state.metrics.camber_rad, 0.03, abs_tol=1.0e-12)
        assert isclose(state.metrics.toe_rad, 0.02, abs_tol=1.0e-12)


def test_dynamic_left_right_mirror_with_nonzero_alignment_is_symmetric() -> None:
    left = demo_points()
    right = {point_id: (point[0], -point[1], point[2]) for point_id, point in left.items()}
    left_state, _ = solve_pose(
        left, 0.025, 0.2286, static_camber_rad=-0.025, static_toe_rad=0.012
    )
    right_state, _ = solve_pose(
        right,
        0.025,
        0.2286,
        static_camber_rad=-0.025,
        static_toe_rad=0.012,
        corner="front_right",
    )
    assert left_state.metrics is not None
    assert right_state.metrics is not None
    assert left_state.pose is not None
    assert right_state.pose is not None
    for field in (
        "camber_rad",
        "camber_change_rad",
        "toe_rad",
        "bump_steer_rad",
        "caster_rad",
        "kpi_rad",
        "track_change_m",
        "roll_center_height_m",
    ):
        assert isclose(
            getattr(left_state.metrics, field),
            getattr(right_state.metrics, field),
            abs_tol=2.0e-10,
        )
    left_axis = np.asarray(left_state.pose.wheel_axis)
    right_axis = np.asarray(right_state.pose.wheel_axis)
    assert np.allclose(right_axis, left_axis * np.asarray([1.0, -1.0, 1.0]), atol=2.0e-10)


def test_impossible_travel_fails_visibly() -> None:
    state, parameters = solve_pose(demo_points(), 1.0, 0.2286)
    assert not state.diagnostics.converged
    assert state.pose is None
    assert parameters is None
    assert state.calculation_status == "FAILED"
    assert "NON_CONVERGENCE" in state.warnings


def test_parallel_equal_length_arms_match_analytic_translation() -> None:
    points = {
        "uca_front_inboard": (0.20, 0.0, 0.40),
        "uca_rear_inboard": (-0.20, 0.0, 0.40),
        "uca_outboard": (0.0, 0.50, 0.40),
        "lca_front_inboard": (0.20, 0.0, 0.20),
        "lca_rear_inboard": (-0.20, 0.0, 0.20),
        "lca_outboard": (0.0, 0.50, 0.20),
        "tie_rod_inboard": (0.10, 0.0, 0.30),
        "tie_rod_outboard": (0.10, 0.50, 0.30),
        "wheel_center": (0.0, 0.55, 0.30),
    }
    travel = 0.05
    expected_lateral_translation = float(np.sqrt(0.50**2 - travel**2) - 0.50)
    state, _ = solve_pose(points, travel, 0.20)
    assert state.diagnostics.converged
    assert state.pose is not None
    assert state.metrics is not None
    assert isclose(state.pose.translation[0], 0.0, abs_tol=1.0e-9)
    assert isclose(state.pose.translation[1], expected_lateral_translation, abs_tol=1.0e-9)
    assert isclose(state.pose.translation[2], travel, abs_tol=1.0e-10)
    assert np.allclose(state.pose.rotation_vector, (0.0, 0.0, 0.0), atol=1.0e-9)
    assert isclose(state.metrics.camber_change_rad, 0.0, abs_tol=1.0e-9)
    assert isclose(state.metrics.bump_steer_rad, 0.0, abs_tol=1.0e-9)


@pytest.mark.parametrize("corner,side", [("front_left", 1.0), ("front_right", -1.0)])
def test_nonzero_static_wheel_axis_matches_closed_form_and_round_trips(
    corner: str, side: float
) -> None:
    camber = 0.071
    toe = 0.043
    expected = np.asarray(
        [sin(toe) * cos(camber), side * cos(toe) * cos(camber), -sin(camber)]
    )
    axis = static_wheel_axis(corner, camber, toe)  # type: ignore[arg-type]
    assert np.allclose(axis, expected, atol=2.0e-15)
    recovered_camber, recovered_toe = wheel_angles(axis, corner)  # type: ignore[arg-type]
    assert isclose(recovered_camber, camber, abs_tol=2.0e-15)
    assert isclose(recovered_toe, toe, abs_tol=2.0e-15)


def test_caster_and_kpi_match_independent_projected_axis_equations() -> None:
    points = demo_points()
    state, _ = solve_pose(points, 0.0, 0.2286)
    assert state.metrics is not None
    kingpin = np.asarray(points["uca_outboard"]) - np.asarray(points["lca_outboard"])
    expected_caster = atan2(-float(kingpin[0]), float(kingpin[2]))
    expected_kpi = atan2(
        float(points["lca_outboard"][1] - points["uca_outboard"][1]),
        float(kingpin[2]),
    )
    assert isclose(state.metrics.caster_rad, expected_caster, abs_tol=1.0e-14)
    assert isclose(state.metrics.kpi_rad, expected_kpi, abs_tol=1.0e-14)


def test_roll_center_matches_closed_form_front_view_construction() -> None:
    points = {
        "uca_front_inboard": (0.20, 0.30, 0.45),
        "uca_rear_inboard": (-0.20, 0.30, 0.45),
        "uca_outboard": (0.0, 0.64, 0.40),
        "lca_front_inboard": (0.20, 0.28, 0.18),
        "lca_rear_inboard": (-0.20, 0.28, 0.18),
        "lca_outboard": (0.0, 0.68, 0.17),
        "tie_rod_inboard": (-0.12, 0.29, 0.25),
        "tie_rod_outboard": (-0.09, 0.67, 0.26),
        "wheel_center": (0.0, 0.72, 0.285),
    }
    state, _ = solve_pose(points, 0.0, 0.2286)
    assert state.metrics is not None

    upper_inner = np.asarray([0.30, 0.45])
    upper_outer = np.asarray([0.64, 0.40])
    lower_inner = np.asarray([0.28, 0.18])
    lower_outer = np.asarray([0.68, 0.17])
    matrix = np.column_stack(
        (upper_outer - upper_inner, -(lower_outer - lower_inner))
    )
    parameters = np.linalg.solve(matrix, lower_inner - upper_inner)
    instant_center = upper_inner + parameters[0] * (upper_outer - upper_inner)
    contact_patch = np.asarray([0.72, 0.285 - 0.2286])
    centreline_parameter = -contact_patch[0] / (instant_center[0] - contact_patch[0])
    expected_height = (
        contact_patch[1]
        + centreline_parameter * (instant_center[1] - contact_patch[1])
        - contact_patch[1]
    )
    assert isclose(state.metrics.instant_center_y_m, instant_center[0], abs_tol=1.0e-13)
    assert isclose(state.metrics.instant_center_z_m, instant_center[1], abs_tol=1.0e-13)
    assert isclose(state.metrics.roll_center_height_m, expected_height, abs_tol=1.0e-13)


def test_roll_center_is_suppressed_when_pivot_axis_cannot_reach_ball_joint_plane() -> None:
    points = {key: np.asarray(value, dtype=float) for key, value in demo_points().items()}
    points["uca_rear_inboard"][0] = points["uca_front_inboard"][0]
    height, instant_y, instant_z, warning = _roll_center(
        points, np.asarray([0.0, 1.0, 0.0]), 0.2286
    )
    assert height is None
    assert instant_y is None
    assert instant_z is None
    assert warning == "ROLL_CENTER_UNSUPPORTED_PIVOT_AXIS"


def _euler_xyz_matrix(angles: np.ndarray) -> np.ndarray:
    rx, ry, rz = angles
    rotation_x = np.asarray(
        [[1.0, 0.0, 0.0], [0.0, cos(rx), -sin(rx)], [0.0, sin(rx), cos(rx)]]
    )
    rotation_y = np.asarray(
        [[cos(ry), 0.0, sin(ry)], [0.0, 1.0, 0.0], [-sin(ry), 0.0, cos(ry)]]
    )
    rotation_z = np.asarray(
        [[cos(rz), -sin(rz), 0.0], [sin(rz), cos(rz), 0.0], [0.0, 0.0, 1.0]]
    )
    return rotation_z @ rotation_y @ rotation_x


def _independent_squared_distance_reference(
    points: dict[str, tuple[float, float, float]], travel_m: float
) -> tuple[np.ndarray, np.ndarray]:
    """Reference solve using Euler angles, squared distances, and MINPACK root."""
    resolved = {point_id: np.asarray(value) for point_id, value in points.items()}
    wheel_center = resolved["wheel_center"]
    squared_lengths = {
        link: float(
            np.dot(
                resolved[link[1]] - resolved[link[0]],
                resolved[link[1]] - resolved[link[0]],
            )
        )
        for link in CONSTRAINED_LINKS
    }
    estimate = np.zeros(5)
    step_count = max(1, int(np.ceil(abs(travel_m) / 0.005)))
    for step_travel in np.linspace(0.0, travel_m, step_count + 1)[1:]:

        def residual(
            parameters: np.ndarray, target_travel: float = float(step_travel)
        ) -> np.ndarray:
            translation = np.asarray([parameters[0], parameters[1], target_travel])
            rotation = _euler_xyz_matrix(parameters[2:])
            values = []
            for start, end in CONSTRAINED_LINKS:
                moved = wheel_center + translation + rotation @ (resolved[end] - wheel_center)
                difference = moved - resolved[start]
                values.append(
                    (float(np.dot(difference, difference)) - squared_lengths[(start, end)])
                    / squared_lengths[(start, end)]
                )
            return np.asarray(values)

        reference = root(residual, estimate, method="hybr", tol=1.0e-11)
        assert reference.success
        assert np.max(np.abs(residual(reference.x))) < 2.0e-12
        estimate = reference.x
    return estimate[:2], _euler_xyz_matrix(estimate[2:])


def test_unequal_length_asymmetric_geometry_matches_independent_reference_solver() -> None:
    points = demo_points()
    travel = 0.04
    reference_xy, reference_rotation = _independent_squared_distance_reference(points, travel)
    result = solve_sweep(points, -travel, travel, 17, 0.2286)
    state = result.states[-1]
    assert state.pose is not None
    assert state.metrics is not None

    expected_translation = np.asarray([reference_xy[0], reference_xy[1], travel])
    assert np.allclose(state.pose.translation, expected_translation, atol=2.0e-10)
    wheel_center = np.asarray(points["wheel_center"])
    for point_id in ("uca_outboard", "lca_outboard", "tie_rod_outboard"):
        expected = (
            wheel_center
            + expected_translation
            + reference_rotation @ (np.asarray(points[point_id]) - wheel_center)
        )
        assert np.allclose(state.pose.hardpoints[point_id], expected, atol=2.0e-10)
    expected_axis = reference_rotation @ np.asarray([0.0, 1.0, 0.0])
    expected_camber = atan2(
        -float(expected_axis[2]), float(np.hypot(expected_axis[0], expected_axis[1]))
    )
    expected_toe = atan2(float(expected_axis[0]), float(expected_axis[1]))
    assert isclose(state.metrics.camber_rad, expected_camber, abs_tol=2.0e-11)
    assert isclose(state.metrics.toe_rad, expected_toe, abs_tol=2.0e-11)


def test_gradient_step_size_convergence_is_second_order_at_static() -> None:
    results = {
        steps: solve_sweep(demo_points(), -0.05, 0.05, steps, 0.2286)
        for steps in (21, 41, 81, 161)
    }

    def static_gradients(steps: int) -> tuple[float, float]:
        state = min(results[steps].states, key=lambda item: abs(item.travel_m))
        assert state.metrics is not None
        assert state.metrics.camber_gain_rad_per_m is not None
        assert state.metrics.bump_steer_gradient_rad_per_m is not None
        return state.metrics.camber_gain_rad_per_m, state.metrics.bump_steer_gradient_rad_per_m

    reference = np.asarray(static_gradients(161))
    errors = {
        steps: np.abs(np.asarray(static_gradients(steps)) - reference)
        for steps in (21, 41, 81)
    }
    assert np.all(errors[41] < errors[21])
    assert np.all(errors[81] < errors[41])
    assert np.all(errors[41] / errors[81] > 3.5)


def test_small_hardpoint_uncertainty_does_not_create_discontinuous_branches() -> None:
    rng = np.random.default_rng(230717034)
    points = demo_points()
    for _ in range(12):
        perturbed = {
            point_id: tuple(np.asarray(value) + rng.uniform(-0.0002, 0.0002, 3))
            for point_id, value in points.items()
        }
        result = solve_sweep(perturbed, -0.03, 0.03, 13, 0.2286)
        assert result.all_converged
        assert result.calculation_status == "VERIFIED_NUMERICALLY"
        assert all("CONTINUITY_REJECTED" not in state.warnings for state in result.states)


@pytest.mark.parametrize(
    "overrides",
    [
        {
            "uca_front_inboard": (0.16, 0.28, 0.48),
            "uca_rear_inboard": (-0.18, 0.29, 0.47),
            "uca_outboard": (0.015, 0.63, 0.39),
            "lca_front_inboard": (0.24, 0.26, 0.18),
            "lca_rear_inboard": (-0.21, 0.25, 0.17),
            "lca_outboard": (-0.005, 0.69, 0.16),
            "tie_rod_inboard": (-0.14, 0.28, 0.24),
            "tie_rod_outboard": (-0.10, 0.68, 0.255),
        },
        {
            "uca_front_inboard": (0.20, 0.34, 0.44),
            "uca_rear_inboard": (-0.14, 0.33, 0.43),
            "uca_outboard": (0.0, 0.65, 0.405),
            "lca_front_inboard": (0.20, 0.29, 0.20),
            "lca_rear_inboard": (-0.22, 0.28, 0.19),
            "lca_outboard": (0.005, 0.675, 0.165),
            "tie_rod_inboard": (-0.10, 0.31, 0.27),
            "tie_rod_outboard": (-0.07, 0.665, 0.265),
        },
    ],
)
def test_multiple_plausible_unequal_length_geometries_converge_without_branch_switching(
    overrides: dict[str, tuple[float, float, float]],
) -> None:
    points = demo_points()
    points.update(overrides)
    result = solve_sweep(points, -0.04, 0.04, 17, 0.2286)
    assert result.all_converged
    assert all(state.diagnostics.continuity_accepted for state in result.states)
    assert max(
        state.diagnostics.jacobian_condition or float("inf") for state in result.states
    ) < 20.0


def test_dimensionless_metrics_are_invariant_under_geometric_similarity() -> None:
    scale = 1.7
    original = solve_pose(demo_points(), 0.02, 0.2286)[0]
    scaled_points = {
        point_id: tuple(scale * np.asarray(value)) for point_id, value in demo_points().items()
    }
    scaled = solve_pose(
        scaled_points,
        scale * 0.02,
        scale * 0.2286,
        settings=SolverSettings(
            residual_tolerance_m=scale * 1.0e-8,
            continuity_position_limit_m=scale * 0.03,
            max_travel_step_m=scale * 0.025,
        ),
    )[0]
    assert original.metrics is not None
    assert scaled.metrics is not None
    for field in ("camber_rad", "toe_rad", "caster_rad", "kpi_rad"):
        assert isclose(
            getattr(original.metrics, field), getattr(scaled.metrics, field), abs_tol=2.0e-10
        )
    assert isclose(
        scaled.metrics.track_change_m,
        scale * original.metrics.track_change_m,
        abs_tol=2.0e-10,
    )


def test_singular_constraint_system_is_rejected_even_at_zero_residual() -> None:
    points = demo_points()
    points["tie_rod_inboard"] = points["uca_front_inboard"]
    points["tie_rod_outboard"] = points["uca_outboard"]
    state, parameters = solve_pose(points, 0.0, 0.2286)
    assert state.diagnostics.residuals_accepted
    assert not state.diagnostics.jacobian_accepted
    assert not state.diagnostics.converged
    assert parameters is None


def test_optimizer_failure_still_reports_independently_evaluated_residuals() -> None:
    state, _ = solve_pose(
        demo_points(),
        0.04,
        0.2286,
        settings=SolverSettings(max_function_evaluations=1),
    )
    assert not state.diagnostics.optimizer_success
    assert state.diagnostics.max_abs_residual_m is not None
    assert state.diagnostics.residual_norm_m is not None
    assert not state.diagnostics.converged


def test_coarse_sweep_steps_are_rejected_before_continuation() -> None:
    with pytest.raises(ValueError, match="verified maximum"):
        solve_sweep(demo_points(), -0.05, 0.05, 3, 0.2286)


def test_continuity_rejection_clears_pose_metrics_and_aborts_branch() -> None:
    result = solve_sweep(
        demo_points(),
        0.0,
        0.02,
        5,
        0.2286,
        settings=SolverSettings(continuity_position_limit_m=1.0e-6),
    )
    rejected = result.states[1]
    assert rejected.calculation_status == "FAILED"
    assert rejected.pose is None
    assert rejected.metrics is None
    assert not rejected.diagnostics.continuity_accepted
    assert "CONTINUITY_REJECTED" in rejected.warnings
    assert all(state.calculation_status == "FAILED" for state in result.states[1:])


def test_gradients_never_bridge_a_failed_sweep_point() -> None:
    accepted_diagnostics = SolverDiagnostics(
        True, True, True, True, True, 0.0, 0.0, 6, 1.0, 1, "accepted"
    )
    failed_diagnostics = SolverDiagnostics(
        False, False, False, False, False, None, None, 0, None, 0, "failed"
    )

    def metrics(camber: float, toe: float) -> KinematicMetrics:
        return KinematicMetrics(
            camber, camber, None, toe, toe, None, 0.0, 0.0, 0.0, None, None, None
        )

    states = [
        KinematicState(0.00, "VERIFIED_NUMERICALLY", None, metrics(0.0, 0.0), accepted_diagnostics),
        KinematicState(0.01, "FAILED", None, None, failed_diagnostics),
        KinematicState(
            0.02, "VERIFIED_NUMERICALLY", None, metrics(10.0, 1.0), accepted_diagnostics
        ),
        KinematicState(
            0.03, "VERIFIED_NUMERICALLY", None, metrics(10.1, 1.2), accepted_diagnostics
        ),
    ]
    _apply_gradients(states)
    assert states[0].metrics is not None
    assert states[0].metrics.camber_gain_rad_per_m is None
    assert states[2].metrics is not None
    assert states[3].metrics is not None
    assert isclose(states[2].metrics.camber_gain_rad_per_m, 10.0, abs_tol=1.0e-12)
    assert isclose(states[3].metrics.camber_gain_rad_per_m, 10.0, abs_tol=1.0e-12)
    assert "GRADIENT_ADJACENT_TO_FAILED_STATE" in states[2].warnings
