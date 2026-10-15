import type { KinematicsSweepResponse } from "@msku/contracts";

const degrees = (radians: number | null | undefined): string =>
  radians == null ? "" : (radians * 180 / Math.PI).toPrecision(12);

const number = (value: number | null | undefined): string =>
  value == null ? "" : value.toPrecision(12);

const csvCell = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

export const serializeKinematicsCsv = (sweep: KinematicsSweepResponse): string => {
  if (!sweep.allConverged || sweep.validationStatus.numerical !== "VERIFIED_NUMERICALLY") {
    throw new Error("Failed or incomplete kinematics sweeps cannot be exported.");
  }
  const metadata = [
    ["engineering_approval", sweep.validationStatus.engineeringApproval],
    ["numerical_status", sweep.validationStatus.numerical],
    ["reference_status", sweep.validationStatus.reference],
    ["physical_status", sweep.validationStatus.physical],
    ["solver_name", sweep.solver.name],
    ["solver_version", sweep.solver.version],
    ["residual_tolerance_m", number(sweep.solver.residualToleranceM)],
    ["rank_relative_tolerance", number(sweep.solver.rankRelativeTolerance)],
    ["condition_limit", number(sweep.solver.conditionLimit)],
    ["continuity_position_limit_m", number(sweep.solver.continuityPositionLimitM)],
    ["continuity_rotation_limit_rad", number(sweep.solver.continuityRotationLimitRad)],
    ["maximum_travel_step_m", number(sweep.solver.maximumTravelStepM)],
    ["max_function_evaluations", String(sweep.solver.maxFunctionEvaluations)],
    ["gradient_method", sweep.solver.gradientMethod],
    ["project_id", sweep.inputProvenance.projectId],
    ["project_name", sweep.inputProvenance.projectName],
    ["data_classification", sweep.inputProvenance.dataClassification],
    ["declared_model_status", sweep.inputProvenance.declaredModelStatus],
    ["project_input_sha256", sweep.inputProvenance.projectInputSha256],
    ["sweep_warnings", sweep.warnings.join(";")],
    ["length_unit", sweep.units.length],
    ["angle_unit", sweep.units.angle],
  ].map(([key, value]) => `# ${key},${csvCell(value)}`);
  const header = [
    "travel_mm",
    "calculation_status",
    "converged",
    "optimizer_success",
    "residuals_accepted",
    "jacobian_accepted",
    "continuity_accepted",
    "camber_deg",
    "camber_change_deg",
    "camber_gain_deg_per_10mm",
    "toe_deg",
    "bump_steer_deg",
    "bump_steer_gradient_deg_per_10mm",
    "caster_deg",
    "kpi_deg",
    "track_change_mm",
    "roll_center_height_mm",
    "max_abs_residual_m",
    "jacobian_rank",
    "jacobian_condition",
    "function_evaluations",
    "warnings",
  ];
  const rows = sweep.states.map((state) => {
    const metrics = state.metrics;
    return [
      number(state.travelM * 1000),
      state.calculationStatus,
      String(state.diagnostics.converged),
      String(state.diagnostics.optimizerSuccess),
      String(state.diagnostics.residualsAccepted),
      String(state.diagnostics.jacobianAccepted),
      String(state.diagnostics.continuityAccepted),
      degrees(metrics?.camberRad),
      degrees(metrics?.camberChangeRad),
      degrees(metrics?.camberGainRadPerM == null ? null : metrics.camberGainRadPerM * 0.01),
      degrees(metrics?.toeRad),
      degrees(metrics?.bumpSteerRad),
      degrees(metrics?.bumpSteerGradientRadPerM == null ? null : metrics.bumpSteerGradientRadPerM * 0.01),
      degrees(metrics?.casterRad),
      degrees(metrics?.kpiRad),
      number(metrics?.trackChangeM == null ? null : metrics.trackChangeM * 1000),
      number(metrics?.rollCenterHeightM == null ? null : metrics.rollCenterHeightM * 1000),
      number(state.diagnostics.maxAbsResidualM),
      String(state.diagnostics.jacobianRank),
      number(state.diagnostics.jacobianCondition),
      String(state.diagnostics.functionEvaluations),
      csvCell(state.warnings.join(";")),
    ].join(",");
  });
  return [...metadata, header.join(","), ...rows].join("\n");
};

export const downloadKinematicsCsv = (
  sweep: KinematicsSweepResponse,
  projectName: string,
): void => {
  const blob = new Blob([serializeKinematicsCsv(sweep)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const safeName = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  anchor.href = url;
  anchor.download = `${safeName || "msku-project"}-UNVALIDATED-kinematics.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
};

