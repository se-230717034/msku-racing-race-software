import type { KinematicState, KinematicsSweepResponse } from "@msku/contracts";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

const degrees = (radians: number): number => radians * 180 / Math.PI;
const format = (value: number | null | undefined, digits = 3): string =>
  value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="result-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{unit}</em>
    </div>
  );
}

export function KinematicsPanel({
  state,
  sweep,
}: {
  state: KinematicState | undefined;
  sweep: KinematicsSweepResponse;
}) {
  const metrics = state?.metrics;
  const diagnostics = state?.diagnostics;
  const gainScale = 0.01 * 180 / Math.PI;

  return (
    <aside className="inspector kinematics-panel">
      <section className="inspector-section">
        <div className="section-heading">
          <span className="eyebrow">SOLVED STATE</span>
          <span className={diagnostics?.converged ? "status-chip ok" : "status-chip error"}>
            {diagnostics?.converged ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
            {diagnostics?.converged ? "converged" : "failed"}
          </span>
        </div>
        <div className="result-grid">
          <Metric label="Wheel travel" value={format((state?.travelM ?? 0) * 1000, 2)} unit="mm" />
          <Metric label="Camber" value={format(metrics ? degrees(metrics.camberRad) : null)} unit="deg" />
          <Metric label="Camber change" value={format(metrics ? degrees(metrics.camberChangeRad) : null)} unit="deg" />
          <Metric label="Camber gain" value={format(metrics?.camberGainRadPerM == null ? null : metrics.camberGainRadPerM * gainScale)} unit="deg/10mm" />
          <Metric label="Toe" value={format(metrics ? degrees(metrics.toeRad) : null)} unit="deg" />
          <Metric label="Bump steer" value={format(metrics ? degrees(metrics.bumpSteerRad) : null)} unit="deg" />
          <Metric label="Bump-steer gradient" value={format(metrics?.bumpSteerGradientRadPerM == null ? null : metrics.bumpSteerGradientRadPerM * gainScale)} unit="deg/10mm" />
          <Metric label="Caster" value={format(metrics ? degrees(metrics.casterRad) : null)} unit="deg" />
          <Metric label="KPI / SAI" value={format(metrics ? degrees(metrics.kpiRad) : null)} unit="deg" />
          <Metric label="Track change" value={format(metrics == null ? null : metrics.trackChangeM * 1000)} unit="mm" />
          <Metric label="Roll-centre height" value={format(metrics?.rollCenterHeightM == null ? null : metrics.rollCenterHeightM * 1000)} unit="mm" />
        </div>
      </section>

      <section className="inspector-section">
        <div className="section-heading">
          <span className="eyebrow">SOLVER DIAGNOSTICS</span>
          <span className="unit-chip">tol {sweep.residualToleranceM.toExponential(0)} m</span>
        </div>
        <dl className="solver-diagnostics">
          <div><dt>Optimizer</dt><dd>{diagnostics?.optimizerSuccess ? "accepted" : "failed"}</dd></div>
          <div><dt>Residual check</dt><dd>{diagnostics?.residualsAccepted ? "accepted" : "failed"}</dd></div>
          <div><dt>Jacobian check</dt><dd>{diagnostics?.jacobianAccepted ? "accepted" : "failed"}</dd></div>
          <div><dt>Continuity check</dt><dd>{diagnostics?.continuityAccepted ? "accepted" : "failed"}</dd></div>
          <div><dt>Max residual</dt><dd>{diagnostics?.maxAbsResidualM == null ? "—" : `${diagnostics.maxAbsResidualM.toExponential(3)} m`}</dd></div>
          <div><dt>Residual norm</dt><dd>{diagnostics?.residualNormM == null ? "—" : `${diagnostics.residualNormM.toExponential(3)} m`}</dd></div>
          <div><dt>Jacobian rank</dt><dd>{diagnostics?.jacobianRank ?? "—"} / 6</dd></div>
          <div><dt>Condition number</dt><dd>{diagnostics?.jacobianCondition == null ? "—" : diagnostics.jacobianCondition.toExponential(3)}</dd></div>
          <div><dt>Function evaluations</dt><dd>{diagnostics?.functionEvaluations ?? "—"}</dd></div>
        </dl>
        {diagnostics && !diagnostics.converged && <p className="solver-failure">{diagnostics.message}</p>}
        {state && state.warnings.length > 0 && (
          <ul className="solver-warnings">{state.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        )}
      </section>

      <section className="inspector-section">
        <span className="eyebrow">CALCULATION QUALITY</span>
        <dl className="solver-diagnostics quality-status">
          <div><dt>Numerical</dt><dd>{sweep.validationStatus.numerical}</dd></div>
          <div><dt>Reference</dt><dd>{sweep.validationStatus.reference}</dd></div>
          <div><dt>Physical</dt><dd>{sweep.validationStatus.physical}</dd></div>
          <div><dt>Approval</dt><dd>{sweep.validationStatus.engineeringApproval}</dd></div>
          <div><dt>Solver</dt><dd>v{sweep.solver.version}</dd></div>
          <div title={sweep.inputProvenance.projectInputSha256}><dt>Input SHA-256</dt><dd>{sweep.inputProvenance.projectInputSha256.slice(0, 12)}…</dd></div>
        </dl>
        <ul className="solver-warnings">
          {sweep.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      </section>

      <section className="inspector-section grow model-note">
        <span className="eyebrow">MODEL SCOPE</span>
        <p>Rigid links and joints; no compliance, loads, tire forces, or transient dynamics.</p>
        <p>Roll-centre height is a geometric front-view result. It assumes an exact mirrored opposite corner and a rigid circular tire contact point; unsupported pivot/arm projections return no value.</p>
        <p>Positive travel is bump. Positive toe is toe-in; positive camber tilts the wheel top outward.</p>
        <b>NOT PHYSICALLY VALIDATED — NOT FOR DESIGN SIGN-OFF</b>
      </section>
    </aside>
  );
}

