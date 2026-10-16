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
    setNotice("Yeni gösterim projesi oluşturuldu.");
  };

  const save = () => {
    try {
      saveProjectLocally(project);
      setNotice("Yerel olarak kaydedildi.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Yerel kayıt başarısız oldu.");
    }
  };

  const load = () => {
    try {
      const loaded = loadProjectLocally();
      if (!loaded) {
        setNotice("Yerel proje bulunamadı.");
        return;
      }
      const loadedDiagnostics = validateProjectGeometry(loaded);
      if (loadedDiagnostics.some((item) => item.severity === "error")) {
        setNotice("Kayıtlı proje, geometrisinde hata bulunduğu için reddedildi.");
        return;
      }
      replaceProject(loaded);
      setNotice("Yerel proje yüklendi.");
    } catch (error) {
      setNotice(error instanceof Error ? `Yükleme başarısız: ${error.message}` : "Yükleme başarısız.");
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = parseProject(JSON.parse(await file.text()) as unknown);
      const importedDiagnostics = validateProjectGeometry(parsed);
      if (importedDiagnostics.some((item) => item.severity === "error")) {
        setNotice(`İçe aktarma reddedildi: ${importedDiagnostics.find((item) => item.severity === "error")?.message ?? "geçersiz geometri"}`);
        return;
      }
      replaceProject(parsed);
      setNotice("Proje içe aktarıldı ve doğrulandı.");
    } catch (error) {
      setNotice(error instanceof Error ? `İçe aktarma başarısız: ${error.message}` : "İçe aktarma başarısız.");
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="project-actions">
      <button type="button" onClick={newProject}><FilePlus2 size={14} /> Yeni</button>
      <button type="button" onClick={save} disabled={hasErrors} title={hasErrors ? "Kaydetmeden önce geometri hatalarını çözün" : "Bu tarayıcıya kaydet"}><Save size={14} /> Kaydet</button>
      <button type="button" onClick={load}><FolderOpen size={14} /> Yükle</button>
      <button type="button" onClick={() => input.current?.click()}><Upload size={14} /> İçe aktar</button>
      <button type="button" onClick={() => downloadProject(project)} disabled={hasErrors} title={hasErrors ? "Dışa aktarmadan önce geometri hatalarını çözün" : "Sürümlü JSON dışa aktar"}><Download size={14} /> Dışa aktar</button>
      <input ref={input} type="file" accept=".json,.msku.json,application/json" hidden onChange={(event) => void importFile(event.target.files?.[0])} />
      <span className="action-notice" role="status">{notice}</span>
    </div>
  );
}

