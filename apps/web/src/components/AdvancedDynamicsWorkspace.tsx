import {
  bicycleSimulationRequestSchema,
  bicycleSimulationResponseSchema,
  fullCarSimulationRequestSchema,
  fullCarSimulationResponseSchema,
  type BicycleSimulationRequest,
  type BicycleSimulationResponse,
  type FullCarSimulationRequest,
  type FullCarSimulationResponse,
} from "@msku/contracts";
import { AlertTriangle, CheckCircle2, Play } from "lucide-react";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line as ChartLine,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type DynamicsModel = "quarter_car" | "full_car" | "bicycle";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const settings = {
  durationS: 1.5,
  outputSamples: 301,
  relativeTolerance: 1e-8,
  absoluteTolerance: 1e-10,
  maximumStepS: 0.002,
  method: "DOP853" as const,
};
const road = {
  kind: "smooth_bump" as const,
  amplitudeM: 0.005,
  startTimeS: 0.2,
  durationS: 0.15,
  frequencyHz: 1,
  sampleTimesS: [],
  sampleDisplacementsM: [],
};
const cornerBase = {
  unsprungMassKg: 12,
  suspensionStiffnessNPerM: 30_000,
  suspensionDampingNsPerM: 1_800,
  tireStiffnessNPerM: 180_000,
  tireDampingNsPerM: 0,
  staticTireLoadN: 1_000,
};

const initialFullCarRequest: FullCarSimulationRequest = {
  dataClassification: "demonstration",
  sourceLabel: "Synthetic Phase 5 symmetric full-car preset",
  parameters: {
    sprungMassKg: 300,
    pitchInertiaKgM2: 120,
    rollInertiaKgM2: 80,
    corners: [
      { ...cornerBase, xPositionM: 0.8, yPositionM: 0.6 },
      { ...cornerBase, xPositionM: 0.8, yPositionM: -0.6 },
      { ...cornerBase, xPositionM: -0.8, yPositionM: 0.6 },
      { ...cornerBase, xPositionM: -0.8, yPositionM: -0.6 },
    ],
  },
  roadProfiles: [road, road, road, road],
  initialState: {
    bodyHeaveM: 0,
    bodyHeaveVelocityMps: 0,
    pitchRad: 0,
    pitchRateRadps: 0,
    rollRad: 0,
    rollRateRadps: 0,
    unsprungDisplacementsM: [0, 0, 0, 0],
    unsprungVelocitiesMps: [0, 0, 0, 0],
  },
  settings,
};

const initialBicycleRequest: BicycleSimulationRequest = {
  dataClassification: "demonstration",
  sourceLabel: "Synthetic Phase 5 neutral-steer bicycle preset",
  parameters: {
    massKg: 300,
    yawInertiaKgM2: 150,
    cgToFrontAxleM: 0.8,
    cgToRearAxleM: 0.8,
    frontCorneringStiffnessNPerRad: 50_000,
    rearCorneringStiffnessNPerRad: 50_000,
    speedMps: 15,
  },
  steering: {
    kind: "smooth_step",
    amplitudeRad: 0.02,
    startTimeS: 0.2,
    riseTimeS: 0.1,
    frequencyHz: 1,
    sampleTimesS: [],
    sampleAnglesRad: [],
  },
  initialState: { lateralVelocityMps: 0, yawRateRadps: 0 },
  domainLimits: {
    maximumAbsSteeringRad: 0.15,
    maximumAbsSideslipRad: 0.15,
    maximumAbsTireSlipRad: 0.15,
  },
  settings,
};

function NumberField({ label, unit, value, onChange }: {
  label: string;
  unit: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return <label className="numeric-field"><span>{label}</span><input type="number" step="any" value={value} onChange={(event) => onChange(Number(event.target.value))} /><em>{unit}</em></label>;
}

function StatusChip({ status }: { status: string | undefined }) {
  const accepted = status === "VERIFIED_NUMERICALLY";
  return <span className={`status-chip ${accepted ? "ok" : status ? "error" : ""}`}>{accepted ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}{status ?? "NOT RUN"}</span>;
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { detail?: unknown };
    return typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail ?? payload);
  } catch {
    return `HTTP ${response.status} ${response.statusText}`;
  }
}

const display = (value: number | null | undefined, digits = 4): string =>
  value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);

export function AdvancedDynamicsWorkspace({ model, onModelChange }: {
  model: Exclude<DynamicsModel, "quarter_car">;
  onModelChange: (model: DynamicsModel) => void;
}) {
  const [fullRequest, setFullRequest] = useState(initialFullCarRequest);
  const [bicycleRequest, setBicycleRequest] = useState(initialBicycleRequest);
  const [result, setResult] = useState<FullCarSimulationResponse | BicycleSimulationResponse>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [sampleIndex, setSampleIndex] = useState(0);

  const isFullCar = model === "full_car";
  const fullResult = result?.modelName === "linear_full_car_7dof" ? result : undefined;
  const bicycleResult = result?.modelName === "linear_planar_bicycle" ? result : undefined;
  const sampleCount = result?.samples.length ?? 0;
  const chartData = useMemo<Array<Record<string, number>>>(() => {
    if (fullResult) return fullResult.samples.map((sample) => ({
      timeS: sample.timeS,
      heaveMm: sample.bodyHeaveM * 1_000,
      pitchMrad: sample.pitchRad * 1_000,
      rollMrad: sample.rollRad * 1_000,
      frontLeftTravelMm: sample.suspensionTravelsM[0] * 1_000,
      rearLeftTravelMm: sample.suspensionTravelsM[2] * 1_000,
    }));
    return bicycleResult?.samples.map((sample) => ({
      timeS: sample.timeS,
      yawRate: sample.yawRateRadps,
      sideslipMrad: sample.sideslipRad * 1_000,
      lateralAcceleration: sample.lateralAccelerationMps2,
      frontSlipMrad: sample.frontSlipAngleRad * 1_000,
      rearSlipMrad: sample.rearSlipAngleRad * 1_000,
    })) ?? [];
  }, [fullResult, bicycleResult]);

  const updateFullParameter = (key: "sprungMassKg" | "pitchInertiaKgM2" | "rollInertiaKgM2", value: number) =>
    setFullRequest((current) => ({ ...current, parameters: { ...current.parameters, [key]: value } }));
  const updateAllCorners = (
    key: "suspensionStiffnessNPerM" | "suspensionDampingNsPerM" | "tireStiffnessNPerM",
    value: number,
  ) => setFullRequest((current) => ({
    ...current,
    parameters: {
      ...current.parameters,
      corners: current.parameters.corners.map((corner) => ({ ...corner, [key]: value })),
    },
  }));
  const updateBicycleParameter = (key: keyof BicycleSimulationRequest["parameters"], value: number) =>
    setBicycleRequest((current) => ({ ...current, parameters: { ...current.parameters, [key]: value } }));

  const run = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const request = isFullCar
        ? fullCarSimulationRequestSchema.parse(fullRequest)
        : bicycleSimulationRequestSchema.parse(bicycleRequest);
      const endpoint = isFullCar ? "full-car" : "bicycle";
      const response = await fetch(`${apiBaseUrl}/api/v1/dynamics/${endpoint}/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error(await readError(response));
      const payload: unknown = await response.json();
      const next = isFullCar
        ? fullCarSimulationResponseSchema.parse(payload)
        : bicycleSimulationResponseSchema.parse(payload);
      setResult(next);
      setSampleIndex(0);
      if (next.calculationStatus !== "VERIFIED_NUMERICALLY") setError(next.diagnostics.message);
    } catch (reason) {
      setResult(undefined);
      setError(reason instanceof Error ? reason.message : "Dynamics simulation failed.");
    } finally {
      setLoading(false);
    }
  };

  const currentFull = fullResult?.samples[sampleIndex];
  const currentBicycle = bicycleResult?.samples[sampleIndex];
  const status = result?.calculationStatus;

  return <div className="dynamics-workspace">
    <header className="dynamics-toolbar">
      <div><span className="eyebrow">PHASE 5 · VERIFIED LINEAR DYNAMICS</span><strong>{isFullCar ? "7DOF full-car ride" : "Planar bicycle handling"}</strong></div>
      <span>Calculated SI response · physically unvalidated</span>
    </header>
    <div className="dynamics-content">
      <aside className="dynamics-inputs">
        <section className="inspector-section">
          <div className="section-heading"><span className="eyebrow">MODEL SELECTION</span><StatusChip status={status} /></div>
          <label className="select-field"><span>Dynamics model</span><select aria-label="Dynamics model" value={model} onChange={(event) => { setResult(undefined); onModelChange(event.target.value as DynamicsModel); }}><option value="quarter_car">2DOF quarter car</option><option value="full_car">7DOF full-car ride</option><option value="bicycle">Planar bicycle handling</option></select></label>
          <p className="field-note">These are deterministic linear engineering models, not inferred animation. Inputs use SI units and outputs include numerical quality state.</p>
        </section>

        {isFullCar ? <>
          <section className="inspector-section">
            <div className="section-heading"><span className="eyebrow">BODY & FOUR CORNERS</span><span className="unit-chip">SI</span></div>
            <div className="parameter-grid">
              <NumberField label="Sprung mass" unit="kg" value={fullRequest.parameters.sprungMassKg} onChange={(value) => updateFullParameter("sprungMassKg", value)} />
              <NumberField label="Pitch inertia" unit="kg·m²" value={fullRequest.parameters.pitchInertiaKgM2} onChange={(value) => updateFullParameter("pitchInertiaKgM2", value)} />
              <NumberField label="Roll inertia" unit="kg·m²" value={fullRequest.parameters.rollInertiaKgM2} onChange={(value) => updateFullParameter("rollInertiaKgM2", value)} />
              <NumberField label="Corner spring" unit="N/m" value={fullRequest.parameters.corners[0].suspensionStiffnessNPerM} onChange={(value) => updateAllCorners("suspensionStiffnessNPerM", value)} />
              <NumberField label="Corner damping" unit="N·s/m" value={fullRequest.parameters.corners[0].suspensionDampingNsPerM} onChange={(value) => updateAllCorners("suspensionDampingNsPerM", value)} />
              <NumberField label="Tire stiffness" unit="N/m" value={fullRequest.parameters.corners[0].tireStiffnessNPerM} onChange={(value) => updateAllCorners("tireStiffnessNPerM", value)} />
            </div>
            <p className="field-note">Current editor applies symmetric corner properties. The request still carries four independent corner positions, masses, roads, springs, dampers, tires, and static loads.</p>
          </section>
          <section className="inspector-section">
            <div className="section-heading"><span className="eyebrow">ROAD & INTEGRATION</span></div>
            <div className="parameter-grid">
              <NumberField label="All-wheel bump" unit="mm" value={fullRequest.roadProfiles[0].amplitudeM * 1_000} onChange={(value) => setFullRequest((current) => ({ ...current, roadProfiles: current.roadProfiles.map((profile) => ({ ...profile, amplitudeM: value / 1_000 })) }))} />
              <NumberField label="Duration" unit="s" value={fullRequest.settings.durationS} onChange={(value) => setFullRequest((current) => ({ ...current, settings: { ...current.settings, durationS: value } }))} />
            </div>
          </section>
        </> : <>
          <section className="inspector-section">
            <div className="section-heading"><span className="eyebrow">VEHICLE & TIRES</span><span className="unit-chip">SI</span></div>
            <div className="parameter-grid">
              <NumberField label="Mass" unit="kg" value={bicycleRequest.parameters.massKg} onChange={(value) => updateBicycleParameter("massKg", value)} />
              <NumberField label="Yaw inertia" unit="kg·m²" value={bicycleRequest.parameters.yawInertiaKgM2} onChange={(value) => updateBicycleParameter("yawInertiaKgM2", value)} />
              <NumberField label="CG to front" unit="m" value={bicycleRequest.parameters.cgToFrontAxleM} onChange={(value) => updateBicycleParameter("cgToFrontAxleM", value)} />
              <NumberField label="CG to rear" unit="m" value={bicycleRequest.parameters.cgToRearAxleM} onChange={(value) => updateBicycleParameter("cgToRearAxleM", value)} />
              <NumberField label="Front Cα" unit="N/rad" value={bicycleRequest.parameters.frontCorneringStiffnessNPerRad} onChange={(value) => updateBicycleParameter("frontCorneringStiffnessNPerRad", value)} />
              <NumberField label="Rear Cα" unit="N/rad" value={bicycleRequest.parameters.rearCorneringStiffnessNPerRad} onChange={(value) => updateBicycleParameter("rearCorneringStiffnessNPerRad", value)} />
              <NumberField label="Speed" unit="m/s" value={bicycleRequest.parameters.speedMps} onChange={(value) => updateBicycleParameter("speedMps", value)} />
              <NumberField label="Steer amplitude" unit="mrad" value={bicycleRequest.steering.amplitudeRad * 1_000} onChange={(value) => setBicycleRequest((current) => ({ ...current, steering: { ...current.steering, amplitudeRad: value / 1_000 } }))} />
            </div>
          </section>
          <section className="inspector-section">
            <div className="section-heading"><span className="eyebrow">LINEAR DOMAIN LIMITS</span></div>
            <div className="parameter-grid">
              <NumberField label="Max steering" unit="mrad" value={bicycleRequest.domainLimits.maximumAbsSteeringRad * 1_000} onChange={(value) => setBicycleRequest((current) => ({ ...current, domainLimits: { ...current.domainLimits, maximumAbsSteeringRad: value / 1_000 } }))} />
              <NumberField label="Max sideslip" unit="mrad" value={bicycleRequest.domainLimits.maximumAbsSideslipRad * 1_000} onChange={(value) => setBicycleRequest((current) => ({ ...current, domainLimits: { ...current.domainLimits, maximumAbsSideslipRad: value / 1_000 } }))} />
              <NumberField label="Max tire slip" unit="mrad" value={bicycleRequest.domainLimits.maximumAbsTireSlipRad * 1_000} onChange={(value) => setBicycleRequest((current) => ({ ...current, domainLimits: { ...current.domainLimits, maximumAbsTireSlipRad: value / 1_000 } }))} />
            </div>
          </section>
        </>}
        <section className="inspector-section">
          <label className="text-field"><span>Input source / provenance</span><input aria-label="Input source" value={isFullCar ? fullRequest.sourceLabel : bicycleRequest.sourceLabel} onChange={(event) => isFullCar ? setFullRequest({ ...fullRequest, sourceLabel: event.target.value }) : setBicycleRequest({ ...bicycleRequest, sourceLabel: event.target.value })} /></label>
          <button className="wide-action" type="button" disabled={loading} onClick={() => void run()}><Play size={13} />{loading ? "Integrating…" : "Run simulation"}</button>
          {error && <p className="solver-failure">{error}</p>}
        </section>
      </aside>

      <main className="dynamics-results">
        <section className="dynamics-visual advanced-dynamics-summary">
          <div className="engineering-card">
            <div className="section-heading"><span className="eyebrow">CALCULATED SAMPLE</span><StatusChip status={status} /></div>
            <input aria-label="Simulation time" type="range" min={0} max={Math.max(0, sampleCount - 1)} value={sampleIndex} disabled={sampleCount === 0} onChange={(event) => setSampleIndex(Number(event.target.value))} />
            {currentFull ? <dl className="instant-values"><div><dt>Time</dt><dd>{display(currentFull.timeS, 3)} s</dd></div><div><dt>Heave</dt><dd>{display(currentFull.bodyHeaveM * 1_000, 3)} mm</dd></div><div><dt>Pitch</dt><dd>{display(currentFull.pitchRad * 1_000, 3)} mrad</dd></div><div><dt>Roll</dt><dd>{display(currentFull.rollRad * 1_000, 3)} mrad</dd></div><div><dt>FL contact</dt><dd>{display(currentFull.totalTireContactForcesN[0], 1)} N</dd></div></dl> : currentBicycle ? <dl className="instant-values"><div><dt>Time</dt><dd>{display(currentBicycle.timeS, 3)} s</dd></div><div><dt>Yaw rate</dt><dd>{display(currentBicycle.yawRateRadps, 4)} rad/s</dd></div><div><dt>Sideslip</dt><dd>{display(currentBicycle.sideslipRad * 1_000, 3)} mrad</dd></div><div><dt>Lateral accel.</dt><dd>{display(currentBicycle.lateralAccelerationMps2, 3)} m/s²</dd></div></dl> : <p className="diagnostic-empty">Run the model to inspect calculated states.</p>}
          </div>
          <div className="engineering-card"><div className="section-heading"><span className="eyebrow">MODEL DEFINITION</span></div><p className="model-assumption">{isFullCar ? "Seven DOF: sprung-body heave, pitch, roll, and four independent unsprung vertical coordinates. Corner body displacement is z − xθ + yφ in the documented vehicle frame." : "Two states: lateral velocity and yaw rate at constant longitudinal speed. Linear axle cornering stiffness and small-angle tire slip relationships are enforced."}</p><p className="field-note">No physical validation or engineering approval is implied.</p></div>
        </section>

        <section className="dynamics-charts">
          <div className="chart-card"><div className="chart-heading"><span>{isFullCar ? "BODY RESPONSE" : "HANDLING RESPONSE"}</span><b>{isFullCar ? "mm / mrad" : "SI / mrad"}</b></div><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid stroke="#1f2630" vertical={false} /><XAxis dataKey="timeS" stroke="#667080" tick={{ fontSize: 8 }} /><YAxis stroke="#667080" tick={{ fontSize: 8 }} /><Tooltip contentStyle={{ background: "#11151b", border: "1px solid #303744", fontSize: 9 }} /><Legend wrapperStyle={{ fontSize: 8 }} />{isFullCar ? <><ChartLine dot={false} dataKey="heaveMm" name="Heave mm" stroke="#f43f5e" /><ChartLine dot={false} dataKey="pitchMrad" name="Pitch mrad" stroke="#f59e0b" /><ChartLine dot={false} dataKey="rollMrad" name="Roll mrad" stroke="#60a5fa" /></> : <><ChartLine dot={false} dataKey="yawRate" name="Yaw rad/s" stroke="#f43f5e" /><ChartLine dot={false} dataKey="sideslipMrad" name="Sideslip mrad" stroke="#60a5fa" /><ChartLine dot={false} dataKey="lateralAcceleration" name="Lateral m/s²" stroke="#4ade80" /></>}</LineChart></ResponsiveContainer></div>
          <div className="chart-card"><div className="chart-heading"><span>{isFullCar ? "SUSPENSION TRAVEL" : "TIRE SLIP ANGLES"}</span><b>{isFullCar ? "mm" : "mrad"}</b></div><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid stroke="#1f2630" vertical={false} /><XAxis dataKey="timeS" stroke="#667080" tick={{ fontSize: 8 }} /><YAxis stroke="#667080" tick={{ fontSize: 8 }} /><Tooltip contentStyle={{ background: "#11151b", border: "1px solid #303744", fontSize: 9 }} /><Legend wrapperStyle={{ fontSize: 8 }} />{isFullCar ? <><ChartLine dot={false} dataKey="frontLeftTravelMm" name="FL travel" stroke="#f43f5e" /><ChartLine dot={false} dataKey="rearLeftTravelMm" name="RL travel" stroke="#f59e0b" /></> : <><ChartLine dot={false} dataKey="frontSlipMrad" name="Front slip" stroke="#f43f5e" /><ChartLine dot={false} dataKey="rearSlipMrad" name="Rear slip" stroke="#f59e0b" /></>}</LineChart></ResponsiveContainer></div>
        </section>

        <section className="dynamics-diagnostics">
          <div className="engineering-card"><div className="section-heading"><span className="eyebrow">CALCULATION QUALITY</span></div>{result ? <dl className="solver-diagnostics compact"><div><dt>Numerical</dt><dd>{result.validationStatus.numerical}</dd></div><div><dt>Reference</dt><dd>{result.validationStatus.reference}</dd></div><div><dt>Physical</dt><dd>{result.validationStatus.physical}</dd></div><div><dt>Approval</dt><dd>{result.validationStatus.engineeringApproval}</dd></div><div><dt>Solver</dt><dd>v{result.solverVersion}</dd></div><div title={result.inputProvenance.inputSha256}><dt>Input SHA-256</dt><dd>{result.inputProvenance.inputSha256.slice(0, 12)}…</dd></div></dl> : <p className="diagnostic-empty">No simulation result.</p>}</div>
          <div className="engineering-card"><div className="section-heading"><span className="eyebrow">NUMERICAL DIAGNOSTICS</span></div>{fullResult ? <dl className="solver-diagnostics compact"><div><dt>Method</dt><dd>{fullResult.diagnostics.integrationMethod}</dd></div><div><dt>Accepted steps</dt><dd>{fullResult.diagnostics.acceptedSteps}</dd></div><div><dt>Contact accepted</dt><dd>{String(fullResult.diagnostics.contactAccepted)}</dd></div><div><dt>Mass condition</dt><dd>{display(fullResult.diagnostics.massMatrixCondition, 2)}</dd></div><div><dt>Energy residual</dt><dd>{display(fullResult.diagnostics.energyBalanceResidualJ, 6)} J</dd></div><div><dt>Modes</dt><dd>{fullResult.naturalFrequenciesHz?.map((value) => value.toFixed(2)).join(" / ") ?? "—"} Hz</dd></div></dl> : bicycleResult ? <dl className="solver-diagnostics compact"><div><dt>Method</dt><dd>{bicycleResult.diagnostics.integrationMethod}</dd></div><div><dt>Stable</dt><dd>{String(bicycleResult.diagnostics.stable)}</dd></div><div><dt>Domain accepted</dt><dd>{String(bicycleResult.diagnostics.domainAccepted)}</dd></div><div><dt>Understeer K</dt><dd>{display(bicycleResult.diagnostics.understeerCoefficientS2PerM, 7)} s²/m</dd></div><div><dt>Characteristic speed</dt><dd>{display(bicycleResult.diagnostics.characteristicSpeedMps, 3)} m/s</dd></div><div><dt>Critical speed</dt><dd>{display(bicycleResult.diagnostics.criticalSpeedMps, 3)} m/s</dd></div></dl> : <p className="diagnostic-empty">No diagnostics.</p>}</div>
          <div className="engineering-card"><div className="section-heading"><span className="eyebrow">WARNINGS & LIMITATIONS</span></div>{result?.warnings.length ? <ul className="solver-warnings">{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : <p className="model-assumption">Linear small-motion model. Nonlinear tires, compliance, impacts, saturation, load sensitivity, aerodynamics, and measured-vehicle correlation are outside this calculation.</p>}</div>
        </section>
      </main>
    </div>
  </div>;
}
