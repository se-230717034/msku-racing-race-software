import { parseProject } from "@msku/contracts";
import { Download, FilePlus2, FolderOpen, Save, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { validateProjectGeometry } from "../domain/geometry";
import { downloadProject, loadProjectLocally, saveProjectLocally } from "../lib/projectStorage";
import { useWorkspace } from "../store/workspace";

export function ProjectActions() {
  const project = useWorkspace((state) => state.project);
  const replaceProject = useWorkspace((state) => state.replaceProject);
  const resetDemo = useWorkspace((state) => state.resetDemo);
  const diagnostics = useMemo(() => validateProjectGeometry(project), [project]);
  const hasErrors = diagnostics.some((item) => item.severity === "error");
  const input = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string>("");

  const newProject = () => {
    const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `demo-${Date.now()}`;
    resetDemo(id);
    setNotice("New demonstration project created.");
  };

  const save = () => {
    try {
      saveProjectLocally(project);
      setNotice("Saved locally.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Local save failed.");
    }
  };

  const load = () => {
    try {
      const loaded = loadProjectLocally();
      if (!loaded) {
        setNotice("No local project found.");
        return;
      }
      const loadedDiagnostics = validateProjectGeometry(loaded);
      if (loadedDiagnostics.some((item) => item.severity === "error")) {
        setNotice("Stored project was rejected because its geometry contains errors.");
        return;
      }
      replaceProject(loaded);
      setNotice("Local project loaded.");
    } catch (error) {
      setNotice(error instanceof Error ? `Load failed: ${error.message}` : "Load failed.");
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = parseProject(JSON.parse(await file.text()) as unknown);
      const importedDiagnostics = validateProjectGeometry(parsed);
      if (importedDiagnostics.some((item) => item.severity === "error")) {
        setNotice(`Import rejected: ${importedDiagnostics.find((item) => item.severity === "error")?.message ?? "invalid geometry"}`);
        return;
      }
      replaceProject(parsed);
      setNotice("Project imported and validated.");
    } catch (error) {
      setNotice(error instanceof Error ? `Import failed: ${error.message}` : "Import failed.");
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="project-actions">
      <button type="button" onClick={newProject}><FilePlus2 size={14} /> New</button>
      <button type="button" onClick={save} disabled={hasErrors} title={hasErrors ? "Resolve geometry errors before saving" : "Save to this browser"}><Save size={14} /> Save</button>
      <button type="button" onClick={load}><FolderOpen size={14} /> Load</button>
      <button type="button" onClick={() => input.current?.click()}><Upload size={14} /> Import</button>
      <button type="button" onClick={() => downloadProject(project)} disabled={hasErrors} title={hasErrors ? "Resolve geometry errors before exporting" : "Export versioned JSON"}><Download size={14} /> Export</button>
      <input ref={input} type="file" accept=".json,.msku.json,application/json" hidden onChange={(event) => void importFile(event.target.files?.[0])} />
      <span className="action-notice" role="status">{notice}</span>
    </div>
  );
}

