import type { Project } from "@msku/contracts";
import { parseProject } from "@msku/contracts";

export const PROJECT_STORAGE_KEY = "msku-racing:project:active:v2";
export const LEGACY_PROJECT_STORAGE_KEY = "msku-racing:project:active:v1";

export const serializeProject = (project: Project): string => JSON.stringify(project, null, 2);

export const deserializeProject = (value: string): Project => parseProject(JSON.parse(value) as unknown);

export const saveProjectLocally = (project: Project, storage: Storage = window.localStorage): void => {
  storage.setItem(PROJECT_STORAGE_KEY, serializeProject(project));
};

export const loadProjectLocally = (storage: Storage = window.localStorage): Project | null => {
  const raw = storage.getItem(PROJECT_STORAGE_KEY) ?? storage.getItem(LEGACY_PROJECT_STORAGE_KEY);
  return raw ? deserializeProject(raw) : null;
};

export const downloadProject = (project: Project): void => {
  const blob = new Blob([serializeProject(project)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const safeName = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  anchor.href = url;
  anchor.download = `${safeName || "msku-project"}.msku.json`;
  anchor.click();
  URL.revokeObjectURL(url);
};

