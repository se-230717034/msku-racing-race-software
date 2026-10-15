import {
  actuationSeriesResponseSchema,
  uprightEquilibriumResponseSchema,
  vehicleLoadTransferResponseSchema,
  type ActuationSeriesResponse,
  type UprightEquilibriumResponse,
  type VehicleLoadTransferResponse,
} from "@msku/contracts";
import { AlertTriangle, CheckCircle2, Download, FlaskConical, Play } from "lucide-react";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useWorkspace } from "../store/workspace";
import { SuspensionViewport } from "./SuspensionViewport";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

const readError = async (response: Response): Promise<string> => {
  try {
    const payload = await response.json() as { detail?: unknown };
    return typeof payload.detail === "string"
      ? payload.detail
      : JSON.stringify(payload.detail ?? payload);
  } catch {
    return `HTTP ${response.status} ${response.statusText}`;
  }
};

async function postJson(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<unknown>;
}

function NumberField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="numeric-field">
      <span>{label}</span>
      <input
        type="number"
        step="any"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <em>{unit}</em>
    </label>
  );
}

function StatusChip({ status }: { status: string | undefined }) {
  const accepted = status === "VERIFIED_NUMERICALLY";
  return (
    <span className={`status-chip ${accepted ? "ok" : status ? "error" : ""}`}>
      {accepted ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
      {status ?? "NOT RUN"}
    </span>
  );
}

type VectorInput = { x: number; y: number; z: number };

function VectorFields({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: VectorInput;
  onChange: (value: VectorInput) => void;
}) {
  return (
    <div className="vector-input">
      <span>{label}</span>
      <div className="coordinate-grid">
        {(["x", "y", "z"] as const).map((axis) => (
          <NumberField
            key={axis}
            label={axis.toUpperCase()}
            unit={unit}
            value={value[axis]}
            onChange={(next) => onChange({ ...value, [axis]: next })}
          />
        ))}
      </div>
    </div>
  );
}

const format = (value: number | null | undefined, digits = 2): string =>
  value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);

export function QuasiStaticWorkspace() {
  const project = useWorkspace((state) => state.project);
  const wheelCenter = useMemo(() => {
    const point = project.suspension.hardpoints.find((item) => item.id === "wheel_center");
    return point?.position ?? { x: 0, y: 0, z: 0 };
  }, [project.suspension.hardpoints]);

  const [travelMm, setTravelMm] = useState(0);
  const [force, setForce] = useState<VectorInput>({ x: 0, y: 0, z: 0 });
  const [moment, setMoment] = useState<VectorInput>({ x: 0, y: 0, z: 0 });
  const [application, setApplication] = useState<VectorInput>({ ...wheelCenter });
  const [includeActuation, setIncludeActuation] = useState(false);
  const [actuationChassis, setActuationChassis] = useState<VectorInput>({
    x: wheelCenter.x,
    y: wheelCenter.y,
    z: wheelCenter.z + 1,
  });
  const [actuationUpright, setActuationUpright] = useState<VectorInput>({ ...wheelCenter });
  const [equilibrium, setEquilibrium] = useState<UprightEquilibriumResponse>();
  const [equilibriumError, setEquilibriumError] = useState<string>();
  const [equilibriumLoading, setEquilibriumLoading] = useState(false);

  const [vehicle, setVehicle] = useState({
    massKg: 300,
    wheelbaseM: 1.6,
    cgFromFrontAxleM: 0.72,
    cgHeightM: 0.3,
    frontTrackM: 1.2,
    rearTrackM: 1.18,
    longitudinalAccelerationMps2: 0,
    lateralAccelerationMps2: 0,
    frontRollStiffnessNmPerRad: 30000,
    rearRollStiffnessNmPerRad: 25000,
  });
  const [loadTransfer, setLoadTransfer] = useState<VehicleLoadTransferResponse>();
  const [loadError, setLoadError] = useState<string>();

  const [actuationInput, setActuationInput] = useState({
    wheelTravelMm: "-20, -10, 0, 10, 20",
    springLengthMm: "210, 205, 200, 195, 190",
    referenceSpringLengthMm: 200,
    springRateNPerMm: 10,
    preloadN: 100,
  });
  const [actuation, setActuation] = useState<ActuationSeriesResponse>();
  const [actuationError, setActuationError] = useState<string>();

  const runEquilibrium = async () => {
    setEquilibriumLoading(true);
    setEquilibriumError(undefined);
    try {
      const payload = await postJson("/api/v1/quasi-static/upright-equilibrium", {
        project,
        travelM: travelMm / 1000,
        externalWrench: {
          forceN: force,
          momentNm: moment,
          applicationPointM: application,
        },
        additionalMember: includeActuation
          ? {
              id: "explicit_actuation_link",
              chassisPointM: actuationChassis,
              uprightPointM: actuationUpright,
            }
          : undefined,
      });
      setEquilibrium(uprightEquilibriumResponseSchema.parse(payload));
    } catch (reason) {
      setEquilibrium(undefined);
      setEquilibriumError(reason instanceof Error ? reason.message : "Equilibrium request failed.");
    } finally {
      setEquilibriumLoading(false);
    }
  };

  const loadSyntheticForcePreset = () => {
    setTravelMm(0);
    setForce({ x: 0, y: 0, z: -1000 });
    setMoment({ x: 0, y: 0, z: 0 });
    setApplication({ ...wheelCenter });
    setIncludeActuation(true);
    setActuationUpright({ ...wheelCenter });
    setActuationChassis({ x: wheelCenter.x, y: wheelCenter.y, z: wheelCenter.z + 1 });
    setEquilibrium(undefined);
  };

  const runLoadTransfer = async () => {
    setLoadError(undefined);
    try {
      const payload = await postJson("/api/v1/quasi-static/load-transfer", vehicle);
      setLoadTransfer(vehicleLoadTransferResponseSchema.parse(payload));
    } catch (reason) {
      setLoadTransfer(undefined);
      setLoadError(reason instanceof Error ? reason.message : "Load-transfer request failed.");
    }
  };

  const runActuation = async () => {
    setActuationError(undefined);
    const parseMillimetres = (value: string): number[] =>
      value.split(",").map((item) => Number(item.trim()) / 1000);
    try {
      const payload = await postJson("/api/v1/quasi-static/actuation-series", {
        wheelTravelM: parseMillimetres(actuationInput.wheelTravelMm),
        springLengthM: parseMillimetres(actuationInput.springLengthMm),
        referenceSpringLengthM: actuationInput.referenceSpringLengthMm / 1000,
        springRateNPerM: actuationInput.springRateNPerMm * 1000,
        preloadN: actuationInput.preloadN,
      });
      setActuation(actuationSeriesResponseSchema.parse(payload));
    } catch (reason) {
      setActuation(undefined);
      setActuationError(reason instanceof Error ? reason.message : "Actuation request failed.");
    }
  };

  const forceVectors = equilibrium?.calculationStatus === "VERIFIED_NUMERICALLY"
    ? equilibrium.memberForces.map((item) => ({
        id: item.id,
        origin: item.uprightPointM,
        force: item.forceOnUprightN,
      }))
    : [];
  const wheelLoadValues = loadTransfer?.wheelLoads
    ? [
        ["FL", loadTransfer.wheelLoads.frontLeftN],
        ["FR", loadTransfer.wheelLoads.frontRightN],
        ["RL", loadTransfer.wheelLoads.rearLeftN],
        ["RR", loadTransfer.wheelLoads.rearRightN],
      ] as const
    : [];
  const maximumWheelLoad = Math.max(...wheelLoadValues.map((item) => item[1]), 1);
  const actuationChart = actuation?.samples.map((sample) => ({
    travelMm: sample.wheelTravelM * 1000,
    motionRatio: sample.motionRatio,
    wheelRateNPerMm: sample.wheelRateNPerM / 1000,
  })) ?? [];

  return (
    <div className="loads-workspace">
      <div className="loads-toolbar">
        <div>
          <span className="eyebrow">PHASE 3 · QUASI-STATIC</span>
          <strong>Loads & forces</strong>
        </div>
        <span>SI calculation · editable display units</span>
        <button type="button" disabled title="Approved export is disabled for physically unvalidated results">
          <Download size={14} /> Approved export disabled
        </button>
      </div>

      <div className="loads-content">
        <aside className="loads-input-panel">
          <section className="inspector-section">
            <div className="section-heading">
              <span className="eyebrow">UPRIGHT CONTACT WRENCH</span>
              <StatusChip status={equilibrium?.calculationStatus} />
            </div>
            <NumberField label="Wheel travel" unit="mm" value={travelMm} onChange={setTravelMm} />
            <VectorFields label="Contact force" unit="N" value={force} onChange={setForce} />
            <VectorFields label="Free moment" unit="N·m" value={moment} onChange={setMoment} />
            <VectorFields label="Application point" unit="m" value={application} onChange={setApplication} />
            <label className="check-field">
              <input
                type="checkbox"
                checked={includeActuation}
                onChange={(event) => setIncludeActuation(event.target.checked)}
              />
              Explicit sixth actuation member
            </label>
            {includeActuation && (
              <>
                <VectorFields label="Actuation chassis/rocker point" unit="m" value={actuationChassis} onChange={setActuationChassis} />
                <VectorFields label="Actuation upright point at this pose" unit="m" value={actuationUpright} onChange={setActuationUpright} />
              </>
            )}
            <div className="action-row">
              <button type="button" className="secondary" onClick={loadSyntheticForcePreset}>
                <FlaskConical size={13} /> Synthetic preset
              </button>
              <button type="button" onClick={() => void runEquilibrium()} disabled={equilibriumLoading}>
                <Play size={13} /> {equilibriumLoading ? "Solving…" : "Solve"}
              </button>
            </div>
            <p className="field-note">The preset is synthetic software-test data, not MSKU vehicle geometry.</p>
            {equilibriumError && <p className="solver-failure">{equilibriumError}</p>}
          </section>

          <section className="inspector-section">
            <div className="section-heading">
              <span className="eyebrow">VEHICLE LOAD TRANSFER</span>
              <StatusChip status={loadTransfer?.calculationStatus} />
            </div>
            <div className="parameter-grid">
              <NumberField label="Mass" unit="kg" value={vehicle.massKg} onChange={(massKg) => setVehicle({ ...vehicle, massKg })} />
              <NumberField label="Wheelbase" unit="m" value={vehicle.wheelbaseM} onChange={(wheelbaseM) => setVehicle({ ...vehicle, wheelbaseM })} />
              <NumberField label="CG from front" unit="m" value={vehicle.cgFromFrontAxleM} onChange={(cgFromFrontAxleM) => setVehicle({ ...vehicle, cgFromFrontAxleM })} />
              <NumberField label="CG height" unit="m" value={vehicle.cgHeightM} onChange={(cgHeightM) => setVehicle({ ...vehicle, cgHeightM })} />
              <NumberField label="Front track" unit="m" value={vehicle.frontTrackM} onChange={(frontTrackM) => setVehicle({ ...vehicle, frontTrackM })} />
              <NumberField label="Rear track" unit="m" value={vehicle.rearTrackM} onChange={(rearTrackM) => setVehicle({ ...vehicle, rearTrackM })} />
              <NumberField label="Longitudinal accel." unit="m/s²" value={vehicle.longitudinalAccelerationMps2} onChange={(longitudinalAccelerationMps2) => setVehicle({ ...vehicle, longitudinalAccelerationMps2 })} />
              <NumberField label="Lateral accel." unit="m/s²" value={vehicle.lateralAccelerationMps2} onChange={(lateralAccelerationMps2) => setVehicle({ ...vehicle, lateralAccelerationMps2 })} />
              <NumberField label="Front roll stiffness" unit="N·m/rad" value={vehicle.frontRollStiffnessNmPerRad} onChange={(frontRollStiffnessNmPerRad) => setVehicle({ ...vehicle, frontRollStiffnessNmPerRad })} />
              <NumberField label="Rear roll stiffness" unit="N·m/rad" value={vehicle.rearRollStiffnessNmPerRad} onChange={(rearRollStiffnessNmPerRad) => setVehicle({ ...vehicle, rearRollStiffnessNmPerRad })} />
            </div>
            <button type="button" className="wide-action" onClick={() => void runLoadTransfer()}>
              <Play size={13} /> Calculate load transfer
            </button>
            <p className="field-note">Current values are an editable synthetic demonstration preset.</p>
            {loadError && <p className="solver-failure">{loadError}</p>}
          </section>

          <section className="inspector-section">
            <div className="section-heading">
              <span className="eyebrow">ACTUATION SERIES</span>
              <StatusChip status={actuation?.calculationStatus} />
            </div>
            <label className="text-field">
              <span>Wheel travel samples (mm)</span>
              <input value={actuationInput.wheelTravelMm} onChange={(event) => setActuationInput({ ...actuationInput, wheelTravelMm: event.target.value })} />
            </label>
            <label className="text-field">
              <span>Spring length samples (mm)</span>
              <input value={actuationInput.springLengthMm} onChange={(event) => setActuationInput({ ...actuationInput, springLengthMm: event.target.value })} />
            </label>
            <div className="parameter-grid">
              <NumberField label="Reference length" unit="mm" value={actuationInput.referenceSpringLengthMm} onChange={(referenceSpringLengthMm) => setActuationInput({ ...actuationInput, referenceSpringLengthMm })} />
              <NumberField label="Spring rate" unit="N/mm" value={actuationInput.springRateNPerMm} onChange={(springRateNPerMm) => setActuationInput({ ...actuationInput, springRateNPerMm })} />
              <NumberField label="Preload" unit="N" value={actuationInput.preloadN} onChange={(preloadN) => setActuationInput({ ...actuationInput, preloadN })} />
            </div>
            <button type="button" className="wide-action" onClick={() => void runActuation()}>
              <Play size={13} /> Calculate motion ratio
            </button>
            <p className="field-note">Lengths require explicit CAD, solved rocker geometry, or measurement provenance.</p>
            {actuationError && <p className="solver-failure">{actuationError}</p>}
          </section>
        </aside>

        <main className="loads-results">
          <div className="loads-viewport-wrap">
            <SuspensionViewport
              pose={equilibrium?.pose}
              mode="loads"
              forceVectors={forceVectors}
            />
          </div>

          <div className="loads-dashboard">
            <section className="engineering-card force-card">
              <div className="section-heading">
                <span className="eyebrow">LINK AXIAL FORCES</span>
                <StatusChip status={equilibrium?.calculationStatus} />
              </div>
              {equilibrium?.memberForces.length ? (
                <div className="force-table-wrap">
                  <table className="force-table">
                    <thead><tr><th>Member</th><th>Axial force</th><th>State</th></tr></thead>
                    <tbody>
                      {equilibrium.memberForces.map((item) => (
                        <tr key={item.id}>
                          <td>{item.id}</td>
                          <td>{item.axialForceN.toFixed(2)} N</td>
                          <td>{item.state}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="diagnostic-empty">No accepted member-force solution.</p>}
              {equilibrium && (
                <dl className="solver-diagnostics compact">
                  <div><dt>Rank</dt><dd>{equilibrium.diagnostics.matrixRank} / {equilibrium.diagnostics.matrixColumns}</dd></div>
                  <div><dt>Condition</dt><dd>{equilibrium.diagnostics.conditionNumber?.toExponential(3) ?? "—"}</dd></div>
                  <div><dt>Force residual</dt><dd>{equilibrium.diagnostics.forceResidualNormN.toExponential(3)} N</dd></div>
                  <div><dt>Moment residual</dt><dd>{equilibrium.diagnostics.momentResidualNormNm.toExponential(3)} N·m</dd></div>
                  <div><dt>Solver</dt><dd>v{equilibrium.solverVersion}</dd></div>
                  <div><dt>Reference</dt><dd>{equilibrium.validationStatus.reference}</dd></div>
                  <div><dt>Physical</dt><dd>{equilibrium.validationStatus.physical}</dd></div>
                  <div><dt>Approval</dt><dd>{equilibrium.validationStatus.engineeringApproval}</dd></div>
                  <div title={equilibrium.inputProvenance.projectInputSha256}><dt>Input SHA-256</dt><dd>{equilibrium.inputProvenance.projectInputSha256.slice(0, 12)}…</dd></div>
                </dl>
              )}
              {equilibrium?.warnings.length ? <ul className="solver-warnings">{equilibrium.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
            </section>

            <section className="engineering-card">
              <div className="section-heading">
                <span className="eyebrow">NORMAL LOAD DISTRIBUTION</span>
                <StatusChip status={loadTransfer?.calculationStatus} />
              </div>
              {wheelLoadValues.length ? (
                <div className="wheel-load-chart">
                  {wheelLoadValues.map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <i style={{ height: `${Math.max(2, 100 * value / maximumWheelLoad)}%` }} />
                      <b>{value.toFixed(1)} N</b>
                    </div>
                  ))}
                </div>
              ) : <p className="diagnostic-empty">Wheel loads appear only when the model has sufficient inputs and remains physical.</p>}
              {loadTransfer && (
                <dl className="solver-diagnostics compact">
                  <div><dt>Front axle</dt><dd>{format(loadTransfer.axleLoads?.frontN)} N</dd></div>
                  <div><dt>Rear axle</dt><dd>{format(loadTransfer.axleLoads?.rearN)} N</dd></div>
                  <div><dt>Longitudinal transfer</dt><dd>{format(loadTransfer.longitudinalTransferN)} N</dd></div>
                  <div><dt>Force residual</dt><dd>{loadTransfer.forceResidualN?.toExponential(3) ?? "—"} N</dd></div>
                  <div><dt>Solver</dt><dd>v{loadTransfer.solverVersion}</dd></div>
                  <div><dt>Physical</dt><dd>{loadTransfer.validationStatus.physical}</dd></div>
                </dl>
              )}
              {loadTransfer?.warnings.length ? <ul className="solver-warnings">{loadTransfer.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
            </section>

            <section className="engineering-card actuation-card">
              <div className="section-heading">
                <span className="eyebrow">MOTION RATIO & WHEEL RATE</span>
                <StatusChip status={actuation?.calculationStatus} />
              </div>
              {actuationChart.length ? (
                <ResponsiveContainer width="100%" height={210}>
                  <LineChart data={actuationChart} margin={{ top: 10, right: 20, bottom: 8, left: 0 }}>
                    <CartesianGrid stroke="#252b36" strokeDasharray="2 4" />
                    <XAxis dataKey="travelMm" unit=" mm" tick={{ fill: "#727c8d", fontSize: 9 }} />
                    <YAxis yAxisId="ratio" tick={{ fill: "#727c8d", fontSize: 9 }} width={48} />
                    <YAxis yAxisId="rate" orientation="right" unit=" N/mm" tick={{ fill: "#727c8d", fontSize: 9 }} width={68} />
                    <Tooltip contentStyle={{ background: "#11151c", border: "1px solid #343c49", fontSize: 10 }} />
                    <Legend wrapperStyle={{ fontSize: 9 }} />
                    <Line yAxisId="ratio" dataKey="motionRatio" name="Motion ratio" stroke="#f43f5e" dot={false} isAnimationActive={false} />
                    <Line yAxisId="rate" dataKey="wheelRateNPerMm" name="Wheel rate" stroke="#60a5fa" dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <p className="diagnostic-empty">No supported actuation series has been calculated.</p>}
              {actuation && (
                <dl className="solver-diagnostics compact">
                  <div><dt>Solver</dt><dd>v{actuation.solverVersion}</dd></div>
                  <div><dt>Reference</dt><dd>{actuation.validationStatus.reference}</dd></div>
                  <div><dt>Physical</dt><dd>{actuation.validationStatus.physical}</dd></div>
                  <div><dt>Approval</dt><dd>{actuation.validationStatus.engineeringApproval}</dd></div>
                </dl>
              )}
              {actuation?.warnings.length ? <ul className="solver-warnings">{actuation.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
              <p className="model-assumption">MR = d(spring compression) / d(wheel bump). Damper force remains unavailable unless velocity is explicitly supplied.</p>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
