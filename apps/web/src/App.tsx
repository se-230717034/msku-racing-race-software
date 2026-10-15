import { Activity, AlertTriangle, Box, CheckCircle2, Database, Gauge, GitCompareArrows, Menu, Route, TestTubeDiagonal, Waypoints } from "lucide-react";
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

const modules: Array<{ id: ModuleId; label: string; icon: typeof Box; implemented: boolean }> = [
  { id: "workspace", label: "Workspace", icon: Database, implemented: true },
  { id: "geometry", label: "Geometry", icon: Box, implemented: true },
  { id: "kinematics", label: "Kinematics", icon: Waypoints, implemented: true },
  { id: "dynamics", label: "Dynamics", icon: Activity, implemented: false },
  { id: "road", label: "Road", icon: Route, implemented: false },
  { id: "optimization", label: "Optimization", icon: Gauge, implemented: false },
  { id: "reports", label: "Reports", icon: GitCompareArrows, implemented: false },
  { id: "validation", label: "Validation", icon: TestTubeDiagonal, implemented: false },
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
            <div><dt>Corner</dt><dd>front-left</dd></div>
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
          <h2>Phase 0–2 engineering foundation</h2>
          <p>The geometry workflow and rigid-link kinematics solver are operational. Loads, dynamics, road simulation, optimization, and reporting remain deliberately unavailable until their models and validation tests exist.</p>
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

      {activeModule === "geometry" ? (
        <div className="geometry-workspace">
          <GeometryToolbar />
          <SuspensionViewport />
          <GeometryInspector />
        </div>
      ) : activeModule === "kinematics" ? (
        <Suspense fallback={<main className="not-implemented"><span className="eyebrow">LOADING NUMERICAL WORKSPACE</span></main>}>
          <KinematicsWorkspace />
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
        <span className="status-spacer" />
        <span>SCHEMA {project.schemaVersion}</span>
      </footer>
    </div>
  );
}

