from __future__ import annotations

from math import cos, pi

import numpy as np
import pytest
from msku_engineering import (
    DynamicsSettings,
    FullCarCornerParameters,
    FullCarInitialState,
    FullCarParameters,
    FullCarRoadInputs,
    QuarterCarParameters,
    RoadProfile,
    assemble_full_car_matrices,
    full_car_natural_frequencies,
    simulate_full_car,
    simulate_quarter_car,
)
from scipy.linalg import eigh


def settings(*, method: str = "DOP853", max_step: float = 0.002) -> DynamicsSettings:
    assert method in ("DOP853", "Radau", "BDF")
    return DynamicsSettings(
        duration_s=1.0,
        output_samples=201,
        relative_tolerance=1.0e-10,
        absolute_tolerance=1.0e-12,
        maximum_step_s=max_step,
        method=method,  # type: ignore[arg-type]
    )


def symmetric_parameters(*, static_load: float | None = None) -> FullCarParameters:
    positions = ((0.8, 0.6), (0.8, -0.6), (-0.8, 0.6), (-0.8, -0.6))
    return FullCarParameters(
        sprung_mass_kg=240.0,
        pitch_inertia_kg_m2=125.0,
        roll_inertia_kg_m2=80.0,
        corners=tuple(
            FullCarCornerParameters(
                x_position_m=x,
                y_position_m=y,
                unsprung_mass_kg=12.0,
                suspension_stiffness_n_per_m=30_000.0,
                suspension_damping_ns_per_m=1_500.0,
                tire_stiffness_n_per_m=180_000.0,
                tire_damping_ns_per_m=0.0,
                static_tire_load_n=static_load,
            )
            for x, y in positions
        ),
    )


def zero_roads() -> FullCarRoadInputs:
    return FullCarRoadInputs(
        profiles=tuple(
            RoadProfile(kind="sine", amplitude_m=0.0, frequency_hz=1.0) for _ in range(4)
        )
    )


def independently_assemble(
    model: FullCarParameters,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    mass = np.diag(
        [
            model.sprung_mass_kg,
            model.pitch_inertia_kg_m2,
            model.roll_inertia_kg_m2,
            *(corner.unsprung_mass_kg for corner in model.corners),
        ]
    )
    damping = np.zeros((7, 7))
    stiffness = np.zeros((7, 7))
    for index, corner in enumerate(model.corners):
        vector = np.zeros(7)
        vector[0] = 1.0
        vector[1] = -corner.x_position_m
        vector[2] = corner.y_position_m
        vector[index + 3] = -1.0
        damping += corner.suspension_damping_ns_per_m * vector[:, None] * vector[None, :]
        stiffness += corner.suspension_stiffness_n_per_m * vector[:, None] * vector[None, :]
        damping[index + 3, index + 3] += corner.tire_damping_ns_per_m
        stiffness[index + 3, index + 3] += corner.tire_stiffness_n_per_m
    return mass, damping, stiffness


def test_matrices_match_independent_energy_assembly_and_are_symmetric_positive() -> None:
    model = symmetric_parameters()
    actual = assemble_full_car_matrices(model)
    expected = independently_assemble(model)
    for actual_matrix, expected_matrix in zip(actual, expected, strict=True):
        assert actual_matrix == pytest.approx(expected_matrix, abs=2.0e-11)
        assert actual_matrix == pytest.approx(actual_matrix.T, abs=1.0e-12)
    eigenvalues = np.linalg.eigvalsh(actual[2])
    assert np.min(eigenvalues) > 0.0


def test_natural_frequencies_match_independent_generalized_eigenproblem() -> None:
    model = symmetric_parameters()
    mass, _, stiffness = independently_assemble(model)
    expected = np.sqrt(eigh(stiffness, mass, eigvals_only=True)) / (2.0 * pi)
    assert full_car_natural_frequencies(model) == pytest.approx(expected, rel=1.0e-13)


def test_undamped_full_car_mode_matches_exact_cosine() -> None:
    damped = symmetric_parameters()
    model = FullCarParameters(
        sprung_mass_kg=damped.sprung_mass_kg,
        pitch_inertia_kg_m2=damped.pitch_inertia_kg_m2,
        roll_inertia_kg_m2=damped.roll_inertia_kg_m2,
        corners=tuple(
            FullCarCornerParameters(
                **{
                    **corner.__dict__,
                    "suspension_damping_ns_per_m": 0.0,
                    "tire_damping_ns_per_m": 0.0,
                }
            )
            for corner in damped.corners
        ),
    )
    mass, _, stiffness = independently_assemble(model)
    eigenvalues, eigenvectors = eigh(stiffness, mass)
    mode_index = 2
    omega = float(np.sqrt(eigenvalues[mode_index]))
    shape = eigenvectors[:, mode_index]
    shape *= 0.001 / float(np.max(np.abs(shape)))
    result = simulate_full_car(
        model,
        zero_roads(),
        FullCarInitialState(
            body_heave_m=float(shape[0]),
            pitch_rad=float(shape[1]),
            roll_rad=float(shape[2]),
            unsprung_displacements_m=tuple(float(value) for value in shape[3:]),
        ),
        settings(),
    )
    assert result.calculation_status == "VERIFIED_NUMERICALLY"
    errors = []
    for sample in result.samples:
        actual = np.asarray(
            [
                sample.body_heave_m,
                sample.pitch_rad,
                sample.roll_rad,
                *sample.unsprung_displacements_m,
            ]
        )
        errors.append(float(np.max(np.abs(actual - shape * cos(omega * sample.time_s)))))
    assert max(errors) < 2.0e-11
    assert result.diagnostics.relative_energy_balance_error is not None
    assert result.diagnostics.relative_energy_balance_error < 1.0e-9


def test_symmetric_full_car_heave_matches_independent_quarter_car_reduction() -> None:
    model = symmetric_parameters()
    road = RoadProfile(kind="smooth_bump", amplitude_m=0.01, start_time_s=0.1, duration_s=0.15)
    full = simulate_full_car(
        model,
        FullCarRoadInputs(profiles=(road, road, road, road)),
        settings=settings(max_step=0.001),
    )
    corner = model.corners[0]
    quarter = simulate_quarter_car(
        QuarterCarParameters(
            sprung_mass_kg=model.sprung_mass_kg / 4.0,
            unsprung_mass_kg=corner.unsprung_mass_kg,
            suspension_stiffness_n_per_m=corner.suspension_stiffness_n_per_m,
            suspension_damping_ns_per_m=corner.suspension_damping_ns_per_m,
            tire_stiffness_n_per_m=corner.tire_stiffness_n_per_m,
            tire_damping_ns_per_m=corner.tire_damping_ns_per_m,
        ),
        road,
        settings=settings(max_step=0.001),
    )
    assert full.calculation_status == quarter.calculation_status == "VERIFIED_NUMERICALLY"
    heave_error = max(
        abs(full_sample.body_heave_m - quarter_sample.sprung_displacement_m)
        for full_sample, quarter_sample in zip(full.samples, quarter.samples, strict=True)
    )
    wheel_error = max(
        abs(full_sample.unsprung_displacements_m[0] - quarter_sample.unsprung_displacement_m)
        for full_sample, quarter_sample in zip(full.samples, quarter.samples, strict=True)
    )
    assert heave_error < 2.0e-11
    assert wheel_error < 2.0e-11
    assert max(abs(sample.pitch_rad) for sample in full.samples) < 1.0e-13
    assert max(abs(sample.roll_rad) for sample in full.samples) < 1.0e-13


def test_front_and_left_inputs_follow_declared_pitch_and_roll_signs() -> None:
    model = symmetric_parameters()
    bump = RoadProfile(kind="smooth_bump", amplitude_m=0.01, start_time_s=0.05, duration_s=0.12)
    zero = RoadProfile(kind="sine", amplitude_m=0.0, frequency_hz=1.0)
    front = simulate_full_car(
        model, FullCarRoadInputs(profiles=(bump, bump, zero, zero)), settings=settings()
    )
    left = simulate_full_car(
        model, FullCarRoadInputs(profiles=(bump, zero, bump, zero)), settings=settings()
    )
    assert min(sample.pitch_rad for sample in front.samples) < -1.0e-5
    assert max(abs(sample.roll_rad) for sample in front.samples) < 1.0e-12
    assert max(sample.roll_rad for sample in left.samples) > 1.0e-5
    assert max(abs(sample.pitch_rad) for sample in left.samples) < 1.0e-12


def test_radau_and_dop853_agree_on_asymmetric_four_road_case() -> None:
    model = symmetric_parameters()
    roads = FullCarRoadInputs(
        profiles=(
            RoadProfile(kind="smooth_bump", amplitude_m=0.010, start_time_s=0.10, duration_s=0.12),
            RoadProfile(kind="smooth_bump", amplitude_m=0.006, start_time_s=0.13, duration_s=0.10),
            RoadProfile(kind="half_sine", amplitude_m=-0.004, start_time_s=0.18, duration_s=0.15),
            RoadProfile(kind="sine", amplitude_m=0.002, start_time_s=0.2, frequency_hz=3.0),
        )
    )
    explicit = simulate_full_car(model, roads, settings=settings(method="DOP853", max_step=0.001))
    implicit = simulate_full_car(model, roads, settings=settings(method="Radau", max_step=0.001))
    assert explicit.calculation_status == implicit.calculation_status == "VERIFIED_NUMERICALLY"
    error = max(
        abs(first.body_heave_m - second.body_heave_m)
        for first, second in zip(explicit.samples, implicit.samples, strict=True)
    )
    assert error < 2.0e-9


def test_contact_loss_and_invalid_corner_order_suppress_results() -> None:
    contact_model = symmetric_parameters(static_load=50.0)
    result = simulate_full_car(
        contact_model,
        zero_roads(),
        FullCarInitialState(unsprung_displacements_m=(0.01, 0.0, 0.0, 0.0)),
        settings(),
    )
    assert result.calculation_status == "FAILED"
    assert result.samples == ()
    assert result.diagnostics.contact_accepted is False
    assert result.diagnostics.contact_loss_corner == "front_left"

    corners = list(symmetric_parameters().corners)
    corners[0] = FullCarCornerParameters(**{**corners[0].__dict__, "y_position_m": -0.6})
    invalid = simulate_full_car(
        FullCarParameters(240.0, 125.0, 80.0, tuple(corners)), zero_roads(), settings=settings()
    )
    assert invalid.calculation_status == "FAILED"
    assert invalid.samples == ()
