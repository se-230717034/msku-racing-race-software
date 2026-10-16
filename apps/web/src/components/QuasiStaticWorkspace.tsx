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

import { API_BASE_URL } from "../lib/api";
import { uiStatus } from "../lib/uiText";
import { useWorkspace } from "../store/workspace";
import { SuspensionViewport } from "./SuspensionViewport";

const apiBaseUrl = API_BASE_URL;

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
      {status ? uiStatus(status) : "ÇALIŞTIRILMADI"}
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
      setEquilibriumError(reason instanceof Error ? reason.message : "Denge isteği başarısız oldu.");
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
      setLoadError(reason instanceof Error ? reason.message : "Yük transferi isteği başarısız oldu.");
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
      setActuationError(reason instanceof Error ? reason.message : "Çalıştırma sistemi isteği başarısız oldu.");
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
          <span className="eyebrow">FAZ 3 · YARI STATİK</span>
          <strong>Yükler ve kuvvetler</strong>
        </div>
        <span>SI hesabı · düzenlenebilir gösterim birimleri</span>
        <button type="button" disabled title="Fiziksel olarak doğrulanmamış sonuçlar için onaylı dışa aktarma kapalıdır">
          <Download size={14} /> Onaylı dışa aktarma kapalı
        </button>
      </div>

      <div className="loads-content">
        <aside className="loads-input-panel">
          <section className="inspector-section">
            <div className="section-heading">
              <span className="eyebrow">TAŞIYICI TEMAS KUVVET-MOMENTİ</span>
              <StatusChip status={equilibrium?.calculationStatus} />
            </div>
            <NumberField label="Tekerlek hareketi" unit="mm" value={travelMm} onChange={setTravelMm} />
            <VectorFields label="Temas kuvveti" unit="N" value={force} onChange={setForce} />
            <VectorFields label="Serbest moment" unit="N·m" value={moment} onChange={setMoment} />
            <VectorFields label="Uygulama noktası" unit="m" value={application} onChange={setApplication} />
            <label className="check-field">
              <input
                type="checkbox"
                checked={includeActuation}
                onChange={(event) => setIncludeActuation(event.target.checked)}
              />
              Açık altıncı çalıştırma elemanı
            </label>
            {includeActuation && (
              <>
                <VectorFields label="Şasi/külbütör çalıştırma noktası" unit="m" value={actuationChassis} onChange={setActuationChassis} />
                <VectorFields label="Bu konumdaki taşıyıcı çalıştırma noktası" unit="m" value={actuationUpright} onChange={setActuationUpright} />
              </>
            )}
            <div className="action-row">
              <button type="button" className="secondary" onClick={loadSyntheticForcePreset}>
                <FlaskConical size={13} /> Sentetik ön ayar
              </button>
              <button type="button" onClick={() => void runEquilibrium()} disabled={equilibriumLoading}>
                <Play size={13} /> {equilibriumLoading ? "Çözülüyor…" : "Çöz"}
              </button>
            </div>
            <p className="field-note">Ön ayar sentetik yazılım test verisidir; MSKU araç geometrisi değildir.</p>
            {equilibriumError && <p className="solver-failure">{equilibriumError}</p>}
          </section>

          <section className="inspector-section">
            <div className="section-heading">
              <span className="eyebrow">ARAÇ YÜK TRANSFERİ</span>
              <StatusChip status={loadTransfer?.calculationStatus} />
            </div>
            <div className="parameter-grid">
              <NumberField label="Kütle" unit="kg" value={vehicle.massKg} onChange={(massKg) => setVehicle({ ...vehicle, massKg })} />
              <NumberField label="Dingil mesafesi" unit="m" value={vehicle.wheelbaseM} onChange={(wheelbaseM) => setVehicle({ ...vehicle, wheelbaseM })} />
              <NumberField label="Ön akstan ağırlık merkezi" unit="m" value={vehicle.cgFromFrontAxleM} onChange={(cgFromFrontAxleM) => setVehicle({ ...vehicle, cgFromFrontAxleM })} />
              <NumberField label="Ağırlık merkezi yüksekliği" unit="m" value={vehicle.cgHeightM} onChange={(cgHeightM) => setVehicle({ ...vehicle, cgHeightM })} />
              <NumberField label="Ön iz genişliği" unit="m" value={vehicle.frontTrackM} onChange={(frontTrackM) => setVehicle({ ...vehicle, frontTrackM })} />
              <NumberField label="Arka iz genişliği" unit="m" value={vehicle.rearTrackM} onChange={(rearTrackM) => setVehicle({ ...vehicle, rearTrackM })} />
              <NumberField label="Boylamsal ivme" unit="m/s²" value={vehicle.longitudinalAccelerationMps2} onChange={(longitudinalAccelerationMps2) => setVehicle({ ...vehicle, longitudinalAccelerationMps2 })} />
              <NumberField label="Yanal ivme" unit="m/s²" value={vehicle.lateralAccelerationMps2} onChange={(lateralAccelerationMps2) => setVehicle({ ...vehicle, lateralAccelerationMps2 })} />
              <NumberField label="Ön yalpa rijitliği" unit="N·m/rad" value={vehicle.frontRollStiffnessNmPerRad} onChange={(frontRollStiffnessNmPerRad) => setVehicle({ ...vehicle, frontRollStiffnessNmPerRad })} />
              <NumberField label="Arka yalpa rijitliği" unit="N·m/rad" value={vehicle.rearRollStiffnessNmPerRad} onChange={(rearRollStiffnessNmPerRad) => setVehicle({ ...vehicle, rearRollStiffnessNmPerRad })} />
            </div>
            <button type="button" className="wide-action" onClick={() => void runLoadTransfer()}>
              <Play size={13} /> Yük transferini hesapla
            </button>
            <p className="field-note">Mevcut değerler düzenlenebilir sentetik gösterim ön ayarıdır.</p>
            {loadError && <p className="solver-failure">{loadError}</p>}
          </section>

          <section className="inspector-section">
            <div className="section-heading">
              <span className="eyebrow">ÇALIŞTIRMA SERİSİ</span>
              <StatusChip status={actuation?.calculationStatus} />
            </div>
            <label className="text-field">
              <span>Tekerlek hareketi örnekleri (mm)</span>
              <input value={actuationInput.wheelTravelMm} onChange={(event) => setActuationInput({ ...actuationInput, wheelTravelMm: event.target.value })} />
            </label>
            <label className="text-field">
              <span>Yay uzunluğu örnekleri (mm)</span>
              <input value={actuationInput.springLengthMm} onChange={(event) => setActuationInput({ ...actuationInput, springLengthMm: event.target.value })} />
            </label>
            <div className="parameter-grid">
              <NumberField label="Referans uzunluğu" unit="mm" value={actuationInput.referenceSpringLengthMm} onChange={(referenceSpringLengthMm) => setActuationInput({ ...actuationInput, referenceSpringLengthMm })} />
              <NumberField label="Yay oranı" unit="N/mm" value={actuationInput.springRateNPerMm} onChange={(springRateNPerMm) => setActuationInput({ ...actuationInput, springRateNPerMm })} />
              <NumberField label="Ön yük" unit="N" value={actuationInput.preloadN} onChange={(preloadN) => setActuationInput({ ...actuationInput, preloadN })} />
            </div>
            <button type="button" className="wide-action" onClick={() => void runActuation()}>
              <Play size={13} /> Hareket oranını hesapla
            </button>
            <p className="field-note">Uzunluklar açık CAD, çözülmüş külbütör geometrisi veya ölçüm kaynağı gerektirir.</p>
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
                <span className="eyebrow">BAĞLANTI EKSENEL KUVVETLERİ</span>
                <StatusChip status={equilibrium?.calculationStatus} />
              </div>
              {equilibrium?.memberForces.length ? (
                <div className="force-table-wrap">
                  <table className="force-table">
                    <thead><tr><th>Eleman</th><th>Eksenel kuvvet</th><th>Durum</th></tr></thead>
                    <tbody>
                      {equilibrium.memberForces.map((item) => (
                        <tr key={item.id}>
                          <td>{item.id}</td>
                          <td>{item.axialForceN.toFixed(2)} N</td>
                          <td>{{ TENSION: "çekme", COMPRESSION: "basma", ZERO: "yüksüz" }[item.state]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="diagnostic-empty">Kabul edilmiş eleman kuvveti çözümü yok.</p>}
              {equilibrium && (
                <dl className="solver-diagnostics compact">
                  <div><dt>Rank</dt><dd>{equilibrium.diagnostics.matrixRank} / {equilibrium.diagnostics.matrixColumns}</dd></div>
                  <div><dt>Koşul</dt><dd>{equilibrium.diagnostics.conditionNumber?.toExponential(3) ?? "—"}</dd></div>
                  <div><dt>Kuvvet artığı</dt><dd>{equilibrium.diagnostics.forceResidualNormN.toExponential(3)} N</dd></div>
                  <div><dt>Moment artığı</dt><dd>{equilibrium.diagnostics.momentResidualNormNm.toExponential(3)} N·m</dd></div>
                  <div><dt>Çözücü</dt><dd>v{equilibrium.solverVersion}</dd></div>
                  <div><dt>Referans</dt><dd>{uiStatus(equilibrium.validationStatus.reference)}</dd></div>
                  <div><dt>Fiziksel</dt><dd>{uiStatus(equilibrium.validationStatus.physical)}</dd></div>
                  <div><dt>Onay</dt><dd>{uiStatus(equilibrium.validationStatus.engineeringApproval)}</dd></div>
                  <div title={equilibrium.inputProvenance.projectInputSha256}><dt>Girdi SHA-256</dt><dd>{equilibrium.inputProvenance.projectInputSha256.slice(0, 12)}…</dd></div>
                </dl>
              )}
              {equilibrium?.warnings.length ? <ul className="solver-warnings">{equilibrium.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
            </section>

            <section className="engineering-card">
              <div className="section-heading">
                <span className="eyebrow">NORMAL YÜK DAĞILIMI</span>
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
              ) : <p className="diagnostic-empty">Tekerlek yükleri yalnızca model yeterli girdiye sahip ve fiziksel kaldığında gösterilir.</p>}
              {loadTransfer && (
                <dl className="solver-diagnostics compact">
                  <div><dt>Ön aks</dt><dd>{format(loadTransfer.axleLoads?.frontN)} N</dd></div>
                  <div><dt>Arka aks</dt><dd>{format(loadTransfer.axleLoads?.rearN)} N</dd></div>
                  <div><dt>Boylamsal transfer</dt><dd>{format(loadTransfer.longitudinalTransferN)} N</dd></div>
                  <div><dt>Kuvvet artığı</dt><dd>{loadTransfer.forceResidualN?.toExponential(3) ?? "—"} N</dd></div>
                  <div><dt>Çözücü</dt><dd>v{loadTransfer.solverVersion}</dd></div>
                  <div><dt>Fiziksel</dt><dd>{uiStatus(loadTransfer.validationStatus.physical)}</dd></div>
                </dl>
              )}
              {loadTransfer?.warnings.length ? <ul className="solver-warnings">{loadTransfer.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
            </section>

            <section className="engineering-card actuation-card">
              <div className="section-heading">
                <span className="eyebrow">HAREKET ORANI VE TEKERLEK ORANI</span>
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
                    <Line yAxisId="ratio" dataKey="motionRatio" name="Hareket oranı" stroke="#f43f5e" dot={false} isAnimationActive={false} />
                    <Line yAxisId="rate" dataKey="wheelRateNPerMm" name="Tekerlek oranı" stroke="#60a5fa" dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <p className="diagnostic-empty">Desteklenen bir çalıştırma serisi hesaplanmadı.</p>}
              {actuation && (
                <dl className="solver-diagnostics compact">
                  <div><dt>Çözücü</dt><dd>v{actuation.solverVersion}</dd></div>
                  <div><dt>Referans</dt><dd>{uiStatus(actuation.validationStatus.reference)}</dd></div>
                  <div><dt>Fiziksel</dt><dd>{uiStatus(actuation.validationStatus.physical)}</dd></div>
                  <div><dt>Onay</dt><dd>{uiStatus(actuation.validationStatus.engineeringApproval)}</dd></div>
                </dl>
              )}
              {actuation?.warnings.length ? <ul className="solver-warnings">{actuation.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
              <p className="model-assumption">HO = d(yay sıkışması) / d(tekerlek sıkışması). Hız açıkça sağlanmadıkça amortisör kuvveti kullanılamaz.</p>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
