import {
  engineeringOptimizationRequestSchema,
  engineeringOptimizationResponseSchema,
  type BicycleSimulationRequest,
  type EngineeringOptimizationRequest,
  type EngineeringOptimizationResponse,
  type FullCarSimulationRequest,
  type OptimizationCandidate,
  type Project,
  type QuarterCarSimulationRequest,
  type Vec3,
} from "@msku/contracts";
import { AlertTriangle, CheckCircle2, Eye, Play, Save } from "lucide-react";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useWorkspace } from "../store/workspace";
import { SuspensionViewport } from "./SuspensionViewport";

type OptimizationModel = EngineeringOptimizationRequest["model"];
type VariableRow = { enabled: boolean; path: string; lowerBound: number; upperBound: number };

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const dynamicsSettings = {
  durationS: 0.5,
  outputSamples: 101,
  relativeTolerance: 1e-7,
  absoluteTolerance: 1e-9,
  maximumStepS: 0.005,
  method: "DOP853" as const,
};
const road = {
  kind: "smooth_bump" as const,
  amplitudeM: 0.003,
  startTimeS: 0.1,
  durationS: 0.12,
  frequencyHz: 1,
  sampleTimesS: [],
  sampleDisplacementsM: [],
};

const quarterCar: QuarterCarSimulationRequest = {
  dataClassification: "demonstration",
  sourceLabel: "Synthetic Phase 5 optimization preset",
  parameters: {
    sprungMassKg: 75,
    unsprungMassKg: 12,
    suspensionStiffnessNPerM: 30_000,
    suspensionDampingNsPerM: 1_800,
    tireStiffnessNPerM: 180_000,
    tireDampingNsPerM: 0,
    staticTireLoadN: 1_000,
  },
  road,
  initialState: {
    sprungDisplacementM: 0,
    sprungVelocityMps: 0,
    unsprungDisplacementM: 0,
    unsprungVelocityMps: 0,
  },
  settings: dynamicsSettings,
};

const fullCorner = {
  unsprungMassKg: 12,
  suspensionStiffnessNPerM: 30_000,
  suspensionDampingNsPerM: 1_800,
  tireStiffnessNPerM: 180_000,
  tireDampingNsPerM: 0,
  staticTireLoadN: 1_000,
};
const fullCar: FullCarSimulationRequest = {
  dataClassification: "demonstration",
  sourceLabel: "Synthetic Phase 5 optimization preset",
  parameters: {
    sprungMassKg: 300,
    pitchInertiaKgM2: 120,
    rollInertiaKgM2: 80,
    corners: [
      { ...fullCorner, xPositionM: 0.8, yPositionM: 0.6 },
      { ...fullCorner, xPositionM: 0.8, yPositionM: -0.6 },
      { ...fullCorner, xPositionM: -0.8, yPositionM: 0.6 },
      { ...fullCorner, xPositionM: -0.8, yPositionM: -0.6 },
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
  settings: dynamicsSettings,
};

const bicycle: BicycleSimulationRequest = {
  dataClassification: "demonstration",
  sourceLabel: "Synthetic Phase 5 optimization preset",
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
    amplitudeRad: 0.01,
    startTimeS: 0.1,
    riseTimeS: 0.08,
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
  settings: dynamicsSettings,
};

const objectiveOptions: Record<OptimizationModel, Array<{ id: string; label: string; normalization: number }>> = {
  kinematics: [
    { id: "bump_steer_rms_rad", label: "Bump steer RMS", normalization: 0.01 },
    { id: "camber_variation_rms_rad", label: "Camber variation RMS", normalization: 0.02 },
    { id: "roll_center_migration_rms_m", label: "Roll-centre migration RMS", normalization: 0.01 },
    { id: "maximum_abs_track_change_m", label: "Maximum track change", normalization: 0.01 },
  ],
  quarter_car: [
    { id: "sprung_acceleration_rms_mps2", label: "Sprung acceleration RMS", normalization: 1 },
    { id: "maximum_abs_suspension_travel_m", label: "Maximum suspension travel", normalization: 0.02 },
  ],
  full_car: [
    { id: "body_heave_acceleration_rms_mps2", label: "Body heave acceleration RMS", normalization: 1 },
    { id: "maximum_abs_suspension_travel_m", label: "Maximum suspension travel", normalization: 0.02 },
    { id: "maximum_abs_pitch_rad", label: "Maximum pitch", normalization: 0.02 },
    { id: "maximum_abs_roll_rad", label: "Maximum roll", normalization: 0.02 },
  ],
  bicycle: [
    { id: "final_yaw_rate_radps", label: "Target final yaw rate", normalization: 0.1 },
    { id: "maximum_abs_sideslip_rad", label: "Maximum sideslip", normalization: 0.05 },
    { id: "lateral_acceleration_rms_mps2", label: "Lateral acceleration RMS", normalization: 2 },
    { id: "final_lateral_acceleration_mps2", label: "Target final lateral acceleration", normalization: 2 },
  ],
};

function variablesFor(model: OptimizationModel, project: Project): VariableRow[] {
  const point = (id: string, axis: keyof Vec3) => project.suspension.hardpoints.find((item) => item.id === id)?.position[axis] ?? 0;
  if (model === "kinematics") return [
    { enabled: true, path: "hardpoints.tie_rod_inboard.y", lowerBound: point("tie_rod_inboard", "y") - 0.03, upperBound: point("tie_rod_inboard", "y") + 0.03 },
    { enabled: false, path: "hardpoints.tie_rod_inboard.z", lowerBound: point("tie_rod_inboard", "z") - 0.03, upperBound: point("tie_rod_inboard", "z") + 0.03 },
    { enabled: false, path: "hardpoints.uca_outboard.y", lowerBound: point("uca_outboard", "y") - 0.02, upperBound: point("uca_outboard", "y") + 0.02 },
  ];
  if (model === "quarter_car") return [
    { enabled: true, path: "parameters.suspensionStiffnessNPerM", lowerBound: 20_000, upperBound: 45_000 },
    { enabled: true, path: "parameters.suspensionDampingNsPerM", lowerBound: 800, upperBound: 3_000 },
  ];
  if (model === "full_car") return [
    { enabled: true, path: "parameters.corners.0.suspensionStiffnessNPerM", lowerBound: 20_000, upperBound: 45_000 },
    { enabled: true, path: "parameters.corners.0.suspensionDampingNsPerM", lowerBound: 800, upperBound: 3_000 },
  ];
  return [
    { enabled: true, path: "parameters.frontCorneringStiffnessNPerRad", lowerBound: 40_000, upperBound: 60_000 },
    { enabled: true, path: "parameters.rearCorneringStiffnessNPerRad", lowerBound: 40_000, upperBound: 60_000 },
  ];
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="numeric-field"><span>{label}</span><input type="number" step="any" value={value} onChange={(event) => onChange(Number(event.target.value))} /><em>SI</em></label>;
}

function StatusChip({ status }: { status?: string }) {
  const ok = status === "VERIFIED_NUMERICALLY";
  return <span className={`status-chip ${ok ? "ok" : status ? "error" : ""}`}>{ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}{status ?? "NOT RUN"}</span>;
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { detail?: unknown };
    return typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail ?? payload);
  } catch {
    return `HTTP ${response.status} ${response.statusText}`;
  }
}

const display = (value: number | null | undefined, digits = 5) => value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);

function candidateOverrides(project: Project, candidate: OptimizationCandidate | undefined): Record<string, Vec3> | undefined {
  if (!candidate) return undefined;
  const overrides = Object.fromEntries(project.suspension.hardpoints.map((item) => [item.id, { ...item.position }])) as Record<string, Vec3>;
  let changed = false;
  for (const [path, value] of Object.entries(candidate.variableValues)) {
    const parts = path.split(".");
    if (parts.length !== 3 || parts[0] !== "hardpoints" || !["x", "y", "z"].includes(parts[2])) continue;
    const point = overrides[parts[1]];
    if (!point) continue;
    point[parts[2] as keyof Vec3] = value;
    changed = true;
  }
  return changed ? overrides : undefined;
}

export function OptimizationWorkspace() {
  const project = useWorkspace((state) => state.project);
  const applyHardpoints = useWorkspace((state) => state.applyHardpointOverrides);
  const [model, setModel] = useState<OptimizationModel>("kinematics");
  const [variables, setVariables] = useState(() => variablesFor("kinematics", project));
  const [primary, setPrimary] = useState(objectiveOptions.kinematics[0].id);
  const [secondary, setSecondary] = useState(objectiveOptions.kinematics[1].id);
  const [multiObjective, setMultiObjective] = useState(true);
  const [targetValue, setTargetValue] = useState(0.09);
  const [maximumGenerations, setMaximumGenerations] = useState(40);
  const [populationMultiplier, setPopulationMultiplier] = useState(6);
  const [seed, setSeed] = useState(2307);
  const [result, setResult] = useState<EngineeringOptimizationResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [selectedPareto, setSelectedPareto] = useState(-1);
  const [preview, setPreview] = useState(true);

  const options = objectiveOptions[model];
  const selectedCandidate = selectedPareto >= 0 ? result?.paretoFront[selectedPareto] : result?.optimized ?? undefined;
  const overrides = useMemo(
    () => preview && model === "kinematics" ? candidateOverrides(project, selectedCandidate) : undefined,
    [model, preview, project, selectedCandidate],
  );

  const changeModel = (next: OptimizationModel) => {
    setModel(next);
    setVariables(variablesFor(next, project));
    setPrimary(objectiveOptions[next][0].id);
    setSecondary(objectiveOptions[next][1]?.id ?? objectiveOptions[next][0].id);
    setMultiObjective(objectiveOptions[next].length > 1);
    setResult(undefined);
    setError(undefined);
    setSelectedPareto(-1);
  };

  const updateVariable = (index: number, patch: Partial<VariableRow>) => setVariables((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));

  const run = async () => {
    setLoading(true);
    setError(undefined);
    setResult(undefined);
    try {
      const objectives = [primary, ...(multiObjective && secondary !== primary ? [secondary] : [])].map((id) => {
        const option = options.find((item) => item.id === id);
        if (!option) throw new Error(`Objective ${id} is unavailable for ${model}.`);
        const target = id === "final_yaw_rate_radps" || id === "final_lateral_acceleration_mps2";
        return {
          id,
          goal: target ? "target" as const : "minimize" as const,
          targetValue: target ? targetValue : null,
          weight: 1,
          normalization: option.normalization,
        };
      });
      const request: EngineeringOptimizationRequest = {
        model,
        designVariables: variables.filter((item) => item.enabled).map(({ path, lowerBound, upperBound }) => ({ path, lowerBound, upperBound })),
        objectives,
        constraints: {
          minimumLinkLengthM: 0.01,
          maximumAbsSuspensionTravelM: model === "quarter_car" || model === "full_car" ? 0.04 : null,
          requireWheelContact: model === "quarter_car" || model === "full_car",
          requireStableHandling: model === "bicycle",
        },
        settings: {
          seed,
          maximumGenerations,
          populationMultiplier,
          convergenceTolerance: 1e-5,
          paretoPoints: multiObjective ? 5 : 0,
          sensitivityStepFraction: 1e-4,
        },
        project: model === "kinematics" ? project : null,
        kinematicsSweep: model === "kinematics" ? { startTravelM: -0.03, endTravelM: 0.03, steps: 13 } : null,
        kinematicsSolver: model === "kinematics" ? { residualToleranceM: 1e-8, maxFunctionEvaluations: 500 } : null,
        quarterCar: model === "quarter_car" ? quarterCar : null,
        fullCar: model === "full_car" ? fullCar : null,
        bicycle: model === "bicycle" ? bicycle : null,
      };
      const validated = engineeringOptimizationRequestSchema.parse(request);
      const response = await fetch(`${apiBaseUrl}/api/v1/optimization/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
      });
      if (!response.ok) throw new Error(await readError(response));
      const next = engineeringOptimizationResponseSchema.parse(await response.json());
      setResult(next);
      if (next.calculationStatus !== "VERIFIED_NUMERICALLY") setError(next.diagnostics.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Optimization failed.");
    } finally {
      setLoading(false);
    }
  };

  const comparisonMetrics = result?.baseline && selectedCandidate ? Object.keys(result.baseline.metrics).map((id) => ({
    id,
    baseline: result.baseline?.metrics[id],
    candidate: selectedCandidate.metrics[id],
  })) : [];
  const paretoKeys = result?.paretoFront[0] ? Object.keys(result.paretoFront[0].metrics) : [];
  const paretoData = result?.paretoFront.map((candidate, index) => ({
    index,
    x: candidate.metrics[paretoKeys[0]],
    y: candidate.metrics[paretoKeys[1]],
  })) ?? [];

  return <div className="optimization-workspace">
    <header className="optimization-toolbar">
      <div><span className="eyebrow">PHASE 5 · ENGINEERING OPTIMIZATION</span><strong>Bounded deterministic design search</strong></div>
      <span>Verified numerical objectives · physically unvalidated candidates</span>
      <StatusChip status={result?.calculationStatus} />
    </header>
    <div className="optimization-content">
      <aside className="optimization-inputs">
        <section className="inspector-section">
          <div className="section-heading"><span className="eyebrow">MODEL & OBJECTIVES</span></div>
          <label className="select-field"><span>Verified model</span><select value={model} onChange={(event) => changeModel(event.target.value as OptimizationModel)}><option value="kinematics">Suspension kinematics</option><option value="quarter_car">2DOF quarter car</option><option value="full_car">7DOF full car</option><option value="bicycle">Planar bicycle</option></select></label>
          <label className="select-field"><span>Primary objective</span><select value={primary} onChange={(event) => setPrimary(event.target.value)}>{options.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label className="checkbox-field"><input type="checkbox" checked={multiObjective} onChange={(event) => setMultiObjective(event.target.checked)} /><span>Weighted multi-objective + Pareto</span></label>
          {multiObjective && <label className="select-field"><span>Secondary objective</span><select value={secondary} onChange={(event) => setSecondary(event.target.value)}>{options.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
          {(primary.startsWith("final_") || secondary.startsWith("final_")) && <NumberField label="Target value" value={targetValue} onChange={setTargetValue} />}
          <p className="field-note">Weights are 1.0. Each objective is divided by its documented nonzero SI normalization before scalarization.</p>
        </section>

        <section className="inspector-section">
          <div className="section-heading"><span className="eyebrow">DESIGN VARIABLES & BOUNDS</span><span className="unit-chip">SI</span></div>
          {variables.map((variable, index) => <div className="optimization-variable" key={variable.path}>
            <label className="checkbox-field"><input type="checkbox" checked={variable.enabled} onChange={(event) => updateVariable(index, { enabled: event.target.checked })} /><span>{variable.path}</span></label>
            <div className="parameter-grid"><NumberField label="Lower" value={variable.lowerBound} onChange={(value) => updateVariable(index, { lowerBound: value })} /><NumberField label="Upper" value={variable.upperBound} onChange={(value) => updateVariable(index, { upperBound: value })} /></div>
          </div>)}
        </section>

        <section className="inspector-section">
          <div className="section-heading"><span className="eyebrow">METHOD & CONSTRAINTS</span></div>
          <div className="parameter-grid"><NumberField label="Seed" value={seed} onChange={(value) => setSeed(Math.round(value))} /><NumberField label="Generations" value={maximumGenerations} onChange={(value) => setMaximumGenerations(Math.round(value))} /><NumberField label="Population ×N" value={populationMultiplier} onChange={(value) => setPopulationMultiplier(Math.round(value))} /></div>
          <p className="field-note">SciPy differential evolution; fixed seed, serial evaluation, no polishing. Geometry validity, solver convergence, 10 mm minimum link length, model domain, stability, contact, and 40 mm ride-travel constraints are enforced where applicable.</p>
          <button className="wide-action" type="button" disabled={loading || !variables.some((item) => item.enabled)} onClick={() => void run()}><Play size={13} />{loading ? "Evaluating bounded population…" : "Run optimization"}</button>
          {error && <p className="solver-failure">{error}</p>}
        </section>
      </aside>

      <main className="optimization-results">
        <section className="optimization-preview">
          {model === "kinematics" ? <SuspensionViewport mode="optimization" hardpointOverrides={overrides} /> : <div className="optimization-no-geometry"><span className="eyebrow">PARAMETRIC MODEL</span><strong>{model.replaceAll("_", " ").toUpperCase()}</strong><p>Candidate inspection uses calculated metrics and parameter values. No unrelated geometry is fabricated for this model.</p></div>}
          <div className="candidate-panel">
            <div className="section-heading"><span className="eyebrow">CANDIDATE INSPECTION</span><StatusChip status={result?.calculationStatus} /></div>
            <label className="select-field"><span>Candidate</span><select value={selectedPareto} disabled={!result?.optimized} onChange={(event) => setSelectedPareto(Number(event.target.value))}><option value={-1}>Weighted optimum</option>{result?.paretoFront.map((_, index) => <option value={index} key={index}>Pareto {index + 1}</option>)}</select></label>
            {selectedCandidate ? <dl className="candidate-values">{Object.entries(selectedCandidate.variableValues).map(([path, value]) => <div key={path}><dt>{path}</dt><dd>{display(value, 7)}</dd></div>)}</dl> : <p className="diagnostic-empty">Run an optimization to inspect a feasible candidate.</p>}
            {model === "kinematics" && <div className="candidate-actions"><button type="button" disabled={!overrides} onClick={() => setPreview((value) => !value)}><Eye size={13} />{preview ? "Hide preview" : "Preview candidate"}</button><button type="button" disabled={!overrides || result?.calculationStatus !== "VERIFIED_NUMERICALLY"} onClick={() => overrides && applyHardpoints(overrides)}><Save size={13} />Apply to active project</button></div>}
            <p className="field-note">Preview never mutates the project. Apply is explicit and remains physically unvalidated.</p>
          </div>
        </section>

        <section className="optimization-charts">
          <div className="chart-card"><div className="chart-heading"><span>CONVERGENCE</span><b>normalized weighted objective</b></div><ResponsiveContainer width="100%" height="100%"><LineChart data={result?.convergence ?? []}><CartesianGrid stroke="#1f2630" vertical={false} /><XAxis dataKey="generation" stroke="#667080" tick={{ fontSize: 8 }} /><YAxis stroke="#667080" tick={{ fontSize: 8 }} /><Tooltip contentStyle={{ background: "#11151b", border: "1px solid #303744", fontSize: 9 }} /><Line dataKey="bestWeightedObjective" name="Best feasible" dot={false} stroke="#f43f5e" /></LineChart></ResponsiveContainer></div>
          <div className="chart-card"><div className="chart-heading"><span>PARETO FRONT</span><b>{paretoKeys.length >= 2 ? `${paretoKeys[0]} vs ${paretoKeys[1]}` : "requires two objectives"}</b></div><ResponsiveContainer width="100%" height="100%"><ScatterChart><CartesianGrid stroke="#1f2630" /><XAxis dataKey="x" type="number" stroke="#667080" tick={{ fontSize: 8 }} /><YAxis dataKey="y" type="number" stroke="#667080" tick={{ fontSize: 8 }} /><Tooltip contentStyle={{ background: "#11151b", border: "1px solid #303744", fontSize: 9 }} /><Scatter data={paretoData} fill="#f43f5e" /></ScatterChart></ResponsiveContainer></div>
        </section>

        <section className="optimization-detail">
          <div className="engineering-card"><div className="section-heading"><span className="eyebrow">BASELINE VS CANDIDATE</span></div>{comparisonMetrics.length ? <table className="comparison-table"><thead><tr><th>Metric</th><th>Baseline</th><th>Candidate</th></tr></thead><tbody>{comparisonMetrics.map((item) => <tr key={item.id}><td>{item.id}</td><td>{display(item.baseline)}</td><td>{display(item.candidate)}</td></tr>)}</tbody></table> : <p className="diagnostic-empty">No accepted candidate.</p>}</div>
          <div className="engineering-card"><div className="section-heading"><span className="eyebrow">LOCAL SENSITIVITY</span></div>{result?.sensitivities.length ? <dl className="candidate-values">{result.sensitivities.map((item) => <div key={`${item.variablePath}-${item.metricId}`}><dt>{item.variablePath} → {item.metricId}</dt><dd>{display(item.derivative, 4)} · {item.method}</dd></div>)}</dl> : <p className="diagnostic-empty">No finite-difference sensitivity.</p>}</div>
          <div className="engineering-card"><div className="section-heading"><span className="eyebrow">QUALITY & WARNINGS</span></div>{result ? <dl className="solver-diagnostics compact"><div><dt>Numerical</dt><dd>{result.validationStatus.numerical}</dd></div><div><dt>Reference</dt><dd>{result.validationStatus.reference}</dd></div><div><dt>Physical</dt><dd>{result.validationStatus.physical}</dd></div><div><dt>Approval</dt><dd>{result.validationStatus.engineeringApproval}</dd></div><div><dt>Evaluations</dt><dd>{result.diagnostics.evaluations}</dd></div><div><dt>Rejected</dt><dd>{result.diagnostics.rejectedEvaluations}</dd></div><div><dt>Seed</dt><dd>{result.diagnostics.seed}</dd></div></dl> : <p className="diagnostic-empty">No run diagnostics.</p>}{result?.warnings.length ? <ul className="solver-warnings">{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}</div>
        </section>
      </main>
    </div>
  </div>;
}
