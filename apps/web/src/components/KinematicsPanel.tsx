import type {
  CoiloverSample,
  CoiloverSeriesResponse,
  KinematicState,
  KinematicsSweepResponse,
} from "@msku/contracts";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { uiStatus } from "../lib/uiText";

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
  coiloverSample,
  coiloverSeries,
  coiloverError,
}: {
  state: KinematicState | undefined;
  sweep: KinematicsSweepResponse;
  coiloverSample?: CoiloverSample;
  coiloverSeries?: CoiloverSeriesResponse;
  coiloverError?: string;
}) {
  const metrics = state?.metrics;
  const diagnostics = state?.diagnostics;
  const gainScale = 0.01 * 180 / Math.PI;

  return (
    <aside className="inspector kinematics-panel">
      <section className="inspector-section">
        <div className="section-heading">
          <span className="eyebrow">ÇÖZÜLMÜŞ DURUM</span>
          <span className={diagnostics?.converged ? "status-chip ok" : "status-chip error"}>
            {diagnostics?.converged ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
            {diagnostics?.converged ? "yakınsadı" : "başarısız"}
          </span>
        </div>
        <div className="result-grid">
          <Metric label="Tekerlek hareketi" value={format((state?.travelM ?? 0) * 1000, 2)} unit="mm" />
          <Metric label="Kamber" value={format(metrics ? degrees(metrics.camberRad) : null)} unit="derece" />
          <Metric label="Kamber değişimi" value={format(metrics ? degrees(metrics.camberChangeRad) : null)} unit="derece" />
          <Metric label="Kamber kazancı" value={format(metrics?.camberGainRadPerM == null ? null : metrics.camberGainRadPerM * gainScale)} unit="derece/10mm" />
          <Metric label="Tekerlek yönelimi (toe)" value={format(metrics ? degrees(metrics.toeRad) : null)} unit="derece" />
          <Metric label="Sıkışma yönlendirmesi" value={format(metrics ? degrees(metrics.bumpSteerRad) : null)} unit="derece" />
          <Metric label="Sıkışma yönlendirmesi gradyanı" value={format(metrics?.bumpSteerGradientRadPerM == null ? null : metrics.bumpSteerGradientRadPerM * gainScale)} unit="derece/10mm" />
          <Metric label="Kaster" value={format(metrics ? degrees(metrics.casterRad) : null)} unit="derece" />
          <Metric label="KPI / SAI" value={format(metrics ? degrees(metrics.kpiRad) : null)} unit="derece" />
          <Metric label="İz genişliği değişimi" value={format(metrics == null ? null : metrics.trackChangeM * 1000)} unit="mm" />
          <Metric label="Yalpa merkezi yüksekliği" value={format(metrics?.rollCenterHeightM == null ? null : metrics.rollCenterHeightM * 1000)} unit="mm" />
        </div>
      </section>

      <section className="inspector-section" data-testid="coilover-physics-panel">
        <div className="section-heading">
          <span className="eyebrow">COILOVER YAY–SÖNÜMLEYİCİ</span>
          <span className={coiloverSeries?.calculationStatus === "VERIFIED_NUMERICALLY" ? "status-chip ok" : "status-chip error"}>
            {coiloverSeries?.calculationStatus === "VERIFIED_NUMERICALLY" ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
            {coiloverSeries?.calculationStatus === "VERIFIED_NUMERICALLY" ? "sayısal çözüm" : "hesaplanamadı"}
          </span>
        </div>
        {coiloverSample ? (
          <div className="result-grid">
            <Metric label="Coilover boyu" value={format(coiloverSample.coiloverLengthM * 1000, 2)} unit="mm" />
            <Metric label="Yay sıkışması" value={format(coiloverSample.coiloverCompressionM * 1000, 2)} unit="mm" />
            <Metric label="Hareket oranı" value={format(coiloverSample.motionRatio, 4)} unit="m/m" />
            <Metric label="Coilover hızı" value={format(coiloverSample.coiloverCompressionVelocityMps, 3)} unit="m/s" />
            <Metric label="Yay kuvveti" value={format(coiloverSample.springForceN, 1)} unit="N" />
            <Metric label="Damper kuvveti" value={format(coiloverSample.damperForceN, 1)} unit="N" />
            <Metric label="Toplam eksenel kuvvet" value={format(coiloverSample.totalAxialForceN, 1)} unit="N" />
            <Metric label="Tekerlek kuvveti" value={format(coiloverSample.wheelForceN, 1)} unit="N" />
            <Metric label="Kalan sıkışma stroku" value={format(coiloverSample.remainingCompressionTravelM == null ? null : coiloverSample.remainingCompressionTravelM * 1000, 2)} unit="mm" />
            <Metric label="Kalan açılma stroku" value={format(coiloverSample.remainingReboundTravelM == null ? null : coiloverSample.remainingReboundTravelM * 1000, 2)} unit="mm" />
          </div>
        ) : <p className="diagnostic-empty">{coiloverError ?? "Aktüasyon ve damper parametreleri gerekli."}</p>}
        <p className="model-caveat">Damper kuvveti yalnızca açıkça girilen tekerlek hızından hesaplanır; kaydırıcı zamanlamasından hız türetilmez.</p>
        {coiloverSeries && <p className="model-caveat">Çözücü v{coiloverSeries.solverVersion} · fiziksel korelasyon yok.</p>}
      </section>

      <section className="inspector-section">
        <div className="section-heading">
          <span className="eyebrow">ÇÖZÜCÜ TANILAMA</span>
          <span className="unit-chip">tol {sweep.residualToleranceM.toExponential(0)} m</span>
        </div>
        <dl className="solver-diagnostics">
          <div><dt>Eniyileyici</dt><dd>{diagnostics?.optimizerSuccess ? "kabul edildi" : "başarısız"}</dd></div>
          <div><dt>Artık kontrolü</dt><dd>{diagnostics?.residualsAccepted ? "kabul edildi" : "başarısız"}</dd></div>
          <div><dt>Jakoben kontrolü</dt><dd>{diagnostics?.jacobianAccepted ? "kabul edildi" : "başarısız"}</dd></div>
          <div><dt>Süreklilik kontrolü</dt><dd>{diagnostics?.continuityAccepted ? "kabul edildi" : "başarısız"}</dd></div>
          <div><dt>En büyük artık</dt><dd>{diagnostics?.maxAbsResidualM == null ? "—" : `${diagnostics.maxAbsResidualM.toExponential(3)} m`}</dd></div>
          <div><dt>Artık normu</dt><dd>{diagnostics?.residualNormM == null ? "—" : `${diagnostics.residualNormM.toExponential(3)} m`}</dd></div>
          <div><dt>Jakoben rankı</dt><dd>{diagnostics?.jacobianRank ?? "—"} / 6</dd></div>
          <div><dt>Koşul sayısı</dt><dd>{diagnostics?.jacobianCondition == null ? "—" : diagnostics.jacobianCondition.toExponential(3)}</dd></div>
          <div><dt>Fonksiyon değerlendirmesi</dt><dd>{diagnostics?.functionEvaluations ?? "—"}</dd></div>
        </dl>
        {diagnostics && !diagnostics.converged && <p className="solver-failure">{diagnostics.message}</p>}
        {state && state.warnings.length > 0 && (
          <ul className="solver-warnings">{state.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        )}
      </section>

      <section className="inspector-section">
        <span className="eyebrow">HESAP KALİTESİ</span>
        <dl className="solver-diagnostics quality-status">
          <div><dt>Sayısal</dt><dd>{uiStatus(sweep.validationStatus.numerical)}</dd></div>
          <div><dt>Referans</dt><dd>{uiStatus(sweep.validationStatus.reference)}</dd></div>
          <div><dt>Fiziksel</dt><dd>{uiStatus(sweep.validationStatus.physical)}</dd></div>
          <div><dt>Onay</dt><dd>{uiStatus(sweep.validationStatus.engineeringApproval)}</dd></div>
          <div><dt>Çözücü</dt><dd>v{sweep.solver.version}</dd></div>
          <div title={sweep.inputProvenance.projectInputSha256}><dt>Girdi SHA-256</dt><dd>{sweep.inputProvenance.projectInputSha256.slice(0, 12)}…</dd></div>
        </dl>
        <ul className="solver-warnings">
          {sweep.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      </section>

      <section className="inspector-section grow model-note">
        <span className="eyebrow">MODEL KAPSAMI</span>
        <p>Rijit bağlantılar ve mafsallar; esneklik, yükler, lastik kuvvetleri veya geçici rejim dinamiği içermez.</p>
        <p>Yalpa merkezi yüksekliği geometrik ön görünüş sonucudur. Tam aynalanmış karşı köşe ve rijit dairesel lastik temas noktası varsayar; desteklenmeyen pivot/kol izdüşümleri değer döndürmez.</p>
        <p>Pozitif hareket sıkışmadır. Pozitif toe içe bakışı, pozitif kamber tekerlek üstünün dışa yatmasını ifade eder.</p>
        <b>FİZİKSEL OLARAK DOĞRULANMADI — TASARIM ONAYI İÇİN KULLANILAMAZ</b>
      </section>
    </aside>
  );
}

