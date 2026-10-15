from __future__ import annotations

from math import cos, exp, pi, sin, sqrt

import numpy as np
import pytest
from msku_engineering import (
    DynamicsSettings,
    QuarterCarInitialState,
    QuarterCarParameters,
    RoadProfile,
    quarter_car_natural_frequencies,
    road_state,
    simulate_quarter_car,
)


def parameters(
    *,
    suspension_damping: float = 1500.0,
    tire_damping: float = 0.0,
    static_load: float | None = None,
) -> QuarterCarParameters:
    return QuarterCarParameters(
        sprung_mass_kg=250.0,
        unsprung_mass_kg=40.0,
        suspension_stiffness_n_per_m=20_000.0,
        suspension_damping_ns_per_m=suspension_damping,
        tire_stiffness_n_per_m=200_000.0,
        tire_damping_ns_per_m=tire_damping,
        static_tire_load_n=static_load,
    )


def zero_road() -> RoadProfile:
    return RoadProfile(kind="sine", amplitude_m=0.0, frequency_hz=1.0)


def settings(
    *,
    duration: float = 2.0,
    samples: int = 401,
    max_step: float = 0.002,
    method: str = "DOP853",
) -> DynamicsSettings:
    assert method in ("DOP853", "Radau", "BDF")
    return DynamicsSettings(
        duration_s=duration,
        output_samples=samples,
        relative_tolerance=1.0e-10,
        absolute_tolerance=1.0e-12,
        maximum_step_s=max_step,
        method=method,  # type: ignore[arg-type]
    )


def mode_shape(model: QuarterCarParameters, omega: float) -> tuple[float, float]:
    unsprung = 1.0
    sprung = model.suspension_stiffness_n_per_m / (
        model.suspension_stiffness_n_per_m - model.sprung_mass_kg * omega**2
    )
    return sprung, unsprung


def test_closed_form_natural_frequencies() -> None:
    model = parameters()
    actual = quarter_car_natural_frequencies(model)
    coefficient = (
        model.suspension_stiffness_n_per_m * model.unsprung_mass_kg
        + model.sprung_mass_kg * (model.suspension_stiffness_n_per_m + model.tire_stiffness_n_per_m)
    )
    product = (
        model.sprung_mass_kg
        * model.unsprung_mass_kg
        * model.suspension_stiffness_n_per_m
        * model.tire_stiffness_n_per_m
    )
    roots = (
        (coefficient - sqrt(coefficient**2 - 4.0 * product))
        / (2.0 * model.sprung_mass_kg * model.unsprung_mass_kg),
        (coefficient + sqrt(coefficient**2 - 4.0 * product))
        / (2.0 * model.sprung_mass_kg * model.unsprung_mass_kg),
    )
    expected = tuple(sqrt(value) / (2.0 * pi) for value in roots)
    assert actual == pytest.approx(expected, rel=1.0e-14)


def test_undamped_mode_matches_independent_cosine_solution() -> None:
    model = parameters(suspension_damping=0.0)
    frequency = quarter_car_natural_frequencies(model)[0]
    omega = 2.0 * pi * frequency
    sprung_shape, unsprung_shape = mode_shape(model, omega)
    amplitude = 0.001
    result = simulate_quarter_car(
        model,
        zero_road(),
        QuarterCarInitialState(
            sprung_displacement_m=amplitude * sprung_shape,
            unsprung_displacement_m=amplitude * unsprung_shape,
        ),
        settings(duration=2.0 / frequency, samples=501, max_step=0.001),
    )

    assert result.calculation_status == "VERIFIED_NUMERICALLY"
    sprung_error = max(
        abs(sample.sprung_displacement_m - amplitude * sprung_shape * cos(omega * sample.time_s))
        for sample in result.samples
    )
    unsprung_error = max(
        abs(
            sample.unsprung_displacement_m
            - amplitude * unsprung_shape * cos(omega * sample.time_s)
        )
        for sample in result.samples
    )
    assert sprung_error < 2.0e-12
    assert unsprung_error < 2.0e-12
    assert result.diagnostics.relative_energy_balance_error is not None
    assert result.diagnostics.relative_energy_balance_error < 1.0e-10


def test_proportional_damping_matches_modal_decay() -> None:
    beta_s = 0.02
    base = parameters(suspension_damping=0.0)
    model = QuarterCarParameters(
        sprung_mass_kg=base.sprung_mass_kg,
        unsprung_mass_kg=base.unsprung_mass_kg,
        suspension_stiffness_n_per_m=base.suspension_stiffness_n_per_m,
        suspension_damping_ns_per_m=beta_s * base.suspension_stiffness_n_per_m,
        tire_stiffness_n_per_m=base.tire_stiffness_n_per_m,
        tire_damping_ns_per_m=beta_s * base.tire_stiffness_n_per_m,
    )
    omega = 2.0 * pi * quarter_car_natural_frequencies(model)[0]
    damping_ratio = beta_s * omega / 2.0
    damped_omega = omega * sqrt(1.0 - damping_ratio**2)
    sprung_shape, unsprung_shape = mode_shape(model, omega)
    amplitude = 0.001
    result = simulate_quarter_car(
        model,
        zero_road(),
        QuarterCarInitialState(
            sprung_displacement_m=amplitude * sprung_shape,
            unsprung_displacement_m=amplitude * unsprung_shape,
        ),
        settings(duration=1.0, samples=401, max_step=0.001),
    )

    def modal_response(time_s: float) -> float:
        return (
            amplitude
            * exp(-damping_ratio * omega * time_s)
            * (
                cos(damped_omega * time_s)
                + damping_ratio * omega / damped_omega * sin(damped_omega * time_s)
            )
        )

    error = max(
        abs(sample.sprung_displacement_m - sprung_shape * modal_response(sample.time_s))
        for sample in result.samples
    )
    assert error < 2.0e-11


def test_zero_input_equilibrium_and_implicit_solver() -> None:
    result = simulate_quarter_car(
        parameters(), zero_road(), settings=settings(method="Radau", duration=0.5, samples=51)
    )
    assert result.calculation_status == "VERIFIED_NUMERICALLY"
    assert all(sample.sprung_displacement_m == 0.0 for sample in result.samples)
    assert all(sample.unsprung_displacement_m == 0.0 for sample in result.samples)
    assert all(sample.sprung_acceleration_mps2 == 0.0 for sample in result.samples)
    assert result.diagnostics.accepted_steps > 0
    assert result.diagnostics.minimum_accepted_step_s is not None
    assert result.diagnostics.maximum_accepted_step_s is not None
    assert result.diagnostics.maximum_accepted_step_s <= 0.002 * (1.0 + 1.0e-12)


def test_independent_integrators_agree_on_nontrivial_bump_response() -> None:
    model = parameters(tire_damping=100.0)
    road = RoadProfile(kind="smooth_bump", amplitude_m=0.01, start_time_s=0.1, duration_s=0.12)
    results = [
        simulate_quarter_car(
            model,
            road,
            settings=settings(duration=0.8, samples=161, max_step=0.002, method=method),
        )
        for method in ("DOP853", "Radau", "BDF")
    ]
    assert all(result.calculation_status == "VERIFIED_NUMERICALLY" for result in results)
    reference = results[0]
    for result in results[1:]:
        sprung_error = max(
            abs(actual.sprung_displacement_m - expected.sprung_displacement_m)
            for actual, expected in zip(result.samples, reference.samples, strict=True)
        )
        unsprung_error = max(
            abs(actual.unsprung_displacement_m - expected.unsprung_displacement_m)
            for actual, expected in zip(result.samples, reference.samples, strict=True)
        )
        assert sprung_error < 2.0e-9
        assert unsprung_error < 2.0e-9


def test_damped_unforced_energy_is_monotonic() -> None:
    result = simulate_quarter_car(
        parameters(tire_damping=200.0),
        zero_road(),
        QuarterCarInitialState(sprung_displacement_m=0.01),
        settings(duration=2.0, samples=501),
    )
    energies = np.asarray([sample.mechanical_energy_j for sample in result.samples])
    assert result.calculation_status == "VERIFIED_NUMERICALLY"
    assert float(np.max(np.diff(energies))) < 1.0e-9
    assert energies[-1] < energies[0]


def test_step_settles_to_static_road_height_without_double_counting_gravity() -> None:
    result = simulate_quarter_car(
        parameters(),
        RoadProfile(kind="step", amplitude_m=0.01, start_time_s=0.0),
        settings=settings(duration=8.0, samples=801, max_step=0.005),
    )
    assert result.calculation_status == "VERIFIED_NUMERICALLY"
    assert result.samples[-1].sprung_displacement_m == pytest.approx(0.01, abs=2.0e-6)
    assert result.samples[-1].unsprung_displacement_m == pytest.approx(0.01, abs=2.0e-6)
    assert "STEP_ENERGY_BALANCE_NOT_EVALUATED_DISPLACEMENT_IS_DISCONTINUOUS" in result.warnings


def test_delayed_step_preserves_the_pre_event_state_at_the_boundary() -> None:
    model = parameters()
    result = simulate_quarter_car(
        model,
        RoadProfile(kind="step", amplitude_m=0.01, start_time_s=0.25),
        settings=settings(duration=0.5, samples=51, max_step=0.005),
    )
    boundary = result.samples[25]
    assert boundary.time_s == pytest.approx(0.25)
    assert boundary.sprung_displacement_m == pytest.approx(0.0, abs=1.0e-15)
    assert boundary.unsprung_displacement_m == pytest.approx(0.0, abs=1.0e-15)
    assert boundary.unsprung_acceleration_mps2 == pytest.approx(
        model.tire_stiffness_n_per_m * 0.01 / model.unsprung_mass_kg
    )


def test_smooth_bump_step_refinement_converges() -> None:
    road = RoadProfile(kind="smooth_bump", amplitude_m=0.02, start_time_s=0.2, duration_s=0.15)
    coarse = simulate_quarter_car(
        parameters(), road, settings=settings(duration=1.2, samples=241, max_step=0.01)
    )
    fine = simulate_quarter_car(
        parameters(), road, settings=settings(duration=1.2, samples=241, max_step=0.002)
    )
    assert coarse.calculation_status == fine.calculation_status == "VERIFIED_NUMERICALLY"
    differences = [
        abs(first.sprung_displacement_m - second.sprung_displacement_m)
        for first, second in zip(coarse.samples, fine.samples, strict=True)
    ]
    assert max(differences) < 2.0e-8


def test_solver_tolerance_refinement_converges_toward_tight_reference() -> None:
    model = parameters()
    road = RoadProfile(kind="sine", amplitude_m=0.01, frequency_hz=8.0)

    def run(relative: float, absolute: float):
        return simulate_quarter_car(
            model,
            road,
            settings=DynamicsSettings(
                duration_s=1.0,
                output_samples=201,
                relative_tolerance=relative,
                absolute_tolerance=absolute,
                maximum_step_s=0.1,
            ),
        )

    loose = run(1.0e-4, 1.0e-6)
    refined = run(1.0e-7, 1.0e-9)
    reference = run(1.0e-11, 1.0e-13)

    def error(result) -> float:
        return max(
            abs(sample.sprung_displacement_m - expected.sprung_displacement_m)
            for sample, expected in zip(result.samples, reference.samples, strict=True)
        )

    assert error(refined) < error(loose)
    assert error(refined) < 1.0e-8


def test_sampled_road_linear_interpolation_and_endpoint_hold() -> None:
    profile = RoadProfile(
        kind="sampled",
        sample_times_s=(0.0, 0.1, 0.3),
        sample_displacements_m=(0.0, 0.02, -0.01),
    )
    assert road_state(profile, -0.1) == (0.0, 0.0)
    assert road_state(profile, 0.05) == pytest.approx((0.01, 0.2))
    assert road_state(profile, 0.2) == pytest.approx((0.005, -0.15))
    assert road_state(profile, 0.5) == (-0.01, 0.0)


def test_road_profile_values_and_velocity_signs() -> None:
    smooth = RoadProfile(kind="smooth_bump", amplitude_m=0.02, duration_s=0.2)
    half_sine = RoadProfile(kind="half_sine", amplitude_m=0.02, duration_s=0.2)
    sine = RoadProfile(kind="sine", amplitude_m=0.01, frequency_hz=2.0)
    assert road_state(smooth, 0.1) == pytest.approx((0.02, 0.0), abs=1.0e-14)
    assert road_state(half_sine, 0.1) == pytest.approx((0.02, 0.0), abs=1.0e-14)
    assert road_state(sine, 0.0) == pytest.approx((0.0, 0.04 * pi))


def test_tire_force_sign_and_missing_static_contact_provenance() -> None:
    result = simulate_quarter_car(
        parameters(),
        zero_road(),
        QuarterCarInitialState(unsprung_displacement_m=0.001),
        settings(duration=0.05, samples=11, max_step=0.001),
    )
    first = result.samples[0]
    assert first.tire_compression_m == pytest.approx(-0.001)
    assert first.tire_force_increment_n == pytest.approx(-200.0)
    assert first.total_tire_contact_force_n is None
    assert "TOTAL_CONTACT_FORCE_NOT_AVAILABLE_STATIC_TIRE_LOAD_MISSING" in result.warnings


def test_negative_total_contact_is_rejected_without_partial_results() -> None:
    result = simulate_quarter_car(
        parameters(static_load=100.0),
        zero_road(),
        QuarterCarInitialState(unsprung_displacement_m=0.01),
        settings(duration=0.1, samples=21, max_step=0.001),
    )
    assert result.calculation_status == "FAILED"
    assert result.samples == ()
    assert result.diagnostics.contact_accepted is False
    assert result.diagnostics.minimum_total_contact_force_n is not None
    assert result.diagnostics.minimum_total_contact_force_n < 0.0


def test_invalid_mass_sample_order_and_step_tire_damping_fail() -> None:
    invalid_mass = simulate_quarter_car(
        QuarterCarParameters(-1.0, 40.0, 20_000.0, 1000.0, 200_000.0),
        zero_road(),
    )
    invalid_samples = simulate_quarter_car(
        parameters(),
        RoadProfile(
            kind="sampled",
            sample_times_s=(0.0, 0.2, 0.1),
            sample_displacements_m=(0.0, 0.01, 0.0),
        ),
    )
    invalid_step = simulate_quarter_car(
        parameters(tire_damping=100.0), RoadProfile(kind="step", amplitude_m=0.01)
    )
    assert invalid_mass.calculation_status == "FAILED"
    assert invalid_samples.calculation_status == "FAILED"
    assert invalid_step.calculation_status == "FAILED"
