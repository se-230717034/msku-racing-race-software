from __future__ import annotations

import math

import pytest
from msku_engineering import (
    DesignVariable,
    ModelEvaluation,
    ObjectiveDefinition,
    OptimizationSettings,
    run_optimization,
)


def settings(*, pareto_points: int = 0) -> OptimizationSettings:
    return OptimizationSettings(
        seed=2307,
        maximum_generations=120,
        population_multiplier=10,
        convergence_tolerance=1.0e-8,
        pareto_points=pareto_points,
        sensitivity_step_fraction=1.0e-4,
    )


def test_known_bounded_quadratic_minimum_and_reproducibility() -> None:
    variables = (
        DesignVariable("x", 0.0, -4.0, 4.0),
        DesignVariable("y", 0.0, -3.0, 3.0),
    )
    objectives = (ObjectiveDefinition("loss", 1.0, 5.0),)

    def evaluate(values: dict[str, float]) -> ModelEvaluation:
        loss = (values["x"] - 2.0) ** 2 + 3.0 * (values["y"] + 1.0) ** 2
        return ModelEvaluation({"loss": loss}, True)

    first = run_optimization(variables, objectives, evaluate, settings())
    second = run_optimization(variables, objectives, evaluate, settings())
    assert first.calculation_status == "VERIFIED_NUMERICALLY"
    assert first.optimized is not None
    assert first.optimized.variable_values["x"] == pytest.approx(2.0, abs=2.0e-5)
    assert first.optimized.variable_values["y"] == pytest.approx(-1.0, abs=2.0e-5)
    assert first.optimized.weighted_objective < 1.0e-9
    assert second.optimized == first.optimized
    assert second.convergence == first.convergence


def test_weighted_objective_uses_explicit_normalization() -> None:
    variables = (DesignVariable("x", 1.5, -2.0, 2.0),)
    objectives = (
        ObjectiveDefinition("left", 2.0, 2.0),
        ObjectiveDefinition("right", 1.0, 0.5),
    )

    def evaluate(values: dict[str, float]) -> ModelEvaluation:
        x = values["x"]
        return ModelEvaluation({"left": (x - 1.0) ** 2, "right": (x + 1.0) ** 2}, True)

    result = run_optimization(variables, objectives, evaluate, settings())
    assert result.calculation_status == "VERIFIED_NUMERICALLY"
    assert result.optimized is not None
    # 2/2*(x-1)^2 + 1/0.5*(x+1)^2 has its independent analytical minimum at -1/3.
    assert result.optimized.variable_values["x"] == pytest.approx(-1.0 / 3.0, abs=2.0e-5)


def test_pareto_front_is_nondominated_and_reproducible() -> None:
    variables = (DesignVariable("x", 0.5, 0.0, 1.0),)
    objectives = (
        ObjectiveDefinition("first", 1.0, 1.0),
        ObjectiveDefinition("second", 1.0, 1.0),
    )

    def evaluate(values: dict[str, float]) -> ModelEvaluation:
        x = values["x"]
        return ModelEvaluation({"first": x**2, "second": (1.0 - x) ** 2}, True)

    result = run_optimization(variables, objectives, evaluate, settings(pareto_points=5))
    repeated = run_optimization(variables, objectives, evaluate, settings(pareto_points=5))
    assert result.calculation_status == "VERIFIED_NUMERICALLY"
    assert len(result.pareto_front) >= 4
    assert result.pareto_front == repeated.pareto_front
    for candidate in result.pareto_front:
        vector = (candidate.metrics["first"], candidate.metrics["second"])
        assert not any(
            other.metrics["first"] <= vector[0]
            and other.metrics["second"] <= vector[1]
            and (
                other.metrics["first"] < vector[0]
                or other.metrics["second"] < vector[1]
            )
            for other in result.pareto_front
        )


def test_failed_evaluations_are_rejected_instead_of_rewarded() -> None:
    variables = (DesignVariable("x", 0.5, -1.0, 1.0),)
    objectives = (ObjectiveDefinition("loss", 1.0, 1.0),)

    def evaluate(values: dict[str, float]) -> ModelEvaluation:
        x = values["x"]
        if x < 0.0:
            return ModelEvaluation({}, False, ("MODEL_FAILED",))
        return ModelEvaluation({"loss": (x + 0.5) ** 2}, True)

    result = run_optimization(variables, objectives, evaluate, settings())
    assert result.calculation_status == "VERIFIED_NUMERICALLY"
    assert result.optimized is not None
    assert result.optimized.variable_values["x"] >= 0.0
    assert result.diagnostics.rejected_evaluations > 0


def test_target_objective_and_sensitivity_match_finite_difference_reference() -> None:
    variables = (DesignVariable("x", 1.0, 0.5, 3.0),)
    objectives = (ObjectiveDefinition("square", 1.0, 4.0, "target", 4.0),)

    def evaluate(values: dict[str, float]) -> ModelEvaluation:
        return ModelEvaluation({"square": values["x"] ** 2}, True)

    result = run_optimization(variables, objectives, evaluate, settings())
    assert result.calculation_status == "VERIFIED_NUMERICALLY"
    assert result.optimized is not None
    assert result.optimized.variable_values["x"] == pytest.approx(2.0, abs=2.0e-5)
    sensitivity = result.sensitivities[0]
    assert sensitivity.method == "central"
    assert sensitivity.derivative == pytest.approx(4.0, rel=2.0e-4)


def test_infeasible_baseline_and_nonfinite_metric_fail_closed() -> None:
    variables = (DesignVariable("x", 0.0, -1.0, 1.0),)
    objectives = (ObjectiveDefinition("loss", 1.0, 1.0),)

    def infeasible(_: dict[str, float]) -> ModelEvaluation:
        return ModelEvaluation({}, False, ("CONSTRAINT",))

    result = run_optimization(variables, objectives, infeasible, settings())
    assert result.calculation_status == "FAILED"
    assert result.optimized is None
    assert "INFEASIBLE_BASELINE" in result.warnings

    def nonfinite(_: dict[str, float]) -> ModelEvaluation:
        return ModelEvaluation({"loss": math.nan}, True)

    result = run_optimization(variables, objectives, nonfinite, settings())
    assert result.calculation_status == "FAILED"
    assert result.optimized is None
