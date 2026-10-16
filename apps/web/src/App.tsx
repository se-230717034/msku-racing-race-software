import { Activity, AlertTriangle, Box, Car, CheckCircle2, Database, FileText, Gauge, GitCompareArrows, Menu, Route, Scale, TestTubeDiagonal, Waypoints } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import { GeometryInspector } from "./components/GeometryInspector";
import { GeometryToolbar } from "./components/GeometryToolbar";
import { ProjectActions } from "./components/ProjectActions";
import { SuspensionViewport } from "./components/SuspensionViewport";
import { validateProjectGeometry } from "./domain/geometry";
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
  { id: "workspace", label: "Workspace", icon: Database, implemented: true },
  { id: "vehicle", label: "Vehicle", icon: Car, implemented: true },
  { id: "geometry", label: "Geometry", icon: Box, implemented: true },
  { id: "kinematics", label: "Kinematics", icon: Waypoints, implemented: true },
  { id: "loads", label: "Loads", icon: Scale, implemented: true },
  { id: "dynamics", label: "Dynamics", icon: Activity, implemented: true },
  { id: "road", label: "Road", icon: Route, implemented: false },
  { id: "optimization", label: "Optimization", icon: Gauge, implemented: true },
  { id: "comparison", label: "Compare", icon: GitCompareArrows, implemented: true },
  { id: "reports", label: "Reports", icon: FileText, implemented: true },
  { id: "validation", label: "Validation", icon: TestTubeDiagonal, implemented: true },
];

type ApiState = "checking" | "online" | "offline";

function useApiStatus(): ApiState {
  const [status, setStatus] = useState<ApiState>("checking");
  useEffect(() => {
    const controller = new AbortController();
    const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
    void fetch(`${baseUrl}/api/v1/health`, { signal: controller.signal })
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
        <span className="eyebrow">PROJECT CONTROL</span>
        <h1>Workspace</h1>
        <p>Project data, model integrity, and implementation status. Kinematics outputs remain explicitly unvalidated until comparison with independent team or CAD measurements.</p>
      </div>
      <div className="overview-grid">
        <section className="overview-card span-two">
          <span className="eyebrow">ACTIVE PROJECT</span>
          <label htmlFor="project-name">Project name</label>
          <input id="project-name" value={project.name} maxLength={120} onChange={(event) => rename(event.target.value)} />
          <dl>
            <div><dt>Schema</dt><dd>{project.schemaVersion}</dd></div>
            <div><dt>Classification</dt><dd>{project.dataClassification}</dd></div>
            <div><dt>Model status</dt><dd>{project.modelStatus}</dd></div>
            <div><dt>Active corner</dt><dd>{project.activeCornerId.replace("_", " ")}</dd></div>
          </dl>
        </section>
        <section className="overview-card">
          <span className="eyebrow">INTEGRITY</span>
          <div className={errorCount ? "integrity error" : "integrity ok"}>
            {errorCount ? <AlertTriangle /> : <CheckCircle2 />}
            <strong>{errorCount ? `${errorCount} blocking error${errorCount === 1 ? "" : "s"}` : "Static checks pass"}</strong>
          </div>
          <p>This status covers static input checks only, not mechanism mobility or physical validation.</p>
        </section>
        <section className="overview-card">
          <span className="eyebrow">DATA NOTICE</span>
          <h2>Demonstration geometry</h2>
          <p>The included coordinates are synthetic and must not be treated as MSKU Racing vehicle measurements.</p>
        </section>
        <section className="overview-card span-two">
          <span className="eyebrow">IMPLEMENTATION GATE</span>
          <h2>Phase 0–6 engineering platform</h2>
          <p>The four-corner vehicle assembly, geometry, rigid-link kinematics, guarded loads, benchmarked linear dynamics, optimization, reporting, and evidence-led validation workflows are available with explicit model boundaries.</p>
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
      <span className="eyebrow">MODEL AVAILABILITY</span>
      <h1>{module.label}</h1>
      <strong>Not implemented</strong>
      <p>No placeholder plots, forces, or simulation values are shown. This module will be enabled only after the engineering model, diagnostics, and validation tests are implemented.</p>
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
          <div className="brand-mark">M</div>
          <div><strong>MSKU RACING</strong><span>DYNAMICS STUDIO</span></div>
        </div>
        <nav aria-label="Engineering modules">
          {modules.map((module) => {
            const Icon = module.icon;
            return (
              <button key={module.id} type="button" className={activeModule === module.id ? "active" : ""} onClick={() => setActiveModule(module.id)}>
                <Icon size={14} /><span>{module.label}</span>{!module.implemented && <i title="Not implemented" />}
              </button>
            );
          })}
        </nav>
        <button className="mobile-menu" type="button" aria-label="Open navigation"><Menu /></button>
        <div className={`api-state ${apiStatus}`}><i />API {apiStatus}</div>
      </header>

      <div className="projectbar">
        <div className="project-identity">
          <span>{project.name}</span>
          <b>{project.dataClassification.replaceAll("_", " ").toUpperCase()} · {project.modelStatus.replaceAll("_", " ").toUpperCase()}</b>
        </div>
        <ProjectActions />
      </div>

      {activeModule === "vehicle" ? (
        <Suspense fallback={<main className="not-implemented"><span className="eyebrow">LOADING FOUR-CORNER VEHICLE</span></main>}>
          <FullVehicleWorkspace />
        </Suspense>
      ) : activeModule === "geometry" ? (
        <div className="geometry-workspace">
          <GeometryToolbar />
          <SuspensionViewport />
          <GeometryInspector />
        </div>
      ) : activeModule === "kinematics" ? (
        <Suspense fallback={<main className="not-implemented"><span className="eyebrow">LOADING NUMERICAL WORKSPACE</span></main>}>
          <KinematicsWorkspace />
        </Suspense>
      ) : activeModule === "loads" ? (
        <Suspense fallback={<main className="not-implemented"><span className="eyebrow">LOADING QUASI-STATIC WORKSPACE</span></main>}>
          <QuasiStaticWorkspace />
        </Suspense>
      ) : activeModule === "dynamics" ? (
        <Suspense fallback={<main className="not-implemented"><span className="eyebrow">LOADING DYNAMICS WORKSPACE</span></main>}>
          <DynamicsWorkspace />
        </Suspense>
      ) : activeModule === "optimization" ? (
        <Suspense fallback={<main className="not-implemented"><span className="eyebrow">LOADING OPTIMIZATION WORKSPACE</span></main>}>
          <OptimizationWorkspace />
        </Suspense>
      ) : activeModule === "reports" ? (
        <Suspense fallback={<main className="not-implemented"><span className="eyebrow">BUILDING TRACEABLE REPORT</span></main>}>
          <ReportsWorkspace />
        </Suspense>
      ) : activeModule === "comparison" ? (
        <Suspense fallback={<main className="not-implemented"><span className="eyebrow">LOADING INPUT COMPARISON</span></main>}>
          <ComparisonWorkspace />
        </Suspense>
      ) : activeModule === "validation" ? (
        <Suspense fallback={<main className="not-implemented"><span className="eyebrow">LOADING VALIDATION REGISTER</span></main>}>
          <ValidationWorkspace />
        </Suspense>
      ) : activeModule === "workspace" ? (
        <WorkspaceOverview />
      ) : (
        <UnsupportedModule module={activeDefinition} />
      )}

      <footer className="statusbar">
        <span><i className="dot red" />MODEL: {project.modelStatus.replaceAll("_", " ").toUpperCase()}</span>
        <span>FRAME: RH · +X FWD · +Y LEFT · +Z UP</span>
        <span>STORAGE: SI</span>
        <span>APP 0.6.0</span>
        <span className="status-spacer" />
        <span>SCHEMA {project.schemaVersion}</span>
      </footer>
    </div>
  );
}

