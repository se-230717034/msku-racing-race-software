import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

const enabled = process.env.MSKU_REAL_ANSYS_E2E === "1";
const token = process.env.MSKU_ANSYS_BRIDGE_TOKEN ?? "";
const cadPath = process.env.MSKU_ANSYS_SMOKE_CAD ?? "";
const cadSha = "49756ab321a4736c5ba94a318e5bf38363a032c8a9c210a817ce1910c1a201f8";

type StaticJob = {
  jobId: string;
  state: string;
  errorCode: string | null;
  stage: string;
  result: null | {
    solverStatus: string;
    geometrySha256: string;
    maximumVonMisesStressPa: number;
    maximumTotalDeformationM: number;
    validationStatus: string;
  };
};

type ModalJob = {
  jobId: string;
  state: string;
  errorCode: string | null;
  stage: string;
  result: null | {
    solverStatus: string;
    geometrySha256: string;
    modes: Array<{ frequencyHz: number }>;
    validationStatus: string;
    meshConvergenceStatus: string;
  };
};

test("three sequential real browser → bridge → Static + Modal → browser runs", async ({ page }, testInfo) => {
  test.skip(!enabled, "Opt-in real licensed local ANSYS Student workflow.");
  test.setTimeout(1_200_000);
  expect(token.length).toBeGreaterThanOrEqual(32);
  expect(createHash("sha256").update(readFileSync(cadPath)).digest("hex")).toBe(cadSha);

  const evidence: Array<Record<string, unknown>> = [];
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "ANSYS YEREL" }).click();
    const panel = page.getByRole("region", { name: "ANSYS yerel bağlantı durumu" });
    const analysis = page.getByRole("region", { name: "Static Structural analizi" });
    const modal = page.getByRole("region", { name: "Modal analiz" });
    await page.getByPlaceholder("Bridge konsolundaki token").fill(token);
    await page.getByRole("button", { name: "Durumu yenile" }).click();
    await expect(panel.getByRole("status")).toContainText("köprü hazır");
    await page.getByRole("button", { name: "Mechanical'ı başlat" }).click();
    await expect(panel.getByRole("status")).toContainText("proses doğrulandı", { timeout: 210_000 });
    await expect(panel).toContainText("Aktif ve yazılabilir");
    await analysis.getByLabel("CAD yolu (.agdb, .pmdb, .step, .stp)").fill(cadPath);
    await analysis.getByLabel("Sabit mesnet seçimi").fill("NS_Fixed");
    await analysis.getByLabel("Kuvvet yüzeyi seçimi").fill("NS_Face_1");
    await analysis.getByLabel("Kuvvet ekseni").selectOption("X");
    await analysis.getByLabel("Kuvvet (N)").fill("1000");
    await analysis.getByLabel("Mesh boyutu (mm)").fill("500");

    for (let run = 1; run <= 3; run += 1) {
      const record: Record<string, unknown> = { run, startedAt: new Date().toISOString() };
      evidence.push(record);
      const staticStarted = Date.now();
      const staticResponse = page.waitForResponse(async (response) => {
        if (!response.url().includes("/bridge/v1/analyses/static-structural/") || !response.ok()) return false;
        const body = await response.json() as StaticJob;
        return body.state === "SUCCEEDED" || body.state === "FAILED";
      }, { timeout: 300_000 });
      await analysis.getByRole("button", { name: "Analizi açıkça başlat" }).click();
      const staticJob = await (await staticResponse).json() as StaticJob;
      record.static = {
        seconds: (Date.now() - staticStarted) / 1000,
        jobId: staticJob.jobId,
        state: staticJob.state,
        stage: staticJob.stage,
        errorCode: staticJob.errorCode,
        solverStatus: staticJob.result?.solverStatus,
      };
      console.log(JSON.stringify({ event: "real-static", ...record.static as object, run }));
      expect(staticJob.state).toBe("SUCCEEDED");
      expect(staticJob.result?.solverStatus).toBe("Done");
      expect(staticJob.result?.geometrySha256).toBe(cadSha);
      expect(staticJob.result?.maximumVonMisesStressPa).toBeGreaterThan(0);
      expect(staticJob.result?.maximumTotalDeformationM).toBeGreaterThan(0);
      expect(staticJob.result?.validationStatus).toBe("NUMERIC_RESULT_UNVALIDATED_PHYSICALLY");
      await expect(analysis).toContainText("fiziksel olarak doğrulanmamıştır");

      const modalStarted = Date.now();
      const modalResponse = page.waitForResponse(async (response) => {
        if (!response.url().includes("/bridge/v1/analyses/modal/") || !response.ok()) return false;
        const body = await response.json() as ModalJob;
        return body.state === "SUCCEEDED" || body.state === "FAILED";
      }, { timeout: 300_000 });
      await modal.getByRole("button", { name: "Modal analizi açıkça başlat" }).click();
      const modalJob = await (await modalResponse).json() as ModalJob;
      record.modal = {
        seconds: (Date.now() - modalStarted) / 1000,
        jobId: modalJob.jobId,
        state: modalJob.state,
        stage: modalJob.stage,
        errorCode: modalJob.errorCode,
        solverStatus: modalJob.result?.solverStatus,
      };
      console.log(JSON.stringify({ event: "real-modal", ...record.modal as object, run }));
      expect(modalJob.state).toBe("SUCCEEDED");
      expect(modalJob.result?.solverStatus).toBe("Done");
      expect(modalJob.result?.geometrySha256).toBe(cadSha);
      expect(modalJob.result?.modes).toHaveLength(3);
      expect(modalJob.result?.modes.every((mode) => Number.isFinite(mode.frequencyHz) && mode.frequencyHz > 0)).toBe(true);
      expect(modalJob.result?.validationStatus).toBe("NUMERIC_RESULT_UNVALIDATED_PHYSICALLY");
      expect(modalJob.result?.meshConvergenceStatus).toBe("NOT_ASSESSED");
      await expect(modal).toContainText("fiziksel olarak doğrulanmamıştır");
      record.completedAt = new Date().toISOString();
    }
  } finally {
    await testInfo.attach("real-ansys-repeat-evidence", {
      body: JSON.stringify(evidence, null, 2),
      contentType: "application/json",
    });
  }
});
