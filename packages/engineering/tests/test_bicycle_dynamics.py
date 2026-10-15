from __future__ import annotations

import numpy as np
import pytest
from msku_engineering import (
    BicycleDomainLimits,
    BicycleParameters,
    DynamicsSettings,
    SteeringProfile,
    bicycle_state_matrices,
    simulate_bicycle,
    steady_state_bicycle_response,
    steering_angle,
)
from scipy.linalg import expm


def parameters(*, speed: float = 12.0, front_stiffness: float = 50_000.0) -> BicycleParameters:
    return BicycleParameters(
        mass_kg=300.0,
        yaw_inertia_kg_m2=120.0,
        cg_to_front_axle_m=0.75,
        cg_to_rear_axle_m=0.75,
        front_cornering_stiffness_n_per_rad=front_stiffness,
        rear_cornering_stiffness_n_per_rad=50_000.0,
        speed_mps=speed,
    )


def settings(*, method: str = "DOP853", duration: float = 2.0) -> DynamicsSettings:
    assert method in ("DOP853", "Radau", "BDF")
    return DynamicsSettings(
        duration_s=duration,
        output_samples=401,
        relative_tolerance=1.0e-10,
        absolute_tolerance=1.0e-12,
        maximum_step_s=0.002,
        method=method,  # type: ignore[arg-type]
    )


def test_state_matrix_matches_independent_newton_euler_coefficients() -> None:
    model = parameters()
    matrix, input_vector = bicycle_state_matrices(model)
    m, inertia = model.mass_kg, model.yaw_inertia_kg_m2
    a, b, speed = model.cg_to_front_axle_m, model.cg_to_rear_axle_m, model.speed_mps
    cf = model.front_cornering_stiffness_n_per_rad
    cr = model.rear_cornering_stiffness_n_per_rad
    expected = np.asarray(
        [
            [-(cf + cr) / (m * speed), (-a * cf + b * cr) / (m * speed) - speed],
            [
                (-a * cf + b * cr) / (inertia * speed),
                -(a * a * cf + b * b * cr) / (inertia * speed),
            ],
        ]
    )
    assert matrix == pytest.approx(expected, abs=1.0e-14)
    assert input_vector == pytest.approx([cf / m, a * cf / inertia], abs=1.0e-14)


def test_neutral_steer_step_converges_to_independent_steady_state_formula() -> None:
    model = parameters()
    steer = 0.01
    yaw_gain, sideslip_gain = steady_state_bicycle_response(model)
    result = simulate_bicycle(
        model,
        SteeringProfile(kind="step", amplitude_rad=steer, start_time_s=0.0),
        settings=settings(duration=3.0),
    )
    final = result.samples[-1]
    assert result.calculation_status == "VERIFIED_NUMERICALLY"
    assert final.yaw_rate_radps == pytest.approx(yaw_gain * steer, rel=1.0e-8)
    assert final.sideslip_rad == pytest.approx(sideslip_gain * steer, abs=1.0e-10)
    assert yaw_gain == pytest.approx(model.speed_mps / 1.5)


def test_transient_step_matches_independent_matrix_exponential() -> None:
    model = parameters(front_stiffness=42_000.0)
    steer = 0.008
    matrix, input_vector = bicycle_state_matrices(model)
    result = simulate_bicycle(
        model,
        SteeringProfile(kind="step", amplitude_rad=steer),
        settings=settings(duration=0.8),
    )
    inverse = np.linalg.inv(matrix)
    errors = []
    for sample in result.samples:
        expected = inverse @ (expm(matrix * sample.time_s) - np.eye(2)) @ input_vector * steer
        actual = np.asarray([sample.lateral_velocity_mps, sample.yaw_rate_radps])
        errors.append(float(np.max(np.abs(actual - expected))))
    assert max(errors) < 2.0e-10


def test_positive_left_steer_produces_positive_force_yaw_and_lateral_acceleration() -> None:
    result = simulate_bicycle(
        parameters(),
        SteeringProfile(kind="smooth_step", amplitude_rad=0.01, rise_time_s=0.1),
        settings=settings(duration=0.5),
    )
    active = result.samples[30]
    assert active.steering_rad > 0.0
    assert active.front_lateral_force_n > 0.0
    assert active.yaw_rate_radps > 0.0
    assert active.lateral_acceleration_mps2 > 0.0


def test_radau_and_bdf_agree_with_dop853() -> None:
    model = parameters(front_stiffness=45_000.0)
    profile = SteeringProfile(kind="sine", amplitude_rad=0.008, frequency_hz=1.5)
    results = [
        simulate_bicycle(model, profile, settings=settings(method=method))
        for method in ("DOP853", "Radau", "BDF")
    ]
    reference = results[0]
    assert all(result.calculation_status == "VERIFIED_NUMERICALLY" for result in results)
    for result in results[1:]:
        error = max(
            abs(actual.yaw_rate_radps - expected.yaw_rate_radps)
            for actual, expected in zip(result.samples, reference.samples, strict=True)
        )
        assert error < 2.0e-8


def test_oversteer_high_speed_reports_unstable_without_claiming_physical_validation() -> None:
    model = BicycleParameters(
        mass_kg=300.0,
        yaw_inertia_kg_m2=120.0,
        cg_to_front_axle_m=0.8,
        cg_to_rear_axle_m=0.7,
        front_cornering_stiffness_n_per_rad=80_000.0,
        rear_cornering_stiffness_n_per_rad=25_000.0,
        speed_mps=40.0,
    )
    result = simulate_bicycle(
        model,
        SteeringProfile(kind="sine", amplitude_rad=0.0),
        settings=settings(duration=0.2),
    )
    assert result.calculation_status == "VERIFIED_NUMERICALLY"
    assert result.diagnostics.stable is False
    assert result.diagnostics.critical_speed_mps is not None
    assert "OPEN_LOOP_LINEAR_MODEL_UNSTABLE_AT_REQUESTED_SPEED" in result.warnings
    assert result.physical_status == "UNVALIDATED_PHYSICALLY"


def test_linear_domain_violation_and_invalid_speed_suppress_samples() -> None:
    violated = simulate_bicycle(
        parameters(),
        SteeringProfile(kind="step", amplitude_rad=0.2),
        limits=BicycleDomainLimits(
            maximum_abs_steering_rad=0.1,
            maximum_abs_sideslip_rad=0.1,
            maximum_abs_tire_slip_rad=0.1,
        ),
        settings=settings(duration=0.2),
    )
    assert violated.calculation_status == "FAILED"
    assert violated.samples == ()
    assert violated.diagnostics.domain_accepted is False

    invalid = simulate_bicycle(
        parameters(speed=0.1),
        SteeringProfile(kind="step", amplitude_rad=0.01),
        settings=settings(duration=0.2),
    )
    assert invalid.calculation_status == "FAILED"
    assert invalid.samples == ()


def test_sampled_steering_interpolation_and_order_validation() -> None:
    profile = SteeringProfile(
        kind="sampled",
        sample_times_s=(0.0, 0.2, 0.5),
        sample_angles_rad=(0.0, 0.02, -0.01),
    )
    assert steering_angle(profile, 0.1) == pytest.approx(0.01)
    assert steering_angle(profile, 0.35) == pytest.approx(0.005)
    assert steering_angle(profile, 1.0) == -0.01
    invalid = simulate_bicycle(
        parameters(),
        SteeringProfile(
            kind="sampled",
            sample_times_s=(0.0, 0.2, 0.1),
            sample_angles_rad=(0.0, 0.01, 0.0),
        ),
        settings=settings(),
    )
    assert invalid.calculation_status == "FAILED"
