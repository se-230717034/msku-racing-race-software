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

import { API_BASE_URL } from "../lib/api";
import { uiBoolean, uiStatus } from "../lib/uiText";
import { useWorkspace } from "../store/workspace";

export type DynamicsModel = "quarter_car" | "full_car" | "bicycle";

const apiBaseUrl = API_BASE_URL;
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
  sourceLabel: "Sentetik Faz 5 simetrik tam araç ön ayarı",
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
  sourceLabel: "Sentetik Faz 5 nötr yönlendirmeli bisiklet modeli ön ayarı",
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
  return <span className={`status-chip ${accepted ? "ok" : status ? "error" : ""}`}>{accepted ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}{status ? uiStatus(status) : "ÇALIŞTIRILMADI"}</span>;
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
  const setLatestFullCarResult = useWorkspace((state) => state.setLatestFullCarResult);
  const setLatestBicycleResult = useWorkspace((state) => state.setLatestBicycleResult);

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
      if (next.calculationStatus === "VERIFIED_NUMERICALLY") {
        if (next.modelName === "linear_full_car_7dof") {
          setLatestFullCarResult(next);
          setLatestBicycleResult(null);
        } else {
          setLatestBicycleResult(next);
          setLatestFullCarResult(null);
        }
      } else {
        if (isFullCar) setLatestFullCarResult(null);
        else setLatestBicycleResult(null);
        setError(next.diagnostics.message);
      }
    } catch (reason) {
      setResult(undefined);
      if (isFullCar) setLatestFullCarResult(null);
      else setLatestBicycleResult(null);
      setError(reason instanceof Error ? reason.message : "Dinamik simülasyonu başarısız oldu.");
    } finally {
      setLoading(false);
    }
  };

  const currentFull = fullResult?.samples[sampleIndex];
  const currentBicycle = bicycleResult?.samples[sampleIndex];
  const status = result?.calculationStatus;

  return <div className="dynamics-workspace">
    <header className="dynamics-toolbar">
      <div><span className="eyebrow">FAZ 5 · DOĞRULANMIŞ DOĞRUSAL DİNAMİK</span><strong>{isFullCar ? "7SD tam araç sürüşü" : "Düzlemsel bisiklet modeli"}</strong></div>
      <span>Hesaplanan SI yanıtı · fiziksel olarak doğrulanmamış</span>
    </header>
    <div className="dynamics-content">
      <aside className="dynamics-inputs">
        <section className="inspector-section">
          <div className="section-heading"><span className="eyebrow">MODEL SEÇİMİ</span><StatusChip status={status} /></div>
          <label className="select-field"><span>Dinamik modeli</span><select aria-label="Dinamik modeli" value={model} onChange={(event) => { setResult(undefined); onModelChange(event.target.value as DynamicsModel); }}><option value="quarter_car">2SD çeyrek araç</option><option value="full_car">7SD tam araç sürüşü</option><option value="bicycle">Düzlemsel bisiklet modeli</option></select></label>
          <p className="field-note">Bunlar çıkarımsal animasyon değil, deterministik doğrusal mühendislik modelleridir. Girdiler SI birimlerini kullanır ve çıktılar sayısal kalite durumunu içerir.</p>
        </section>

        {isFullCar ? <>
          <section className="inspector-section">
            <div className="section-heading"><span className="eyebrow">GÖVDE VE DÖRT KÖŞE</span><span className="unit-chip">SI</span></div>
            <div className="parameter-grid">
              <NumberField label="Yaylanan kütle" unit="kg" value={fullRequest.parameters.sprungMassKg} onChange={(value) => updateFullParameter("sprungMassKg", value)} />
              <NumberField label="Başvurma ataleti" unit="kg·m²" value={fullRequest.parameters.pitchInertiaKgM2} onChange={(value) => updateFullParameter("pitchInertiaKgM2", value)} />
              <NumberField label="Yalpa ataleti" unit="kg·m²" value={fullRequest.parameters.rollInertiaKgM2} onChange={(value) => updateFullParameter("rollInertiaKgM2", value)} />
              <NumberField label="Köşe yayı" unit="N/m" value={fullRequest.parameters.corners[0].suspensionStiffnessNPerM} onChange={(value) => updateAllCorners("suspensionStiffnessNPerM", value)} />
              <NumberField label="Köşe sönümü" unit="N·s/m" value={fullRequest.parameters.corners[0].suspensionDampingNsPerM} onChange={(value) => updateAllCorners("suspensionDampingNsPerM", value)} />
              <NumberField label="Lastik rijitliği" unit="N/m" value={fullRequest.parameters.corners[0].tireStiffnessNPerM} onChange={(value) => updateAllCorners("tireStiffnessNPerM", value)} />
            </div>
            <p className="field-note">Mevcut düzenleyici simetrik köşe özellikleri uygular. İstek yine de dört bağımsız köşe konumu, kütle, yol, yay, sönümleyici, lastik ve statik yük taşır.</p>
          </section>
          <section className="inspector-section">
            <div className="section-heading"><span className="eyebrow">YOL VE TÜMLEME</span></div>
            <div className="parameter-grid">
              <NumberField label="Tüm tekerleklerde tümsek" unit="mm" value={fullRequest.roadProfiles[0].amplitudeM * 1_000} onChange={(value) => setFullRequest((current) => ({ ...current, roadProfiles: current.roadProfiles.map((profile) => ({ ...profile, amplitudeM: value / 1_000 })) }))} />
              <NumberField label="Süre" unit="s" value={fullRequest.settings.durationS} onChange={(value) => setFullRequest((current) => ({ ...current, settings: { ...current.settings, durationS: value } }))} />
            </div>
          </section>
        </> : <>
          <section className="inspector-section">
            <div className="section-heading"><span className="eyebrow">ARAÇ VE LASTİKLER</span><span className="unit-chip">SI</span></div>
            <div className="parameter-grid">
              <NumberField label="Kütle" unit="kg" value={bicycleRequest.parameters.massKg} onChange={(value) => updateBicycleParameter("massKg", value)} />
              <NumberField label="Sapma ataleti" unit="kg·m²" value={bicycleRequest.parameters.yawInertiaKgM2} onChange={(value) => updateBicycleParameter("yawInertiaKgM2", value)} />
              <NumberField label="Ağırlık merkezinden ön aksa" unit="m" value={bicycleRequest.parameters.cgToFrontAxleM} onChange={(value) => updateBicycleParameter("cgToFrontAxleM", value)} />
              <NumberField label="Ağırlık merkezinden arka aksa" unit="m" value={bicycleRequest.parameters.cgToRearAxleM} onChange={(value) => updateBicycleParameter("cgToRearAxleM", value)} />
              <NumberField label="Ön Cα" unit="N/rad" value={bicycleRequest.parameters.frontCorneringStiffnessNPerRad} onChange={(value) => updateBicycleParameter("frontCorneringStiffnessNPerRad", value)} />
              <NumberField label="Arka Cα" unit="N/rad" value={bicycleRequest.parameters.rearCorneringStiffnessNPerRad} onChange={(value) => updateBicycleParameter("rearCorneringStiffnessNPerRad", value)} />
              <NumberField label="Hız" unit="m/s" value={bicycleRequest.parameters.speedMps} onChange={(value) => updateBicycleParameter("speedMps", value)} />
              <NumberField label="Direksiyon genliği" unit="mrad" value={bicycleRequest.steering.amplitudeRad * 1_000} onChange={(value) => setBicycleRequest((current) => ({ ...current, steering: { ...current.steering, amplitudeRad: value / 1_000 } }))} />
            </div>
          </section>
          <section className="inspector-section">
            <div className="section-heading"><span className="eyebrow">DOĞRUSAL BÖLGE SINIRLARI</span></div>
            <div className="parameter-grid">
              <NumberField label="En büyük direksiyon" unit="mrad" value={bicycleRequest.domainLimits.maximumAbsSteeringRad * 1_000} onChange={(value) => setBicycleRequest((current) => ({ ...current, domainLimits: { ...current.domainLimits, maximumAbsSteeringRad: value / 1_000 } }))} />
              <NumberField label="En büyük yana kayma" unit="mrad" value={bicycleRequest.domainLimits.maximumAbsSideslipRad * 1_000} onChange={(value) => setBicycleRequest((current) => ({ ...current, domainLimits: { ...current.domainLimits, maximumAbsSideslipRad: value / 1_000 } }))} />
              <NumberField label="En büyük lastik kayması" unit="mrad" value={bicycleRequest.domainLimits.maximumAbsTireSlipRad * 1_000} onChange={(value) => setBicycleRequest((current) => ({ ...current, domainLimits: { ...current.domainLimits, maximumAbsTireSlipRad: value / 1_000 } }))} />
            </div>
          </section>
        </>}
        <section className="inspector-section">
          <label className="text-field"><span>Girdi kaynağı / kökeni</span><input aria-label="Girdi kaynağı" value={isFullCar ? fullRequest.sourceLabel : bicycleRequest.sourceLabel} onChange={(event) => isFullCar ? setFullRequest({ ...fullRequest, sourceLabel: event.target.value }) : setBicycleRequest({ ...bicycleRequest, sourceLabel: event.target.value })} /></label>
          <button className="wide-action" type="button" disabled={loading} onClick={() => void run()}><Play size={13} />{loading ? "Tümleştiriliyor…" : "Simülasyonu çalıştır"}</button>
          {error && <p className="solver-failure">{error}</p>}
        </section>
      </aside>

      <main className="dynamics-results">
        <section className="dynamics-visual advanced-dynamics-summary">
          <div className="engineering-card">
            <div className="section-heading"><span className="eyebrow">HESAPLANAN ÖRNEK</span><StatusChip status={status} /></div>
            <input aria-label="Simülasyon zamanı" type="range" min={0} max={Math.max(0, sampleCount - 1)} value={sampleIndex} disabled={sampleCount === 0} onChange={(event) => setSampleIndex(Number(event.target.value))} />
            {currentFull ? <dl className="instant-values"><div><dt>Zaman</dt><dd>{display(currentFull.timeS, 3)} s</dd></div><div><dt>Yükselme</dt><dd>{display(currentFull.bodyHeaveM * 1_000, 3)} mm</dd></div><div><dt>Başvurma</dt><dd>{display(currentFull.pitchRad * 1_000, 3)} mrad</dd></div><div><dt>Yalpa</dt><dd>{display(currentFull.rollRad * 1_000, 3)} mrad</dd></div><div><dt>Ön sol temas</dt><dd>{display(currentFull.totalTireContactForcesN[0], 1)} N</dd></div></dl> : currentBicycle ? <dl className="instant-values"><div><dt>Zaman</dt><dd>{display(currentBicycle.timeS, 3)} s</dd></div><div><dt>Sapma hızı</dt><dd>{display(currentBicycle.yawRateRadps, 4)} rad/s</dd></div><div><dt>Yana kayma</dt><dd>{display(currentBicycle.sideslipRad * 1_000, 3)} mrad</dd></div><div><dt>Yanal ivme</dt><dd>{display(currentBicycle.lateralAccelerationMps2, 3)} m/s²</dd></div></dl> : <p className="diagnostic-empty">Hesaplanan durumları incelemek için modeli çalıştırın.</p>}
          </div>
          <div className="engineering-card"><div className="section-heading"><span className="eyebrow">MODEL TANIMI</span></div><p className="model-assumption">{isFullCar ? "Yedi serbestlik derecesi: yaylanan gövde yükselmesi, başvurma, yalpa ve dört bağımsız yaylanmayan düşey koordinat. Köşe gövde yer değiştirmesi belgelenmiş araç eksen takımında z − xθ + yφ olarak hesaplanır." : "İki durum: sabit boylamsal hızda yanal hız ve sapma hızı. Doğrusal aks viraj rijitliği ve küçük açılı lastik kayma ilişkileri uygulanır."}</p><p className="field-note">Fiziksel doğrulama veya mühendislik onayı anlamına gelmez.</p></div>
        </section>

        <section className="dynamics-charts">
          <div className="chart-card"><div className="chart-heading"><span>{isFullCar ? "GÖVDE YANITI" : "YOL TUTUŞ YANITI"}</span><b>{isFullCar ? "mm / mrad" : "SI / mrad"}</b></div><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid stroke="#1f2630" vertical={false} /><XAxis dataKey="timeS" stroke="#667080" tick={{ fontSize: 8 }} /><YAxis stroke="#667080" tick={{ fontSize: 8 }} /><Tooltip contentStyle={{ background: "#11151b", border: "1px solid #303744", fontSize: 9 }} /><Legend wrapperStyle={{ fontSize: 8 }} />{isFullCar ? <><ChartLine dot={false} dataKey="heaveMm" name="Yükselme mm" stroke="#f43f5e" /><ChartLine dot={false} dataKey="pitchMrad" name="Başvurma mrad" stroke="#f59e0b" /><ChartLine dot={false} dataKey="rollMrad" name="Yalpa mrad" stroke="#60a5fa" /></> : <><ChartLine dot={false} dataKey="yawRate" name="Sapma rad/s" stroke="#f43f5e" /><ChartLine dot={false} dataKey="sideslipMrad" name="Yana kayma mrad" stroke="#60a5fa" /><ChartLine dot={false} dataKey="lateralAcceleration" name="Yanal m/s²" stroke="#4ade80" /></>}</LineChart></ResponsiveContainer></div>
          <div className="chart-card"><div className="chart-heading"><span>{isFullCar ? "SÜSPANSİYON HAREKETİ" : "LASTİK KAYMA AÇILARI"}</span><b>{isFullCar ? "mm" : "mrad"}</b></div><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid stroke="#1f2630" vertical={false} /><XAxis dataKey="timeS" stroke="#667080" tick={{ fontSize: 8 }} /><YAxis stroke="#667080" tick={{ fontSize: 8 }} /><Tooltip contentStyle={{ background: "#11151b", border: "1px solid #303744", fontSize: 9 }} /><Legend wrapperStyle={{ fontSize: 8 }} />{isFullCar ? <><ChartLine dot={false} dataKey="frontLeftTravelMm" name="Ön sol hareket" stroke="#f43f5e" /><ChartLine dot={false} dataKey="rearLeftTravelMm" name="Arka sol hareket" stroke="#f59e0b" /></> : <><ChartLine dot={false} dataKey="frontSlipMrad" name="Ön kayma" stroke="#f43f5e" /><ChartLine dot={false} dataKey="rearSlipMrad" name="Arka kayma" stroke="#f59e0b" /></>}</LineChart></ResponsiveContainer></div>
        </section>

        <section className="dynamics-diagnostics">
          <div className="engineering-card"><div className="section-heading"><span className="eyebrow">HESAP KALİTESİ</span></div>{result ? <dl className="solver-diagnostics compact"><div><dt>Sayısal</dt><dd>{uiStatus(result.validationStatus.numerical)}</dd></div><div><dt>Referans</dt><dd>{uiStatus(result.validationStatus.reference)}</dd></div><div><dt>Fiziksel</dt><dd>{uiStatus(result.validationStatus.physical)}</dd></div><div><dt>Onay</dt><dd>{uiStatus(result.validationStatus.engineeringApproval)}</dd></div><div><dt>Çözücü</dt><dd>v{result.solverVersion}</dd></div><div title={result.inputProvenance.inputSha256}><dt>Girdi SHA-256</dt><dd>{result.inputProvenance.inputSha256.slice(0, 12)}…</dd></div></dl> : <p className="diagnostic-empty">Simülasyon sonucu yok.</p>}</div>
          <div className="engineering-card"><div className="section-heading"><span className="eyebrow">SAYISAL TANILAMA</span></div>{fullResult ? <dl className="solver-diagnostics compact"><div><dt>Yöntem</dt><dd>{fullResult.diagnostics.integrationMethod}</dd></div><div><dt>Kabul edilen adımlar</dt><dd>{fullResult.diagnostics.acceptedSteps}</dd></div><div><dt>Temas kabul edildi</dt><dd>{uiBoolean(fullResult.diagnostics.contactAccepted)}</dd></div><div><dt>Kütle koşulu</dt><dd>{display(fullResult.diagnostics.massMatrixCondition, 2)}</dd></div><div><dt>Enerji artığı</dt><dd>{display(fullResult.diagnostics.energyBalanceResidualJ, 6)} J</dd></div><div><dt>Modlar</dt><dd>{fullResult.naturalFrequenciesHz?.map((value) => value.toFixed(2)).join(" / ") ?? "—"} Hz</dd></div></dl> : bicycleResult ? <dl className="solver-diagnostics compact"><div><dt>Yöntem</dt><dd>{bicycleResult.diagnostics.integrationMethod}</dd></div><div><dt>Kararlı</dt><dd>{uiBoolean(bicycleResult.diagnostics.stable)}</dd></div><div><dt>Bölge kabul edildi</dt><dd>{uiBoolean(bicycleResult.diagnostics.domainAccepted)}</dd></div><div><dt>Önden kayma K</dt><dd>{display(bicycleResult.diagnostics.understeerCoefficientS2PerM, 7)} s²/m</dd></div><div><dt>Karakteristik hız</dt><dd>{display(bicycleResult.diagnostics.characteristicSpeedMps, 3)} m/s</dd></div><div><dt>Kritik hız</dt><dd>{display(bicycleResult.diagnostics.criticalSpeedMps, 3)} m/s</dd></div></dl> : <p className="diagnostic-empty">Tanılama yok.</p>}</div>
          <div className="engineering-card"><div className="section-heading"><span className="eyebrow">UYARILAR VE SINIRLAMALAR</span></div>{result?.warnings.length ? <ul className="solver-warnings">{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : <p className="model-assumption">Doğrusal küçük hareket modeli. Doğrusal olmayan lastikler, esneklik, darbeler, doyum, yük duyarlılığı, aerodinamik ve ölçülmüş araç korelasyonu bu hesabın dışındadır.</p>}</div>
        </section>
      </main>
    </div>
  </div>;
}
