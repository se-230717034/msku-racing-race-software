from math import isclose

import numpy as np
from msku_engineering.kinematics import CONSTRAINED_LINKS, solve_pose, solve_sweep


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


def test_impossible_travel_fails_visibly() -> None:
    state, parameters = solve_pose(demo_points(), 1.0, 0.2286)
    assert not state.diagnostics.converged
    assert state.pose is None
    assert parameters is None
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
