"""Deterministic bounded optimization for verified engineering model adapters.

The optimizer never interprets a failed evaluator as a numerical objective. Infeasible,
non-finite, or missing evaluations receive an internal rejection penalty and are excluded
from reported engineering candidates.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import differential_evolution

OPTIMIZATION_SOLVER_VERSION = "5.0.0"
ObjectiveGoal = Literal["minimize", "target"]


@dataclass(frozen=True)
class DesignVariable:
    name: str
    baseline: float
    lower_bound: float
    upper_bound: float


@dataclass(frozen=True)
class ObjectiveDefinition:
    name: str
    weight: float
    normalization: float
    goal: ObjectiveGoal = "minimize"
    target: float | None = None


@dataclass(frozen=True)
class ModelEvaluation:
    metrics: Mapping[str, float]
    feasible: bool
    violations: tuple[str, ...] = ()


@dataclass(frozen=True)
class OptimizationSettings:
    seed: int = 2307
    maximum_generations: int = 60
    population_multiplier: int = 8
    convergence_tolerance: float = 1.0e-6
    pareto_points: int = 0
    sensitivity_step_fraction: float = 1.0e-4


DEFAULT_OPTIMIZATION_SETTINGS = OptimizationSettings()


@dataclass(frozen=True)
class Candidate:
    variable_values: Mapping[str, float]
    metrics: Mapping[str, float]
    normalized_objectives: Mapping[str, float]
    weighted_objective: float


@dataclass(frozen=True)
class ConvergencePoint:
    generation: int
    best_weighted_objective: float
    convergence_indicator: float


@dataclass(frozen=True)
class Sensitivity:
    variable_name: str
    metric_name: str
    derivative: float | None
    step: float
    method: Literal["central", "forward", "backward", "unavailable"]


@dataclass(frozen=True)
class OptimizationDiagnostics:
    success: bool
    message: str
    evaluations: int
    feasible_evaluations: int
    rejected_evaluations: int
    generations: int
    seed: int
    method: str = "scipy_differential_evolution"


@dataclass(frozen=True)
class OptimizationResult:
    calculation_status: Literal["VERIFIED_NUMERICALLY", "FAILED"]
    baseline: Candidate | None
    optimized: Candidate | None
    pareto_front: tuple[Candidate, ...]
    convergence: tuple[ConvergencePoint, ...]
    sensitivities: tuple[Sensitivity, ...]
    diagnostics: OptimizationDiagnostics
    warnings: tuple[str, ...]
    solver_version: str = OPTIMIZATION_SOLVER_VERSION
    reference_status: str = "REFERENCE_BENCHMARKED"
    physical_status: str = "UNVALIDATED_PHYSICALLY"


EngineeringEvaluator = Callable[[Mapping[str, float]], ModelEvaluation]
_REJECTION_PENALTY = 1.0e100


def _validate_inputs(
    variables: tuple[DesignVariable, ...],
    objectives: tuple[ObjectiveDefinition, ...],
    settings: OptimizationSettings,
) -> str | None:
    if not variables:
        return "At least one design variable is required."
    if len({item.name for item in variables}) != len(variables):
        return "Design variable names must be unique."
    if not objectives:
        return "At least one objective is required."
    if len({item.name for item in objectives}) != len(objectives):
        return "Objective names must be unique."
    for variable in variables:
        values = (variable.baseline, variable.lower_bound, variable.upper_bound)
        if not np.all(np.isfinite(values)):
            return f"Design variable {variable.name} must be finite."
        if variable.lower_bound >= variable.upper_bound:
            return f"Design variable {variable.name} requires lower < upper."
        if not variable.lower_bound <= variable.baseline <= variable.upper_bound:
            return f"Baseline for {variable.name} lies outside its bounds."
    for objective in objectives:
        if not np.isfinite(objective.weight) or objective.weight <= 0.0:
            return f"Objective {objective.name} requires a positive finite weight."
        if not np.isfinite(objective.normalization) or objective.normalization <= 0.0:
            return f"Objective {objective.name} requires positive finite normalization."
        if objective.goal == "target" and (
            objective.target is None or not np.isfinite(objective.target)
        ):
            return f"Target objective {objective.name} requires a finite target."
        if objective.goal not in ("minimize", "target"):
            return f"Objective {objective.name} has an unsupported goal."
    if (
        settings.maximum_generations < 1
        or settings.population_multiplier < 4
        or not np.isfinite(settings.convergence_tolerance)
        or settings.convergence_tolerance <= 0.0
        or settings.pareto_points < 0
        or settings.pareto_points > 31
        or not np.isfinite(settings.sensitivity_step_fraction)
        or settings.sensitivity_step_fraction <= 0.0
        or settings.sensitivity_step_fraction > 0.1
    ):
        return (
            "Optimization generations, population, tolerance, Pareto count, or "
            "sensitivity step is invalid."
        )
    if settings.pareto_points and len(objectives) < 2:
        return "Pareto generation requires at least two objectives."
    return None


def _objective_losses(
    evaluation: ModelEvaluation,
    objectives: tuple[ObjectiveDefinition, ...],
) -> dict[str, float] | None:
    if not evaluation.feasible:
        return None
    losses: dict[str, float] = {}
    for item in objectives:
        raw = evaluation.metrics.get(item.name)
        if raw is None or not np.isfinite(raw):
            return None
        if item.goal == "minimize":
            loss = raw
        else:
            if item.target is None:
                return None
            loss = abs(raw - item.target)
        if loss < 0.0:
            return None
        losses[item.name] = float(loss / item.normalization)
    return losses


def _candidate(
    values: Mapping[str, float],
    evaluation: ModelEvaluation,
    objectives: tuple[ObjectiveDefinition, ...],
    weights: tuple[float, ...] | None = None,
) -> Candidate | None:
    losses = _objective_losses(evaluation, objectives)
    if losses is None:
        return None
    objective_weights = weights or tuple(item.weight for item in objectives)
    weighted = sum(
        objective_weights[index] * losses[item.name]
        for index, item in enumerate(objectives)
    )
    if not np.isfinite(weighted):
        return None
    metrics = {name: float(value) for name, value in evaluation.metrics.items()}
    return Candidate(dict(values), metrics, losses, float(weighted))


def _nondominated(
    candidates: list[Candidate], objectives: tuple[ObjectiveDefinition, ...]
) -> tuple[Candidate, ...]:
    unique: dict[tuple[float, ...], Candidate] = {}
    for candidate in candidates:
        key = tuple(
            round(candidate.variable_values[name], 13) for name in candidate.variable_values
        )
        unique[key] = candidate
    retained: list[Candidate] = []
    for candidate in unique.values():
        vector = np.asarray(
            [candidate.normalized_objectives[item.name] for item in objectives],
            dtype=np.float64,
        )
        dominated = False
        for other in unique.values():
            if other is candidate:
                continue
            other_vector = np.asarray(
                [other.normalized_objectives[item.name] for item in objectives],
                dtype=np.float64,
            )
            if np.all(other_vector <= vector) and np.any(other_vector < vector):
                dominated = True
                break
        if not dominated:
            retained.append(candidate)
    return tuple(sorted(retained, key=lambda item: tuple(item.normalized_objectives.values())))


def _pareto_weights(count: int, objective_count: int, seed: int) -> tuple[tuple[float, ...], ...]:
    if objective_count == 2:
        return tuple(
            (float(value), float(1.0 - value))
            for value in np.linspace(0.0, 1.0, count)
        )
    random = np.random.default_rng(seed)
    weights: list[tuple[float, ...]] = []
    for index in range(min(count, objective_count)):
        values = np.zeros(objective_count, dtype=np.float64)
        values[index] = 1.0
        weights.append(tuple(float(value) for value in values))
    while len(weights) < count:
        values = random.dirichlet(np.ones(objective_count, dtype=np.float64))
        weights.append(tuple(float(value) for value in values))
    return tuple(weights)


def run_optimization(
    variables: tuple[DesignVariable, ...],
    objectives: tuple[ObjectiveDefinition, ...],
    evaluator: EngineeringEvaluator,
    settings: OptimizationSettings = DEFAULT_OPTIMIZATION_SETTINGS,
) -> OptimizationResult:
    """Run a reproducible bounded differential-evolution optimization."""
    invalid = _validate_inputs(variables, objectives, settings)
    if invalid is not None:
        return OptimizationResult(
            calculation_status="FAILED",
            baseline=None,
            optimized=None,
            pareto_front=(),
            convergence=(),
            sensitivities=(),
            diagnostics=OptimizationDiagnostics(False, invalid, 0, 0, 0, 0, settings.seed),
            warnings=("INVALID_OPTIMIZATION_INPUT",),
        )

    names = tuple(item.name for item in variables)
    bounds = tuple((item.lower_bound, item.upper_bound) for item in variables)
    baseline_values = {item.name: item.baseline for item in variables}
    baseline_evaluation = evaluator(baseline_values)
    baseline = _candidate(baseline_values, baseline_evaluation, objectives)
    if baseline is None:
        detail = baseline_evaluation.violations or ("BASELINE_EVALUATION_FAILED",)
        return OptimizationResult(
            calculation_status="FAILED",
            baseline=None,
            optimized=None,
            pareto_front=(),
            convergence=(),
            sensitivities=(),
            diagnostics=OptimizationDiagnostics(
                False,
                "Baseline design is infeasible or lacks required metrics.",
                1,
                0,
                1,
                0,
                settings.seed,
            ),
            warnings=tuple(dict.fromkeys(("INFEASIBLE_BASELINE", *detail))),
        )

    evaluations = 1
    feasible_evaluations = 1
    rejected_evaluations = 0
    cache: dict[tuple[float, ...], tuple[ModelEvaluation, Candidate | None]] = {}

    def evaluate_vector(
        vector: np.ndarray, weights: tuple[float, ...] | None = None
    ) -> Candidate | None:
        nonlocal evaluations, feasible_evaluations, rejected_evaluations
        key = tuple(float(value) for value in vector)
        cached = cache.get(key)
        if cached is None:
            values = dict(zip(names, key, strict=True))
            evaluation = evaluator(values)
            candidate = _candidate(values, evaluation, objectives, weights)
            evaluations += 1
            if candidate is None:
                rejected_evaluations += 1
            else:
                feasible_evaluations += 1
            cache[key] = (evaluation, candidate)
            return candidate
        evaluation, _ = cached
        return _candidate(dict(zip(names, key, strict=True)), evaluation, objectives, weights)

    convergence: list[ConvergencePoint] = []

    def solve(
        weights: tuple[float, ...] | None,
        seed: int,
        record_trace: bool,
    ) -> tuple[Candidate | None, bool, str, int]:
        generation = 0

        def scalar(vector: NDArray[np.float64]) -> float:
            candidate = evaluate_vector(vector, weights)
            return candidate.weighted_objective if candidate is not None else _REJECTION_PENALTY

        def callback(vector: NDArray[np.float64], indicator: Any) -> None:
            nonlocal generation
            generation += 1
            if record_trace:
                candidate = evaluate_vector(vector, weights)
                best = candidate.weighted_objective if candidate is not None else _REJECTION_PENALTY
                convergence.append(ConvergencePoint(generation, best, float(indicator)))

        solution = differential_evolution(
            scalar,
            bounds,
            rng=seed,
            maxiter=settings.maximum_generations,
            popsize=settings.population_multiplier,
            tol=settings.convergence_tolerance,
            atol=settings.convergence_tolerance,
            polish=False,
            updating="immediate",
            workers=1,
            callback=callback,
            x0=np.asarray([item.baseline for item in variables], dtype=np.float64),
        )
        candidate = evaluate_vector(np.asarray(solution.x, dtype=np.float64), weights)
        accepted = bool(solution.success and candidate is not None)
        return candidate if accepted else None, accepted, str(solution.message), int(solution.nit)

    optimized, success, message, generations = solve(None, settings.seed, True)
    if not success or optimized is None:
        return OptimizationResult(
            calculation_status="FAILED",
            baseline=baseline,
            optimized=None,
            pareto_front=(),
            convergence=tuple(convergence),
            sensitivities=(),
            diagnostics=OptimizationDiagnostics(
                False,
                message,
                evaluations,
                feasible_evaluations,
                rejected_evaluations,
                generations,
                settings.seed,
            ),
            warnings=("OPTIMIZER_DID_NOT_CONVERGE",),
        )

    pareto_candidates: list[Candidate] = []
    pareto_warning = False
    if settings.pareto_points:
        for index, weights in enumerate(
            _pareto_weights(settings.pareto_points, len(objectives), settings.seed)
        ):
            candidate, accepted, _, _ = solve(weights, settings.seed + index + 1, False)
            if accepted and candidate is not None:
                pareto_candidates.append(candidate)
            else:
                pareto_warning = True
    pareto_front = _nondominated(pareto_candidates, objectives)

    sensitivities: list[Sensitivity] = []
    optimized_values = dict(optimized.variable_values)
    for variable in variables:
        span = variable.upper_bound - variable.lower_bound
        step = settings.sensitivity_step_fraction * span
        centre = optimized_values[variable.name]
        lower = max(variable.lower_bound, centre - step)
        upper = min(variable.upper_bound, centre + step)
        minus_values = {**optimized_values, variable.name: lower}
        plus_values = {**optimized_values, variable.name: upper}
        minus_evaluation = evaluator(minus_values) if lower < centre else None
        plus_evaluation = evaluator(plus_values) if upper > centre else None
        for sensitivity_evaluation in (minus_evaluation, plus_evaluation):
            if sensitivity_evaluation is None:
                continue
            evaluations += 1
            if _objective_losses(sensitivity_evaluation, objectives) is None:
                rejected_evaluations += 1
            else:
                feasible_evaluations += 1
        for objective in objectives:
            minus = (
                minus_evaluation.metrics.get(objective.name)
                if minus_evaluation and minus_evaluation.feasible
                else None
            )
            plus = (
                plus_evaluation.metrics.get(objective.name)
                if plus_evaluation and plus_evaluation.feasible
                else None
            )
            centre_metric = optimized.metrics[objective.name]
            derivative: float | None
            method: Literal["central", "forward", "backward", "unavailable"]
            if minus is not None and plus is not None and np.isfinite(minus) and np.isfinite(plus):
                derivative = float((plus - minus) / (upper - lower))
                method = "central"
            elif plus is not None and np.isfinite(plus):
                derivative = float((plus - centre_metric) / (upper - centre))
                method = "forward"
            elif minus is not None and np.isfinite(minus):
                derivative = float((centre_metric - minus) / (centre - lower))
                method = "backward"
            else:
                derivative = None
                method = "unavailable"
            sensitivities.append(
                Sensitivity(variable.name, objective.name, derivative, step, method)
            )

    warnings = ["PHYSICALLY_UNVALIDATED_OPTIMUM", "LOCAL_SENSITIVITY_ONLY"]
    if pareto_warning:
        warnings.append("SOME_PARETO_SCALARIZATIONS_DID_NOT_CONVERGE")
    if any(item.derivative is None for item in sensitivities):
        warnings.append("SENSITIVITY_UNAVAILABLE_AT_FEASIBILITY_BOUNDARY")
    return OptimizationResult(
        calculation_status="VERIFIED_NUMERICALLY",
        baseline=baseline,
        optimized=optimized,
        pareto_front=pareto_front,
        convergence=tuple(convergence),
        sensitivities=tuple(sensitivities),
        diagnostics=OptimizationDiagnostics(
            True,
            message,
            evaluations,
            feasible_evaluations,
            rejected_evaluations,
            generations,
            settings.seed,
        ),
        warnings=tuple(warnings),
    )
