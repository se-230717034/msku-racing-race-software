import type { KinematicsSweepResponse } from "@msku/contracts";

const degrees = (radians: number | null | undefined): string =>
  radians == null ? "" : (radians * 180 / Math.PI).toPrecision(12);

const number = (value: number | null | undefined): string =>
  value == null ? "" : value.toPrecision(12);

export const serializeKinematicsCsv = (sweep: KinematicsSweepResponse): string => {
  const header = [
    "travel_mm",
    "converged",
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
      String(state.diagnostics.converged),
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
      `"${state.warnings.join(";").replaceAll('"', '""')}"`,
    ].join(",");
  });
  return [header.join(","), ...rows].join("\n");
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
  anchor.download = `${safeName || "msku-project"}-kinematics.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
};

