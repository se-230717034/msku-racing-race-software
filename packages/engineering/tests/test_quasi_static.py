from __future__ import annotations

from math import isclose

import pytest
from msku_engineering import (
    EquilibriumSettings,
    ExternalWrench,
    TwoForceMember,
    VehicleLoadTransferInput,
    calculate_actuation_series,
    calculate_damper_force,
    calculate_vehicle_load_transfer,
    solve_upright_equilibrium,
)


def member(
    member_id: str,
    upright: tuple[float, float, float],
    direction: tuple[float, float, float],
    scale: float = 1.0,
) -> TwoForceMember:
    return TwoForceMember(
        id=member_id,
        chassis_point_m=tuple(
            scale * (value + delta) for value, delta in zip(upright, direction, strict=True)
        ),
        upright_point_m=tuple(scale * value for value in upright),
    )


def six_member_basis(scale: float = 1.0) -> tuple[TwoForceMember, ...]:
    # These columns form an independently constructed wrench basis:
    # Fx, Fy, Fz, Fz+Mx, Fx+My, Fy+Mz.
    return (
        member("fx", (0.0, 0.0, 0.0), (1.0, 0.0, 0.0), scale),
        member("fy", (0.0, 0.0, 0.0), (0.0, 1.0, 0.0), scale),
        member("fz", (0.0, 0.0, 0.0), (0.0, 0.0, 1.0), scale),
        member("mx", (0.0, 1.0, 0.0), (0.0, 0.0, 1.0), scale),
        member("my", (0.0, 0.0, 1.0), (1.0, 0.0, 0.0), scale),
        member("mz", (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), scale),
    )


def test_three_orthogonal_members_balance_force_at_reference() -> None:
    members = six_member_basis()[:3]
    result = solve_upright_equilibrium(
        members,
        ExternalWrench((-10.0, 20.0, -30.0), (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        (0.0, 0.0, 0.0),
    )

    assert result.calculation_status == "VERIFIED_NUMERICALLY"
    assert [item.axial_force_n for item in result.member_forces] == pytest.approx(
        [10.0, -20.0, 30.0], abs=1.0e-12
    )
    assert [item.state for item in result.member_forces] == [
        "TENSION",
        "COMPRESSION",
        "TENSION",
    ]
    assert result.diagnostics.force_residual_norm_n < 1.0e-12
    assert result.diagnostics.moment_residual_norm_nm < 1.0e-12


def test_six_member_analytical_wrench_basis() -> None:
    # For q=[10,20,30,40,50,60], direct hand summation gives
    # member resultant F=[60,80,70] N and M=[40,50,60] N*m.
    result = solve_upright_equilibrium(
        six_member_basis(),
        ExternalWrench(
            (-60.0, -80.0, -70.0),
            (-40.0, -50.0, -60.0),
            (0.0, 0.0, 0.0),
        ),
        (0.0, 0.0, 0.0),
    )

    assert result.calculation_status == "VERIFIED_NUMERICALLY"
    assert [item.axial_force_n for item in result.member_forces] == pytest.approx(
        [10.0, 20.0, 30.0, 40.0, 50.0, 60.0], abs=1.0e-10
    )
    assert result.diagnostics.matrix_rank == 6
    assert result.diagnostics.force_residual_norm_n < 1.0e-10
    assert result.diagnostics.moment_residual_norm_nm < 1.0e-10


def test_geometry_scaling_preserves_force_solution_when_moment_scales() -> None:
    base = solve_upright_equilibrium(
        six_member_basis(),
        ExternalWrench((-60.0, -80.0, -70.0), (-40.0, -50.0, -60.0), (0.0, 0.0, 0.0)),
        (0.0, 0.0, 0.0),
    )
    scaled = solve_upright_equilibrium(
        six_member_basis(scale=0.25),
        ExternalWrench((-60.0, -80.0, -70.0), (-10.0, -12.5, -15.0), (0.0, 0.0, 0.0)),
        (0.0, 0.0, 0.0),
    )

    assert [item.axial_force_n for item in scaled.member_forces] == pytest.approx(
        [item.axial_force_n for item in base.member_forces], abs=1.0e-9
    )


def test_incompatible_moment_is_not_presented_as_valid() -> None:
    result = solve_upright_equilibrium(
        six_member_basis()[:3],
        ExternalWrench((0.0, 0.0, 0.0), (12.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        (0.0, 0.0, 0.0),
    )

    assert result.calculation_status == "NOT_COMPUTABLE"
    assert result.member_forces == ()
    assert result.diagnostics.moment_residual_norm_nm == pytest.approx(12.0)
    assert "INCONSISTENT_EXTERNAL_WRENCH" in result.warnings


def test_dependent_member_directions_are_rejected() -> None:
    result = solve_upright_equilibrium(
        (
            member("first", (0.0, 0.0, 0.0), (1.0, 0.0, 0.0)),
            member("duplicate", (0.0, 0.0, 0.0), (1.0, 0.0, 0.0)),
        ),
        ExternalWrench((-10.0, 0.0, 0.0), (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        (0.0, 0.0, 0.0),
    )

    assert result.calculation_status == "FAILED"
    assert result.member_forces == ()
    assert result.diagnostics.matrix_rank == 1
    assert "SINGULAR_OR_UNDERDETERMINED_FORCE_PATH" in result.warnings


def test_residual_acceptance_uses_configured_physical_tolerances() -> None:
    result = solve_upright_equilibrium(
        six_member_basis()[:3],
        ExternalWrench((0.0, 0.0, 0.0), (1.0e-4, 0.0, 0.0), (0.0, 0.0, 0.0)),
        (0.0, 0.0, 0.0),
        EquilibriumSettings(moment_tolerance_nm=1.0e-6),
    )
    assert result.calculation_status == "NOT_COMPUTABLE"


def test_more_than_six_member_unknowns_require_a_stiffness_model() -> None:
    result = solve_upright_equilibrium(
        (*six_member_basis(), member("seventh", (1.0, 1.0, 0.0), (0.0, 0.0, 1.0))),
        ExternalWrench((0.0, 0.0, 0.0), (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        (0.0, 0.0, 0.0),
    )
    assert result.calculation_status == "NOT_COMPUTABLE"
    assert "STATICALLY_INDETERMINATE_REQUIRES_STIFFNESS_MODEL" in result.warnings


def test_small_geometry_perturbation_remains_continuous() -> None:
    baseline_members = six_member_basis()
    perturbed_members = list(baseline_members)
    perturbed_members[3] = member("mx", (0.0, 1.0 + 1.0e-6, 0.0), (0.0, 0.0, 1.0))
    wrench = ExternalWrench((-60.0, -80.0, -70.0), (-40.0, -50.0, -60.0), (0.0, 0.0, 0.0))
    baseline = solve_upright_equilibrium(baseline_members, wrench, (0.0, 0.0, 0.0))
    perturbed = solve_upright_equilibrium(perturbed_members, wrench, (0.0, 0.0, 0.0))

    assert perturbed.calculation_status == "VERIFIED_NUMERICALLY"
    change = max(
        abs(first.axial_force_n - second.axial_force_n)
        for first, second in zip(baseline.member_forces, perturbed.member_forces, strict=True)
    )
    assert change < 1.0e-3


def test_static_and_longitudinal_load_transfer_reference_case() -> None:
    result = calculate_vehicle_load_transfer(
        VehicleLoadTransferInput(
            mass_kg=300.0,
            wheelbase_m=2.0,
            cg_from_front_axle_m=0.8,
            cg_height_m=0.3,
            front_track_m=1.2,
            rear_track_m=1.2,
            longitudinal_acceleration_mps2=2.0,
        )
    )

    weight = 300.0 * 9.80665
    assert result.calculation_status == "VERIFIED_NUMERICALLY"
    assert result.longitudinal_transfer_n == pytest.approx(90.0)
    assert result.axle_loads is not None
    assert result.axle_loads.front_n == pytest.approx(weight * 0.6 - 90.0)
    assert result.axle_loads.rear_n == pytest.approx(weight * 0.4 + 90.0)
    assert result.wheel_loads is not None
    assert result.wheel_loads.front_left_n == pytest.approx(result.wheel_loads.front_right_n)
    assert result.wheel_loads.rear_left_n == pytest.approx(result.wheel_loads.rear_right_n)
    assert result.force_residual_n == pytest.approx(0.0, abs=1.0e-10)


def test_lateral_transfer_requires_explicit_roll_stiffness_split() -> None:
    result = calculate_vehicle_load_transfer(
        VehicleLoadTransferInput(300.0, 2.0, 1.0, 0.3, 1.2, 1.2, lateral_acceleration_mps2=5.0)
    )
    assert result.calculation_status == "NOT_COMPUTABLE"
    assert result.axle_loads is not None
    assert result.wheel_loads is None


def test_lateral_transfer_reference_and_mirror_sign() -> None:
    common = dict(
        mass_kg=300.0,
        wheelbase_m=2.0,
        cg_from_front_axle_m=1.0,
        cg_height_m=0.4,
        front_track_m=1.2,
        rear_track_m=1.2,
        front_roll_stiffness_nm_per_rad=30_000.0,
        rear_roll_stiffness_nm_per_rad=30_000.0,
    )
    left = calculate_vehicle_load_transfer(
        VehicleLoadTransferInput(**common, lateral_acceleration_mps2=6.0)
    )
    right = calculate_vehicle_load_transfer(
        VehicleLoadTransferInput(**common, lateral_acceleration_mps2=-6.0)
    )

    expected_axle_delta = 0.5 * 300.0 * 6.0 * 0.4 / 1.2
    assert left.front_lateral_transfer_n == pytest.approx(expected_axle_delta)
    assert left.wheel_loads is not None and right.wheel_loads is not None
    assert left.wheel_loads.front_left_n == pytest.approx(right.wheel_loads.front_right_n)
    assert left.wheel_loads.front_right_n == pytest.approx(right.wheel_loads.front_left_n)


def test_negative_wheel_load_is_rejected() -> None:
    result = calculate_vehicle_load_transfer(
        VehicleLoadTransferInput(
            100.0,
            2.0,
            1.0,
            1.0,
            0.5,
            0.5,
            lateral_acceleration_mps2=20.0,
            front_roll_stiffness_nm_per_rad=1.0,
            rear_roll_stiffness_nm_per_rad=1.0,
        )
    )
    assert result.calculation_status == "FAILED"
    assert result.wheel_loads is None
    assert "NONPHYSICAL_NEGATIVE_WHEEL_LOAD" in result.warnings


def test_linear_motion_ratio_spring_force_rate_and_energy() -> None:
    result = calculate_actuation_series(
        (-0.01, 0.0, 0.01),
        (0.205, 0.2, 0.195),
        reference_spring_length_m=0.2,
        spring_rate_n_per_m=10_000.0,
        preload_n=100.0,
    )

    assert result.calculation_status == "VERIFIED_NUMERICALLY"
    assert [sample.motion_ratio for sample in result.samples] == pytest.approx([0.5] * 3)
    assert [sample.spring_force_n for sample in result.samples] == pytest.approx(
        [50.0, 100.0, 150.0]
    )
    assert [sample.wheel_rate_n_per_m for sample in result.samples] == pytest.approx([2500.0] * 3)
    assert result.samples[1].stored_energy_j == pytest.approx(0.0)
    energy_slope = (result.samples[2].stored_energy_j - result.samples[0].stored_energy_j) / 0.02
    assert energy_slope == pytest.approx(-result.samples[1].wheel_force_n)


def test_linear_motion_ratio_is_exact_on_nonuniform_travel_samples() -> None:
    travel = (-0.02, -0.004, 0.0, 0.013, 0.03)
    lengths = tuple(0.2 - 0.4 * value for value in travel)
    result = calculate_actuation_series(travel, lengths, 0.2, 12_000.0, 200.0)
    assert result.calculation_status == "VERIFIED_NUMERICALLY"
    assert [sample.motion_ratio for sample in result.samples] == pytest.approx([0.4] * 5)


def test_damper_requires_explicit_velocity_and_opposes_motion() -> None:
    missing = calculate_damper_force(None, 1000.0, 1500.0)
    compression = calculate_damper_force(0.2, 1000.0, 1500.0)
    rebound = calculate_damper_force(-0.2, 1000.0, 1500.0)

    assert missing.calculation_status == "NOT_COMPUTABLE"
    assert compression.force_n == pytest.approx(-200.0)
    assert rebound.force_n == pytest.approx(300.0)
    assert isclose(abs(compression.force_n or 0.0), 200.0)
