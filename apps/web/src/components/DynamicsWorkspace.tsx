import { Line, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import {
  quarterCarSimulationRequestSchema,
  quarterCarSimulationResponseSchema,
  type QuarterCarSample,
  type QuarterCarSimulationRequest,
  type QuarterCarSimulationResponse,
} from "@msku/contracts";
import { AlertTriangle, CheckCircle2, Download, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line as ChartLine,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { API_BASE_URL } from "../lib/api";
import { uiStatus } from "../lib/uiText";
import { AdvancedDynamicsWorkspace, type DynamicsModel } from "./AdvancedDynamicsWorkspace";

const apiBaseUrl = API_BASE_URL;
const displacementVisualScale = 8;

const initialRequest: QuarterCarSimulationRequest = {
  dataClassification: "demonstration",
  sourceLabel: "Sentetik Faz 4 çeyrek araç gösterim ön ayarı",
  parameters: {
    sprungMassKg: 75,
    unsprungMassKg: 12,
    suspensionStiffnessNPerM: 30_000,
    suspensionDampingNsPerM: 1_800,
    tireStiffnessNPerM: 180_000,
    tireDampingNsPerM: 0,
    staticTireLoadN: 1_000,
  },
  road: {
    kind: "smooth_bump",
    amplitudeM: 0.01,
    startTimeS: 0.2,
    durationS: 0.15,
    frequencyHz: 1,
    sampleTimesS: [],
    sampleDisplacementsM: [],
  },
  initialState: {
    sprungDisplacementM: 0,
    sprungVelocityMps: 0,
    unsprungDisplacementM: 0,
    unsprungVelocityMps: 0,
  },
  settings: {
    durationS: 1.5,
    outputSamples: 301,
    relativeTolerance: 1e-8,
    absoluteTolerance: 1e-10,
    maximumStepS: 0.002,
    method: "DOP853",
  },
};

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
      <input type="number" step="any" value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <em>{unit}</em>
    </label>
  );
}

function StatusChip({ status }: { status: string | undefined }) {
  const accepted = status === "VERIFIED_NUMERICALLY";
  return (
    <span className={`status-chip ${accepted ? "ok" : status ? "error" : ""}`}>
      {accepted ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
      {status ? uiStatus(status) : "ÇALIŞTIRILMADI"}
    </span>
  );
}

function QuarterCarScene({ sample }: { sample: QuarterCarSample | undefined }) {
  const roadY = (sample?.roadDisplacementM ?? 0) * displacementVisualScale;
  const wheelY = 0.35 + (sample?.unsprungDisplacementM ?? 0) * displacementVisualScale;
  const bodyY = 1.05 + (sample?.sprungDisplacementM ?? 0) * displacementVisualScale;
  const springPoints = useMemo(() => {
    const points: Array<[number, number, number]> = [];
    const coils = 12;
    for (let index = 0; index <= coils; index += 1) {
      const fraction = index / coils;
      const offset = index === 0 || index === coils ? 0 : (index % 2 ? 0.075 : -0.075);
      points.push([offset, wheelY + 0.18 + fraction * (bodyY - wheelY - 0.34), 0]);
    }
    return points;
  }, [bodyY, wheelY]);

  return (
    <Canvas camera={{ position: [2.3, 1.35, 2.5], fov: 34 }} dpr={[1, 1.5]}>
      <color attach="background" args={["#080a0e"]} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[2, 3, 2]} intensity={1.4} />
      <gridHelper args={[4, 20, "#28303b", "#171c24"]} position={[0, roadY - 0.025, 0]} />
      <mesh position={[0, roadY - 0.05, 0]}>
        <boxGeometry args={[1.45, 0.08, 0.9]} />
        <meshStandardMaterial color="#303744" />
      </mesh>
      <mesh position={[0, wheelY, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.22, 0.075, 16, 48]} />
        <meshStandardMaterial color="#aeb6c2" roughness={0.72} />
      </mesh>
      <mesh position={[0, wheelY, 0]}>
        <cylinderGeometry args={[0.11, 0.11, 0.18, 32]} />
        <meshStandardMaterial color="#ef233c" />
      </mesh>
      <mesh position={[0, bodyY, 0]}>
        <boxGeometry args={[1.15, 0.22, 0.72]} />
        <meshStandardMaterial color="#7f1729" metalness={0.18} roughness={0.55} />
      </mesh>
      <Line points={springPoints} color="#f1f5f9" lineWidth={2} />
      <Line points={[[0.19, wheelY + 0.16, 0], [0.19, bodyY - 0.12, 0]]} color="#f59e0b" lineWidth={4} />
      <OrbitControls makeDefault enablePan={false} minDistance={1.6} maxDistance={5} target={[0, 0.65, 0]} />
    </Canvas>
  );
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

function csvCell(value: string | number | null): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function exportCsv(result: QuarterCarSimulationResponse): void {
  if (result.calculationStatus !== "VERIFIED_NUMERICALLY" || result.samples.length === 0) return;
  const metadata = [
    ["# model", result.modelName],
    ["# solver_version", result.solverVersion],
    ["# numerical_status", result.validationStatus.numerical],
    ["# reference_status", result.validationStatus.reference],
    ["# physical_status", result.validationStatus.physical],
    ["# engineering_approval", result.validationStatus.engineeringApproval],
    ["# input_sha256", result.inputProvenance.inputSha256],
    ["# data_classification", result.inputProvenance.dataClassification],
    ["# source", result.inputProvenance.sourceLabel],
    ["# units", "time=s; displacement=m; velocity=m/s; acceleration=m/s^2; force=N; energy=J; power=W"],
    ["# rtol", result.diagnostics.relativeTolerance],
    ["# atol", result.diagnostics.absoluteTolerance],
    ["# max_step_s", result.diagnostics.maximumStepS],
    ["# warnings", result.warnings.join(" | ")],
    ["# assumptions", result.assumptions.join(" | ")],
  ];
  const columns: Array<keyof QuarterCarSample> = [
    "timeS", "roadDisplacementM", "roadVelocityMps", "sprungDisplacementM",
    "sprungVelocityMps", "sprungAccelerationMps2", "unsprungDisplacementM",
    "unsprungVelocityMps", "unsprungAccelerationMps2", "suspensionTravelM",
    "tireCompressionM", "suspensionForceOnSprungN", "tireForceIncrementN",
    "totalTireContactForceN", "mechanicalEnergyJ", "dissipatedPowerW", "roadInputPowerW",
  ];
  const rows = [
    ...metadata.map((row) => row.map(csvCell).join(",")),
    columns.join(","),
    ...result.samples.map((sample) => columns.map((column) => csvCell(sample[column])).join(",")),
  ];
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([`${rows.join("\n")}\n`], { type: "text/csv;charset=utf-8" }));
  link.download = `quarter-car-${result.inputProvenance.inputSha256.slice(0, 12)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function QuarterCarWorkspace({ onModelChange }: { onModelChange: (model: DynamicsModel) => void }) {
  const [request, setRequest] = useState<QuarterCarSimulationRequest>(initialRequest);
  const [sampledTimes, setSampledTimes] = useState("0, 0.2, 0.4, 0.6");
  const [sampledDisplacements, setSampledDisplacements] = useState("0, 0.01, -0.005, 0");
  const [result, setResult] = useState<QuarterCarSimulationResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [sampleIndex, setSampleIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  const currentSample = result?.samples[sampleIndex];
  const chartData = useMemo(() => result?.samples.map((sample) => ({
    ...sample,
    timeS: Number(sample.timeS.toFixed(5)),
    roadMm: sample.roadDisplacementM * 1_000,
    sprungMm: sample.sprungDisplacementM * 1_000,
    unsprungMm: sample.unsprungDisplacementM * 1_000,
    travelMm: sample.suspensionTravelM * 1_000,
  })) ?? [], [result]);

  useEffect(() => {
    if (!playing || !result?.samples.length) return undefined;
    const interval = window.setInterval(() => {
      setSampleIndex((current) => current >= result.samples.length - 1 ? 0 : current + 1);
    }, 30);
    return () => window.clearInterval(interval);
  }, [playing, result]);

  const setParameter = <K extends keyof QuarterCarSimulationRequest["parameters"]>(
    key: K,
    value: QuarterCarSimulationRequest["parameters"][K],
  ) => setRequest((current) => ({ ...current, parameters: { ...current.parameters, [key]: value } }));

  const setRoad = <K extends keyof QuarterCarSimulationRequest["road"]>(
    key: K,
    value: QuarterCarSimulationRequest["road"][K],
  ) => setRequest((current) => ({ ...current, road: { ...current.road, [key]: value } }));

  const setSetting = <K extends keyof QuarterCarSimulationRequest["settings"]>(
    key: K,
    value: QuarterCarSimulationRequest["settings"][K],
  ) => setRequest((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));

  const setInitial = <K extends keyof QuarterCarSimulationRequest["initialState"]>(
    key: K,
    value: QuarterCarSimulationRequest["initialState"][K],
  ) => setRequest((current) => ({ ...current, initialState: { ...current.initialState, [key]: value } }));

  const run = async () => {
    setLoading(true);
    setError(undefined);
    setPlaying(false);
    try {
      const parseSeries = (value: string) => value.split(",").map((item) => Number(item.trim()));
      const submitted = request.road.kind === "sampled"
        ? {
            ...request,
            road: {
              ...request.road,
              sampleTimesS: parseSeries(sampledTimes),
              sampleDisplacementsM: parseSeries(sampledDisplacements),
            },
          }
        : request;
      const validated = quarterCarSimulationRequestSchema.parse(submitted);
      const response = await fetch(`${apiBaseUrl}/api/v1/dynamics/quarter-car/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
      });
      if (!response.ok) throw new Error(await readError(response));
      const next = quarterCarSimulationResponseSchema.parse(await response.json());
      setResult(next);
      setSampleIndex(0);
      if (next.calculationStatus !== "VERIFIED_NUMERICALLY") {
        setError(next.diagnostics.message);
      }
    } catch (reason) {
      setResult(undefined);
      setError(reason instanceof Error ? reason.message : "Dinamik simülasyonu başarısız oldu.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dynamics-workspace">
      <header className="dynamics-toolbar">
        <div><span className="eyebrow">FAZ 5 · DOĞRULANMIŞ DOĞRUSAL DİNAMİK</span><strong>Yol ve araç dinamiği</strong></div>
        <span>Hesaplanan SI yanıtı · fiziksel olarak doğrulanmamış</span>
        <button type="button" onClick={() => result && exportCsv(result)} disabled={result?.calculationStatus !== "VERIFIED_NUMERICALLY"}>
          <Download size={14} /> Doğrulanmamış CSV dışa aktar
        </button>
      </header>

      <div className="dynamics-content">
        <aside className="dynamics-inputs">
          <section className="inspector-section">
            <div className="section-heading"><span className="eyebrow">MODEL SEÇİMİ</span><StatusChip status={result?.calculationStatus} /></div>
            <label className="select-field"><span>Dinamik modeli</span><select aria-label="Dinamik modeli" value="quarter_car" onChange={(event) => onModelChange(event.target.value as DynamicsModel)}><option value="quarter_car">2SD çeyrek araç</option><option value="full_car">7SD tam araç sürüşü</option><option value="bicycle">Düzlemsel bisiklet modeli</option></select></label>
            <p className="field-note">Ayrı olarak referanslanmış doğrusal bir model seçin. Sonuçlar ölçülmüş araç verileriyle ilişkilendirilene kadar fiziksel olarak doğrulanmamış kalır.</p>
          </section>

          <section className="inspector-section">
            <div className="section-heading"><span className="eyebrow">ARAÇ PARAMETRELERİ</span><span className="unit-chip">SI</span></div>
            <div className="parameter-grid">
              <NumberField label="Yaylanan kütle" unit="kg" value={request.parameters.sprungMassKg} onChange={(value) => setParameter("sprungMassKg", value)} />
              <NumberField label="Yaylanmayan kütle" unit="kg" value={request.parameters.unsprungMassKg} onChange={(value) => setParameter("unsprungMassKg", value)} />
              <NumberField label="Süspansiyon rijitliği" unit="N/m" value={request.parameters.suspensionStiffnessNPerM} onChange={(value) => setParameter("suspensionStiffnessNPerM", value)} />
              <NumberField label="Süspansiyon sönümü" unit="N·s/m" value={request.parameters.suspensionDampingNsPerM} onChange={(value) => setParameter("suspensionDampingNsPerM", value)} />
              <NumberField label="Lastik rijitliği" unit="N/m" value={request.parameters.tireStiffnessNPerM} onChange={(value) => setParameter("tireStiffnessNPerM", value)} />
              <NumberField label="Lastik sönümü" unit="N·s/m" value={request.parameters.tireDampingNsPerM} onChange={(value) => setParameter("tireDampingNsPerM", value)} />
              <NumberField label="Statik lastik yükü" unit="N" value={request.parameters.staticTireLoadN ?? 0} onChange={(value) => setParameter("staticTireLoadN", value)} />
            </div>
            <p className="field-note">Sentetik gösterim değerleri. Statik lastik yükü yalnızca temas kaybını algılamak için kullanılır.</p>
          </section>

          <section className="inspector-section">
            <div className="section-heading"><span className="eyebrow">YOL GİRDİSİ</span></div>
            <label className="select-field"><span>Profil</span><select aria-label="Yol profili" value={request.road.kind} onChange={(event) => setRoad("kind", event.target.value as QuarterCarSimulationRequest["road"]["kind"])}><option value="step">Basamak</option><option value="smooth_bump">Yumuşak yükseltilmiş kosinüs tümseği</option><option value="half_sine">Yarım sinüs tümseği</option><option value="sine">Sürekli sinüs</option><option value="sampled">Örneklenmiş doğrusal veri</option></select></label>
            {request.road.kind === "sampled" ? (
              <>
                <label className="text-field"><span>Zamanlar (s)</span><input aria-label="Örnek zamanları" value={sampledTimes} onChange={(event) => setSampledTimes(event.target.value)} /></label>
                <label className="text-field"><span>Yer değiştirmeler (m)</span><input aria-label="Örnek yer değiştirmeleri" value={sampledDisplacements} onChange={(event) => setSampledDisplacements(event.target.value)} /></label>
              </>
            ) : (
              <div className="parameter-grid">
                <NumberField label="Genlik" unit="mm" value={request.road.amplitudeM * 1_000} onChange={(value) => setRoad("amplitudeM", value / 1_000)} />
                <NumberField label="Başlangıç zamanı" unit="s" value={request.road.startTimeS} onChange={(value) => setRoad("startTimeS", value)} />
                {(request.road.kind === "smooth_bump" || request.road.kind === "half_sine") && <NumberField label="Tümsek süresi" unit="s" value={request.road.durationS} onChange={(value) => setRoad("durationS", value)} />}
                {request.road.kind === "sine" && <NumberField label="Frekans" unit="Hz" value={request.road.frequencyHz} onChange={(value) => setRoad("frequencyHz", value)} />}
              </div>
            )}
          </section>

          <section className="inspector-section">
            <div className="section-heading"><span className="eyebrow">TÜMLEYİCİ</span></div>
            <label className="select-field"><span>Yöntem</span><select aria-label="Tümleme yöntemi" value={request.settings.method} onChange={(event) => setSetting("method", event.target.value as QuarterCarSimulationRequest["settings"]["method"])}><option>DOP853</option><option>Radau</option><option>BDF</option></select></label>
            <div className="parameter-grid">
              <NumberField label="Süre" unit="s" value={request.settings.durationS} onChange={(value) => setSetting("durationS", value)} />
              <NumberField label="Çıktı örnekleri" unit="adet" value={request.settings.outputSamples} onChange={(value) => setSetting("outputSamples", Math.round(value))} />
              <NumberField label="Bağıl tolerans" unit="—" value={request.settings.relativeTolerance} onChange={(value) => setSetting("relativeTolerance", value)} />
              <NumberField label="Mutlak tolerans" unit="—" value={request.settings.absoluteTolerance} onChange={(value) => setSetting("absoluteTolerance", value)} />
              <NumberField label="En büyük adım" unit="s" value={request.settings.maximumStepS} onChange={(value) => setSetting("maximumStepS", value)} />
            </div>
            <p className="input-subheading">Başlangıç bozuntu durumu</p>
            <div className="parameter-grid">
              <NumberField label="Yaylanan kütle yer değiştirmesi" unit="mm" value={request.initialState.sprungDisplacementM * 1_000} onChange={(value) => setInitial("sprungDisplacementM", value / 1_000)} />
              <NumberField label="Yaylanan kütle hızı" unit="m/s" value={request.initialState.sprungVelocityMps} onChange={(value) => setInitial("sprungVelocityMps", value)} />
              <NumberField label="Yaylanmayan kütle yer değiştirmesi" unit="mm" value={request.initialState.unsprungDisplacementM * 1_000} onChange={(value) => setInitial("unsprungDisplacementM", value / 1_000)} />
              <NumberField label="Yaylanmayan kütle hızı" unit="m/s" value={request.initialState.unsprungVelocityMps} onChange={(value) => setInitial("unsprungVelocityMps", value)} />
            </div>
            <label className="select-field provenance-classification"><span>Veri sınıflandırması</span><select aria-label="Veri sınıflandırması" value={request.dataClassification} onChange={(event) => setRequest({ ...request, dataClassification: event.target.value as QuarterCarSimulationRequest["dataClassification"] })}><option value="demonstration">Gösterim</option><option value="team_private">Takıma özel</option></select></label>
            <label className="text-field"><span>Girdi kaynağı / kökeni</span><input aria-label="Girdi kaynağı" value={request.sourceLabel} onChange={(event) => setRequest({ ...request, sourceLabel: event.target.value })} /></label>
            <button className="wide-action" type="button" disabled={loading} onClick={() => void run()}><Play size={13} />{loading ? "Tümleştiriliyor…" : "Simülasyonu çalıştır"}</button>
            {error && <p className="solver-failure">{error}</p>}
          </section>
        </aside>

        <main className="dynamics-results">
          <section className="dynamics-visual">
            <div className="dynamics-scene" data-testid="quarter-car-animation"><QuarterCarScene sample={currentSample} /><span>HESAPLANAN ÖRNEK · YER DEĞİŞTİRME GÖRSEL ÖLÇEĞİ {displacementVisualScale}×</span></div>
            <div className="playback-panel">
              <div className="playback-controls"><button type="button" aria-label={playing ? "Animasyonu duraklat" : "Animasyonu oynat"} disabled={!result?.samples.length} onClick={() => setPlaying((value) => !value)}>{playing ? <Pause size={14} /> : <Play size={14} />}</button><button type="button" aria-label="Animasyonu sıfırla" disabled={!result?.samples.length} onClick={() => { setPlaying(false); setSampleIndex(0); }}><RotateCcw size={14} /></button><input aria-label="Simülasyon zamanı" type="range" min={0} max={Math.max(0, (result?.samples.length ?? 1) - 1)} value={sampleIndex} onChange={(event) => { setPlaying(false); setSampleIndex(Number(event.target.value)); }} /></div>
              <dl className="instant-values"><div><dt>Zaman</dt><dd>{display(currentSample?.timeS, 3)} s</dd></div><div><dt>Yol</dt><dd>{display(currentSample && currentSample.roadDisplacementM * 1_000, 2)} mm</dd></div><div><dt>Yaylanan</dt><dd>{display(currentSample && currentSample.sprungDisplacementM * 1_000, 2)} mm</dd></div><div><dt>Yaylanmayan</dt><dd>{display(currentSample && currentSample.unsprungDisplacementM * 1_000, 2)} mm</dd></div><div><dt>Gövde ivmesi</dt><dd>{display(currentSample?.sprungAccelerationMps2, 3)} m/s²</dd></div><div><dt>Temas</dt><dd>{display(currentSample?.totalTireContactForceN, 1)} N</dd></div></dl>
            </div>
          </section>

          <section className="dynamics-charts">
            <div className="chart-card"><div className="chart-heading"><span>YER DEĞİŞTİRME YANITI</span><b>mm / s</b></div><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid stroke="#1f2630" vertical={false} /><XAxis dataKey="timeS" stroke="#667080" tick={{ fontSize: 8 }} /><YAxis stroke="#667080" tick={{ fontSize: 8 }} /><Tooltip contentStyle={{ background: "#11151b", border: "1px solid #303744", fontSize: 9 }} /><Legend wrapperStyle={{ fontSize: 8 }} /><ReferenceLine x={currentSample?.timeS} stroke="#ef233c" /><ChartLine type="monotone" dot={false} dataKey="roadMm" name="Yol" stroke="#94a3b8" /><ChartLine type="monotone" dot={false} dataKey="sprungMm" name="Yaylanan" stroke="#f43f5e" /><ChartLine type="monotone" dot={false} dataKey="unsprungMm" name="Yaylanmayan" stroke="#f59e0b" /><ChartLine type="monotone" dot={false} dataKey="travelMm" name="Süsp. hareketi" stroke="#60a5fa" /></LineChart></ResponsiveContainer></div>
            <div className="chart-card"><div className="chart-heading"><span>İVME VE TEMAS</span><b>m/s² · N</b></div><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid stroke="#1f2630" vertical={false} /><XAxis dataKey="timeS" stroke="#667080" tick={{ fontSize: 8 }} /><YAxis yAxisId="accel" stroke="#667080" tick={{ fontSize: 8 }} /><YAxis yAxisId="force" orientation="right" stroke="#667080" tick={{ fontSize: 8 }} /><Tooltip contentStyle={{ background: "#11151b", border: "1px solid #303744", fontSize: 9 }} /><Legend wrapperStyle={{ fontSize: 8 }} /><ReferenceLine yAxisId="accel" x={currentSample?.timeS} stroke="#ef233c" /><ChartLine yAxisId="accel" type="monotone" dot={false} dataKey="sprungAccelerationMps2" name="Gövde ivmesi" stroke="#f43f5e" /><ChartLine yAxisId="force" type="monotone" dot={false} dataKey="totalTireContactForceN" name="Temas kuvveti" stroke="#4ade80" /></LineChart></ResponsiveContainer></div>
          </section>

          <section className="dynamics-diagnostics">
            <div className="engineering-card"><div className="section-heading"><span className="eyebrow">HESAP KALİTESİ</span><StatusChip status={result?.calculationStatus} /></div>{result ? <dl className="solver-diagnostics compact"><div><dt>Sayısal</dt><dd>{uiStatus(result.validationStatus.numerical)}</dd></div><div><dt>Referans</dt><dd>{uiStatus(result.validationStatus.reference)}</dd></div><div><dt>Fiziksel</dt><dd>{uiStatus(result.validationStatus.physical)}</dd></div><div><dt>Onay</dt><dd>{uiStatus(result.validationStatus.engineeringApproval)}</dd></div><div><dt>Çözücü</dt><dd>v{result.solverVersion}</dd></div><div title={result.inputProvenance.inputSha256}><dt>Girdi SHA-256</dt><dd>{result.inputProvenance.inputSha256.slice(0, 12)}…</dd></div></dl> : <p className="diagnostic-empty">İzlenebilir durum üretmek için modeli çalıştırın.</p>}</div>
            <div className="engineering-card"><div className="section-heading"><span className="eyebrow">SAYISAL TANILAMA</span></div>{result ? <dl className="solver-diagnostics compact"><div><dt>Yöntem</dt><dd>{result.diagnostics.integrationMethod}</dd></div><div><dt>Fonksiyon değerlendirmesi</dt><dd>{result.diagnostics.functionEvaluations}</dd></div><div><dt>Kabul edilen adım</dt><dd>{result.diagnostics.acceptedSteps}</dd></div><div><dt>Kabul edilen Δt aralığı</dt><dd>{display(result.diagnostics.minimumAcceptedStepS, 6)}–{display(result.diagnostics.maximumAcceptedStepS, 6)} s</dd></div><div><dt>Enerji artığı</dt><dd>{display(result.diagnostics.energyBalanceResidualJ, 6)} J</dd></div><div><dt>Bağıl enerji hatası</dt><dd>{result.diagnostics.relativeEnergyBalanceError?.toExponential(3) ?? "—"}</dd></div><div><dt>En düşük toplam temas</dt><dd>{display(result.diagnostics.minimumTotalContactForceN, 2)} N</dd></div><div><dt>Doğal modlar</dt><dd>{result.naturalFrequenciesHz?.map((value) => value.toFixed(3)).join(" / ") ?? "—"} Hz</dd></div></dl> : <p className="diagnostic-empty">Entegrasyon tanılaması henüz kullanılamıyor.</p>}</div>
            <div className="engineering-card"><div className="section-heading"><span className="eyebrow">VARSAYIMLAR VE SINIRLAMALAR</span></div><p className="model-assumption">Statik denge çevresinde doğrusal 2SD düşey model; iki yönlü doğrusal lastik. Başvurma, yalpa, dingil mesafesi gecikmesi, aero, doğrusal olmayan sönüm, darbe takozu, lastik zarfı veya darbe/yeniden temas fiziği yoktur.</p>{result?.warnings.length ? <ul className="solver-warnings">{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}</div>
          </section>
        </main>
      </div>
    </div>
  );
}

export function DynamicsWorkspace() {
  const [model, setModel] = useState<DynamicsModel>("quarter_car");
  return model === "quarter_car"
    ? <QuarterCarWorkspace onModelChange={setModel} />
    : <AdvancedDynamicsWorkspace model={model} onModelChange={setModel} />;
}
