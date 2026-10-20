import { Activity, AlertTriangle, Box, Car, CheckCircle2, Database, FileText, Gauge, GitCompareArrows, Menu, Route, Scale, TestTubeDiagonal, Waypoints } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import { GeometryInspector } from "./components/GeometryInspector";
import { GeometryToolbar } from "./components/GeometryToolbar";
import { AnsysConnectionPanel } from "./components/AnsysConnectionPanel";
import { ProjectActions } from "./components/ProjectActions";
import { SuspensionViewport } from "./components/SuspensionViewport";
import { validateProjectGeometry } from "./domain/geometry";
import { API_BASE_URL } from "./lib/api";
import { uiCorner, uiStatus } from "./lib/uiText";
import { useWorkspace, type ModuleId } from "./store/workspace";

const KinematicsWorkspace = lazy(() =>
  import("./components/KinematicsWorkspace").then((module) => ({ default: module.KinematicsWorkspace })),
);
const FullVehicleWorkspace = lazy(() =>
  import("./components/FullVehicleWorkspace").then((module) => ({ default: module.FullVehicleWorkspace })),
);
const QuasiStaticWorkspace = lazy(() =>
  import("./components/QuasiStaticWorkspace").then((module) => ({ default: module.QuasiStaticWorkspace })),
);
const DynamicsWorkspace = lazy(() =>
  import("./components/DynamicsWorkspace").then((module) => ({ default: module.DynamicsWorkspace })),
);
const OptimizationWorkspace = lazy(() =>
  import("./components/OptimizationWorkspace").then((module) => ({ default: module.OptimizationWorkspace })),
);
const ReportsWorkspace = lazy(() =>
  import("./components/ReportsWorkspace").then((module) => ({ default: module.ReportsWorkspace })),
);
const ComparisonWorkspace = lazy(() =>
  import("./components/ComparisonWorkspace").then((module) => ({ default: module.ComparisonWorkspace })),
);
const ValidationWorkspace = lazy(() =>
  import("./components/ValidationWorkspace").then((module) => ({ default: module.ValidationWorkspace })),
);

const modules: Array<{ id: ModuleId; label: string; icon: typeof Box; implemented: boolean }> = [
  { id: "workspace", label: "Çalışma Alanı", icon: Database, implemented: true },
  { id: "vehicle", label: "Araç", icon: Car, implemented: true },
  { id: "geometry", label: "Geometri", icon: Box, implemented: true },
  { id: "kinematics", label: "Kinematik", icon: Waypoints, implemented: true },
  { id: "loads", label: "Yükler", icon: Scale, implemented: true },
  { id: "dynamics", label: "Dinamik", icon: Activity, implemented: true },
  { id: "road", label: "Yol", icon: Route, implemented: false },
  { id: "optimization", label: "Optimizasyon", icon: Gauge, implemented: true },
  { id: "comparison", label: "Karşılaştır", icon: GitCompareArrows, implemented: true },
  { id: "reports", label: "Raporlar", icon: FileText, implemented: true },
  { id: "validation", label: "Doğrulama", icon: TestTubeDiagonal, implemented: true },
];

type ApiState = "checking" | "online" | "offline";

function useApiStatus(): ApiState {
  const [status, setStatus] = useState<ApiState>("checking");
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${API_BASE_URL}/api/v1/health`, { signal: controller.signal })
      .then((response) => setStatus(response.ok ? "online" : "offline"))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("offline");
      });
    return () => controller.abort();
  }, []);
  return status;
}

function WorkspaceOverview() {
  const project = useWorkspace((state) => state.project);
  const rename = useWorkspace((state) => state.renameProject);
  const diagnostics = useMemo(() => validateProjectGeometry(project), [project]);
  const errorCount = diagnostics.filter((item) => item.severity === "error").length;

  return (
    <main className="overview">
      <div className="overview-title">
        <span className="eyebrow">PROJE KONTROLÜ</span>
        <h1>Çalışma Alanı</h1>
        <p>Proje verileri, model bütünlüğü ve uygulama durumu. Kinematik çıktılar, bağımsız takım veya CAD ölçümleriyle karşılaştırılana kadar doğrulanmamış olarak kalır.</p>
      </div>
      <div className="overview-grid">
        <section className="overview-card span-two">
          <span className="eyebrow">ETKİN PROJE</span>
          <label htmlFor="project-name">Proje adı</label>
          <input id="project-name" value={project.name} maxLength={120} onChange={(event) => rename(event.target.value)} />
          <dl>
            <div><dt>Şema</dt><dd>{project.schemaVersion}</dd></div>
            <div><dt>Sınıflandırma</dt><dd>{uiStatus(project.dataClassification)}</dd></div>
            <div><dt>Model durumu</dt><dd>{uiStatus(project.modelStatus)}</dd></div>
            <div><dt>Etkin köşe</dt><dd>{uiCorner(project.activeCornerId)}</dd></div>
          </dl>
        </section>
        <section className="overview-card">
          <span className="eyebrow">BÜTÜNLÜK</span>
          <div className={errorCount ? "integrity error" : "integrity ok"}>
            {errorCount ? <AlertTriangle /> : <CheckCircle2 />}
            <strong>{errorCount ? `${errorCount} engelleyici hata` : "Statik kontroller geçti"}</strong>
          </div>
          <p>Bu durum yalnızca statik girdi kontrollerini kapsar; mekanizma hareketliliğini veya fiziksel doğrulamayı kapsamaz.</p>
        </section>
        <section className="overview-card">
          <span className="eyebrow">VERİ UYARISI</span>
          <h2>Gösterim geometrisi</h2>
          <p>Yerleşik koordinatlar sentetiktir ve MSKU Racing araç ölçümleri olarak kullanılmamalıdır.</p>
        </section>
        <section className="overview-card span-two">
          <span className="eyebrow">UYGULAMA KAPSAMI</span>
          <h2>Faz 0–6 mühendislik platformu</h2>
          <p>Dört köşe araç modeli, geometri, rijit bağlantı kinematiği, korumalı yük hesapları, referanslanmış doğrusal dinamik, optimizasyon, raporlama ve kanıta dayalı doğrulama iş akışları açık model sınırlarıyla kullanılabilir.</p>
        </section>
      </div>
    </main>
  );
}

function UnsupportedModule({ module }: { module: (typeof modules)[number] }) {
  const Icon = module.icon;
  return (
    <main className="not-implemented">
      <div className="not-implemented-mark"><Icon size={28} /></div>
      <span className="eyebrow">MODEL KULLANILABİLİRLİĞİ</span>
      <h1>{module.label}</h1>
      <strong>Henüz uygulanmadı</strong>
      <p>Yer tutucu grafik, kuvvet veya simülasyon değeri gösterilmez. Bu modül yalnızca mühendislik modeli, tanılama ve doğrulama testleri tamamlandıktan sonra etkinleştirilecektir.</p>
    </main>
  );
}

export function App() {
  const activeModule = useWorkspace((state) => state.activeModule);
  const setActiveModule = useWorkspace((state) => state.setActiveModule);
  const project = useWorkspace((state) => state.project);
  const apiStatus = useApiStatus();
  const activeDefinition = modules.find((item) => item.id === activeModule) ?? modules[0];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src="/msku-racing-logo.png" alt="MSKU Racing logosu" />
          <div className="brand-copy"><strong>DİNAMİK STÜDYOSU</strong><span>MÜHENDİSLİK PLATFORMU</span></div>
        </div>
        <nav aria-label="Mühendislik modülleri">
          {modules.map((module) => {
            const Icon = module.icon;
            return (
              <button key={module.id} type="button" className={activeModule === module.id ? "active" : ""} onClick={() => setActiveModule(module.id)}>
                <Icon size={14} /><span>{module.label}</span>{!module.implemented && <i title="Henüz uygulanmadı" />}
              </button>
            );
          })}
        </nav>
        <button className="mobile-menu" type="button" aria-label="Gezinmeyi aç"><Menu /></button>
        <div className={`api-state ${apiStatus}`}><i />API {apiStatus === "online" ? "çevrimiçi" : apiStatus === "offline" ? "çevrimdışı" : "kontrol ediliyor"}</div>
        <AnsysConnectionPanel />
      </header>

      <div className="projectbar">
        <div className="project-identity">
          <span>{project.name}</span>
          <b>{uiStatus(project.dataClassification).toUpperCase()} · {uiStatus(project.modelStatus).toUpperCase()}</b>
        </div>
        <ProjectActions />
      </div>

      {activeModule === "vehicle" ? (
        <Suspense fallback={<main className="not-implemented"><span className="eyebrow">DÖRT KÖŞE ARAÇ YÜKLENİYOR</span></main>}>
          <FullVehicleWorkspace />
        </Suspense>
      ) : activeModule === "geometry" ? (
        <div className="geometry-workspace">
          <GeometryToolbar />
          <SuspensionViewport />
          <GeometryInspector />
        </div>
      ) : activeModule === "kinematics" ? (
        <Suspense fallback={<main className="not-implemented"><span className="eyebrow">SAYISAL ÇALIŞMA ALANI YÜKLENİYOR</span></main>}>
          <KinematicsWorkspace />
        </Suspense>
      ) : activeModule === "loads" ? (
        <Suspense fallback={<main className="not-implemented"><span className="eyebrow">YARI STATİK ÇALIŞMA ALANI YÜKLENİYOR</span></main>}>
          <QuasiStaticWorkspace />
        </Suspense>
      ) : activeModule === "dynamics" ? (
        <Suspense fallback={<main className="not-implemented"><span className="eyebrow">DİNAMİK ÇALIŞMA ALANI YÜKLENİYOR</span></main>}>
          <DynamicsWorkspace />
        </Suspense>
      ) : activeModule === "optimization" ? (
        <Suspense fallback={<main className="not-implemented"><span className="eyebrow">OPTİMİZASYON ÇALIŞMA ALANI YÜKLENİYOR</span></main>}>
          <OptimizationWorkspace />
        </Suspense>
      ) : activeModule === "reports" ? (
        <Suspense fallback={<main className="not-implemented"><span className="eyebrow">İZLENEBİLİR RAPOR HAZIRLANIYOR</span></main>}>
          <ReportsWorkspace />
        </Suspense>
      ) : activeModule === "comparison" ? (
        <Suspense fallback={<main className="not-implemented"><span className="eyebrow">GİRDİ KARŞILAŞTIRMASI YÜKLENİYOR</span></main>}>
          <ComparisonWorkspace />
        </Suspense>
      ) : activeModule === "validation" ? (
        <Suspense fallback={<main className="not-implemented"><span className="eyebrow">DOĞRULAMA KAYDI YÜKLENİYOR</span></main>}>
          <ValidationWorkspace />
        </Suspense>
      ) : activeModule === "workspace" ? (
        <WorkspaceOverview />
      ) : (
        <UnsupportedModule module={activeDefinition} />
      )}

      <footer className="statusbar">
        <span><i className="dot red" />MODEL: {uiStatus(project.modelStatus).toUpperCase()}</span>
        <span>EKSEN: SAĞ EL · +X İLERİ · +Y SOL · +Z YUKARI</span>
        <span>SAKLAMA: SI</span>
        <span>UYGULAMA 0.6.1</span>
        <span className="status-spacer" />
        <span>ŞEMA {project.schemaVersion}</span>
      </footer>
    </div>
  );
}

