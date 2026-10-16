import { kinematicsSweepResponseSchema } from "@msku/contracts";
import { AlertTriangle, Download, LoaderCircle } from "lucide-react";
import { useEffect, useMemo } from "react";

import { validateProjectGeometry } from "../domain/geometry";
import { API_BASE_URL } from "../lib/api";
import { downloadKinematicsCsv } from "../lib/kinematicsCsv";
import { useKinematics } from "../store/kinematics";
import { useWorkspace } from "../store/workspace";
import { GeometryToolbar } from "./GeometryToolbar";
import { KinematicsCharts } from "./KinematicsCharts";
import { KinematicsPanel } from "./KinematicsPanel";
import { SuspensionViewport } from "./SuspensionViewport";

const readError = async (response: Response): Promise<string> => {
  try {
    const payload = await response.json() as { detail?: unknown };
    return typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail ?? payload);
  } catch {
    return `HTTP ${response.status} ${response.statusText}`;
  }
};

export function KinematicsWorkspace() {
  const project = useWorkspace((state) => state.project);
  const status = useKinematics((state) => state.status);
  const sweep = useKinematics((state) => state.sweep);
  const selectedIndex = useKinematics((state) => state.selectedIndex);
  const error = useKinematics((state) => state.error);
  const setLoading = useKinematics((state) => state.setLoading);
  const setSweep = useKinematics((state) => state.setSweep);
  const setError = useKinematics((state) => state.setError);
  const setSelectedIndex = useKinematics((state) => state.setSelectedIndex);
  const geometryDiagnostics = useMemo(() => validateProjectGeometry(project), [project]);

  useEffect(() => {
    const blocking = geometryDiagnostics.find((item) => item.severity === "error");
    if (blocking) {
      setError(`Çözümden önce geometri düzeltilmelidir: ${blocking.message}`);
      return;
    }
    const controller = new AbortController();
    setLoading(project.activeCornerId);
    const timer = window.setTimeout(() => {
      void fetch(`${API_BASE_URL}/api/v1/kinematics/sweep`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project,
          sweep: { startTravelM: -0.05, endTravelM: 0.05, steps: 41 },
          solver: { residualToleranceM: 1e-8, maxFunctionEvaluations: 500 },
        }),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(await readError(response));
          return response.json() as Promise<unknown>;
        })
        .then((payload) => setSweep(kinematicsSweepResponseSchema.parse(payload), project.activeCornerId))
        .catch((reason: unknown) => {
          if (reason instanceof DOMException && reason.name === "AbortError") return;
          setError(reason instanceof Error ? reason.message : "Kinematik isteği başarısız oldu.");
        });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [geometryDiagnostics, project, setError, setLoading, setSweep]);

  const selectedState = sweep?.states[selectedIndex];
  const exportAllowed = sweep?.allConverged === true
    && sweep.validationStatus.numerical === "VERIFIED_NUMERICALLY";

  return (
    <div className="kinematics-workspace">
      <GeometryToolbar />
      <div className="travel-toolbar">
        <div className="travel-readout">
          <span className="eyebrow">TEKERLEK HAREKETİ</span>
          <strong>{selectedState ? `${(selectedState.travelM * 1000).toFixed(1)} mm` : "—"}</strong>
          <b>{selectedState ? (selectedState.travelM >= 0 ? "SIKIŞMA" : "AÇILMA") : "ÇÖZÜM YOK"}</b>
        </div>
        <span>-50 mm</span>
        <input
          aria-label="Tekerlek hareketi"
          type="range"
          min="0"
          max={Math.max((sweep?.states.length ?? 1) - 1, 0)}
          step="1"
          value={selectedIndex}
          disabled={!sweep}
          onChange={(event) => setSelectedIndex(Number(event.target.value))}
        />
        <span>+50 mm</span>
        <button
          type="button"
          disabled={!exportAllowed}
          title={exportAllowed ? "Doğrulanmamış mühendislik verisini kaynak bilgisiyle dışa aktar" : "Dışa aktarma engellendi: tarama başarısız veya güvenilmez durumlar içeriyor"}
          onClick={() => sweep && exportAllowed && downloadKinematicsCsv(sweep, project.name)}
        >
          <Download size={14} /> CSV dışa aktar
        </button>
      </div>
      <div className="kinematics-content">
        <main className="kinematics-main">
          <div className="kinematics-viewport-wrap">
            <SuspensionViewport pose={selectedState?.pose ?? undefined} mode="kinematics" />
            {status === "loading" && <div className="solver-overlay"><LoaderCircle className="spin" />41 kısıtlı konum çözülüyor…</div>}
            {status === "error" && <div className="solver-overlay error"><AlertTriangle />Çözücü kullanılamıyor: {error}</div>}
            {selectedState && !selectedState.diagnostics.converged && <div className="solver-overlay error"><AlertTriangle />Konum çözülemedi: {selectedState.diagnostics.message}</div>}
          </div>
          {sweep ? <KinematicsCharts sweep={sweep} selectedTravelM={selectedState?.travelM ?? 0} /> : <div className="chart-placeholder">Grafikler yalnızca doğrulanmış çözücü yanıtından sonra gösterilir.</div>}
        </main>
        {sweep ? <KinematicsPanel state={selectedState} sweep={sweep} /> : <aside className="inspector kinematics-panel"><section className="inspector-section"><span className="eyebrow">KİNEMATİK</span><p className="diagnostic-empty">{status === "loading" ? "Kısıtlı hareket taraması çözülüyor…" : error ?? "Çözücü bekleniyor."}</p></section></aside>}
      </div>
    </div>
  );
}

