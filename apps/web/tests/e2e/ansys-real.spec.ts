import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

const enabled = process.env.MSKU_REAL_ANSYS_E2E === "1";
const token = process.env.MSKU_ANSYS_BRIDGE_TOKEN ?? "";
const cadPath = process.env.MSKU_ANSYS_SMOKE_CAD ?? "";
const pinnedCadSha = "49756ab321a4736c5ba94a318e5bf38363a032c8a9c210a817ce1910c1a201f8";

test("real browser → local bridge → Mechanical mesh study → browser", async ({ page }) => {
  test.skip(!enabled, "Opt-in; requires a local licensed ANSYS Student installation and bridge.");
  test.setTimeout(600_000);
  expect(token.length).toBeGreaterThanOrEqual(32);
  expect(createHash("sha256").update(readFileSync(cadPath)).digest("hex")).toBe(pinnedCadSha);

  let completedJob: {
    state: string;
    result: {
      maximumVonMisesStressPa: number;
      maximumTotalDeformationM: number;
      solverStatus: string;
      geometrySha256: string;
      units: string;
      validationStatus: string;
      shapeCheckInSolverInput: boolean;
      meshConvergence: { status: string; points: Array<{ meshElements: number }> } | null;
      warnings: string[];
    } | null;
  } | null = null;
  page.on("response", async (response) => {
    if (response.url().includes("/bridge/v1/analyses/static-structural/") && response.ok()) {
      const job = await response.json() as typeof completedJob;
      if (job?.state === "SUCCEEDED") completedJob = job;
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: "ANSYS YEREL" }).click();
  const panel = page.getByRole("region", { name: "ANSYS yerel bağlantı durumu" });
  const analysis = page.getByRole("region", { name: "Static Structural analizi" });
  await page.getByPlaceholder("Bridge konsolundaki token").fill(token);
  await page.getByRole("button", { name: "Durumu yenile" }).click();
  await expect(panel.getByRole("status")).toContainText("köprü hazır");
  await page.getByRole("button", { name: "Mechanical'ı başlat" }).click();
  await expect(panel.getByRole("status")).toContainText("proses doğrulandı", { timeout: 210_000 });
  await expect(panel).toContainText("Aktif ve yazılabilir");

  await analysis.getByLabel("Sabit mesnet seçimi").fill("NS_Fixed");
  await analysis.getByLabel("Kuvvet yüzeyi seçimi").fill("NS_Face_1");
  await analysis.getByLabel("Kuvvet ekseni").selectOption("X");
  await analysis.getByLabel("Kuvvet (N)").fill("1000");
  await analysis.getByLabel("Mesh boyutu (mm)").fill("300");
  await analysis.getByRole("checkbox", { name: /Üç kademeli mesh yakınsama/ }).check();
  await analysis.getByLabel("CAD yolu (.agdb, .pmdb, .step, .stp)").fill(`${cadPath}.missing.agdb`);
  await analysis.getByRole("button", { name: "Analizi açıkça başlat" }).click();
  await expect(analysis.getByRole("alert")).toContainText("CAD dosyası okunamadı");
  await expect(analysis).not.toContainText("Maks. von Mises");

  await analysis.getByLabel("CAD yolu (.agdb, .pmdb, .step, .stp)").fill(cadPath);
  await analysis.getByRole("button", { name: "Analizi açıkça başlat" }).click();
  await expect(analysis).toContainText("Mechanical çözümü ve sonuçları doğrulandı.", { timeout: 360_000 });
  expect(completedJob).not.toBeNull();
  const result = completedJob!.result;
  expect(result).not.toBeNull();
  expect(result!.solverStatus.split(".").at(-1)).toBe("Done");
  expect(result!.geometrySha256).toBe(pinnedCadSha);
  expect(result!.units).toBe("SI");
  expect(result!.validationStatus).toBe("NUMERIC_RESULT_UNVALIDATED_PHYSICALLY");
  expect(result!.shapeCheckInSolverInput).toBe(true);
  expect(result!.meshConvergence?.points).toHaveLength(3);
  expect(result!.meshConvergence?.status).toBe("NOT_CONVERGED");
  expect(result!.maximumVonMisesStressPa).toBeGreaterThan(0);
  expect(result!.maximumTotalDeformationM).toBeGreaterThan(0);
  await expect(analysis).toContainText(`${(result!.maximumVonMisesStressPa / 1e6).toPrecision(5)} MPa`);
  await expect(analysis).toContainText(`${(result!.maximumTotalDeformationM * 1e3).toPrecision(5)} mm`);
  await expect(analysis).toContainText("fiziksel olarak doğrulanmamıştır");
  await expect(analysis).toContainText("Şekil denetimi");
  await expect(analysis.getByRole("note", { name: "Mesh yakınsama değerlendirmesi" })).toContainText("yakınsama gösterilemedi");
  await expect(analysis.getByRole("note", { name: "Analiz uyarıları" })).toContainText("sayısal yakınsama ölçütünü karşılamadı");
  await expect(analysis.getByRole("note", { name: "Analiz uyarıları" })).toContainText("MP/TB");
  for (const warning of result!.warnings) {
    await expect(analysis.getByRole("note", { name: "Analiz uyarıları" })).toContainText(warning);
  }
  console.log(JSON.stringify({
    solverStatus: result!.solverStatus,
    maximumVonMisesStressPa: result!.maximumVonMisesStressPa,
    maximumTotalDeformationM: result!.maximumTotalDeformationM,
    warnings: result!.warnings,
  }));
});
