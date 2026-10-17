import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("edits geometry and runs the constrained kinematics workflow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("img", { name: "MSKU Racing logosu" })).toBeVisible();
  await expect(page.getByText("DİNAMİK STÜDYOSU")).toBeVisible();
  await expect(page.getByTestId("full-vehicle-viewport")).toBeVisible();
  for (const corner of ["front-left", "front-right", "rear-left", "rear-right"]) {
    await expect(page.getByTestId(`wheel-assembly-${corner}`)).toBeAttached();
  }
  await page.getByRole("button", { name: "Geometri" }).click();
  await expect(page.getByTestId("suspension-viewport")).toBeVisible();

  await page.getByLabel("Seçili bağlantı noktası").selectOption("uca_outboard");
  const x = page.getByLabel("X");
  await x.fill("15.00");
  await x.press("Enter");
  await expect(x).toHaveValue("15.00");

  await page.getByRole("button", { name: "Kinematik" }).click();
  await expect(page.getByText("ÇÖZÜLMÜŞ DURUM")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("yakınsadı", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("ROT AYARI", { exact: true })).toBeVisible();
  await expect(page.getByText("ÇÖZÜCÜ TANILAMA", { exact: true })).toBeVisible();
  await expect(page.getByText("HESAP KALİTESİ", { exact: true })).toBeVisible();
  await expect(page.getByText("Sayısal olarak doğrulandı", { exact: true })).toBeVisible();
  await expect(page.getByText("Referansla karşılaştırıldı", { exact: true })).toBeVisible();
  await expect(page.getByText("Fiziksel olarak doğrulanmadı", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "CSV dışa aktar" })).toBeEnabled();

  const slider = page.getByLabel("Tekerlek hareketi");
  await slider.fill("30");
  await expect(page.getByText("25.0 mm", { exact: true })).toBeVisible();
});

test("renders four distinct assemblies at the configured wheelbase and tracks", async ({ page }) => {
  await page.goto("/");
  const positions = await Promise.all(["front-left", "front-right", "rear-left", "rear-right"].map(async (corner) => {
    const assembly = page.getByTestId(`wheel-assembly-${corner}`);
    return {
      x: Number(await assembly.getAttribute("data-x")),
      y: Number(await assembly.getAttribute("data-y")),
      z: Number(await assembly.getAttribute("data-z")),
    };
  }));
  expect(new Set(positions.map((point) => `${point.x}/${point.y}/${point.z}`)).size).toBe(4);
  expect(positions[0].x - positions[2].x).toBeCloseTo(1.6, 10);
  expect(positions[0].y - positions[1].y).toBeCloseTo(1.44, 10);
  expect(positions[2].y - positions[3].y).toBeCloseTo(1.4, 10);
  await expect(page.getByText("Şasi zarfı ve aks çizgileri yalnızca referanstır", { exact: false })).toBeVisible();
});

test("switches the shared Turkish CAD view modes without changing engineering data", async ({ page }) => {
  await page.goto("/");
  const vehicleViewport = page.getByTestId("full-vehicle-viewport");
  await expect(vehicleViewport).toHaveAttribute("data-cad-mode", "detailed");
  await page.getByRole("button", { name: "Teknik görünüm" }).click();
  await expect(vehicleViewport).toHaveAttribute("data-cad-mode", "technical");

  await page.getByRole("button", { name: "Geometri" }).click();
  const suspensionViewport = page.getByTestId("suspension-viewport");
  await expect(suspensionViewport).toHaveAttribute("data-cad-mode", "technical");
  await page.getByRole("button", { name: "Detaylı görünüm" }).click();
  await expect(suspensionViewport).toHaveAttribute("data-cad-mode", "detailed");
  await page.getByRole("button", { name: "Karma görünüm" }).click();
  await expect(suspensionViewport).toHaveAttribute("data-cad-mode", "hybrid");
});

test("loads the six GLB assets and retains the procedural fallback", async ({ page }) => {
  test.setTimeout(60_000);
  const pageErrors: string[] = [];
  let stage = "initial-load";
  page.on("pageerror", (error) => pageErrors.push(`${stage}: ${error.stack ?? error.message}`));
  await page.goto("/");
  const vehicleViewport = page.getByTestId("full-vehicle-viewport");
  await expect(vehicleViewport).toHaveAttribute("data-visual-model-source", "glb");
  await expect(vehicleViewport).toHaveAttribute("data-glb-ready", "true", { timeout: 30_000 });
  await expect(vehicleViewport).toHaveAttribute("data-coilover-status", "MISSING_ACTUATION_HARDPOINTS");
  await expect(vehicleViewport).toHaveAttribute("data-coilover-count", "0");
  await expect(vehicleViewport).toHaveAttribute("data-coilover-mounted-corners", "");
  await expect(vehicleViewport).toHaveAttribute(
    "data-coilover-missing-corners",
    "front_left,front_right,rear_left,rear_right",
  );
  await expect(page.getByText("COILOVER MONTAJ DENETİMİ · FL:EKSİK · FR:EKSİK · RL:EKSİK · RR:EKSİK", { exact: true })).toBeVisible();
  for (const file of ["wheel.glb", "brake.glb", "hub.glb", "upright.glb", "suspension.glb", "coilover.glb"]) {
    const response = await page.request.get(`/models/${file}`);
    expect(response.ok(), `${file} should be served`).toBe(true);
    expect((await response.body()).byteLength).toBeGreaterThan(10_000);
  }
  stage = "open-geometry";
  await page.getByRole("button", { name: "Geometri" }).click();
  const suspensionViewport = page.getByTestId("suspension-viewport");
  await expect(suspensionViewport).toHaveAttribute("data-visual-model-source", "glb");
  await expect(suspensionViewport).toHaveAttribute("data-glb-ready", "true");
  await expect(suspensionViewport).toHaveAttribute("data-coilover-status", "MISSING_ACTUATION_HARDPOINTS");
  await expect(page.getByText("GLB COILOVER GİZLENDİ · UPRIGHT/ROCKER/ŞASİ", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "coilover (montaj verisi gerekir)", exact: true }).click();
  await expect(suspensionViewport).toHaveAttribute("data-coilover-status", "HIDDEN");
  await page.getByRole("button", { name: "coilover (montaj verisi gerekir)", exact: true }).click();
  await expect(suspensionViewport).toHaveAttribute("data-coilover-status", "MISSING_ACTUATION_HARDPOINTS");
  await expect(page.getByText("ÖLÇEĞE UYARLANMIŞ GLB", { exact: false })).toBeVisible();
  stage = "switch-procedural";
  await page.getByRole("button", { name: "Prosedürel modelleri kullan" }).click();
  await expect(suspensionViewport).toHaveAttribute("data-visual-model-source", "procedural");
  await expect(page.getByText("PROSEDÜREL GÖRSEL", { exact: false })).toBeVisible();
  stage = "switch-glb";
  await page.getByRole("button", { name: "Hazır GLB modellerini kullan" }).click();
  await expect(suspensionViewport).toHaveAttribute("data-visual-model-source", "glb");
  stage = "load-suspension-reference";
  await page.getByRole("button", { name: /temsili çalıştırma/i }).click({ force: true });
  await expect(suspensionViewport).toHaveAttribute("data-coilover-status", "MISSING_ACTUATION_HARDPOINTS");
  await expect(page.getByText("TEMSİLİ PUSHROD/ROCKER · veri yok · hareketsiz", { exact: true })).toBeVisible();
  await page.waitForTimeout(750);
  expect(pageErrors).toEqual([]);
});

test("separates the single-corner mechanical layers and applies the mechanical-assembly view", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Geometri" }).click();
  const viewport = page.getByTestId("suspension-viewport");

  await expect(viewport).toHaveAttribute("data-tire-visible", "true");
  await expect(viewport).toHaveAttribute("data-rim-visible", "true");
  await expect(viewport).toHaveAttribute("data-brake-disc-visible", "true");
  await expect(viewport).toHaveAttribute("data-caliper-visible", "true");
  await expect(viewport).toHaveAttribute("data-hub-visible", "true");
  await expect(viewport).toHaveAttribute("data-reference-plane-visible", "false");
  await expect(page.getByText("ÖLÇEĞE UYARLANMIŞ GLB · BOYUTSAL/FİZİKSEL DOĞRULAMA YOK", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "üst salıncak", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "alt salıncak", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "rot kolu", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "coilover (montaj verisi gerekir)", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "fren diski", exact: true }).click();
  await expect(viewport).toHaveAttribute("data-brake-disc-visible", "false");
  await expect(viewport).toHaveAttribute("data-caliper-visible", "true");
  await page.getByRole("button", { name: "fren diski", exact: true }).click();

  await page.getByRole("button", { name: "Mekanik Montaj", exact: true }).click();
  await expect(viewport).toHaveAttribute("data-tire-visible", "false");
  await expect(viewport).toHaveAttribute("data-rim-visible", "false");
  await expect(viewport).toHaveAttribute("data-brake-disc-visible", "true");
  await expect(viewport).toHaveAttribute("data-caliper-visible", "true");
  await expect(viewport).toHaveAttribute("data-hub-visible", "true");
  await expect(viewport).toHaveAttribute("data-mechanical-assembly-active", "true");
  await expect(page.getByText("MEKANİK MONTAJ · LASTİK/JANT GİZLİ", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "referans düzlemi", exact: true }).click();
  await expect(viewport).toHaveAttribute("data-reference-plane-visible", "true");
});

test("keeps unsupported actuation in an explicit static representative layer", async ({ page }) => {
  await page.goto("/");
  const vehicleViewport = page.getByTestId("full-vehicle-viewport");
  await expect(vehicleViewport).toHaveAttribute("data-coilover-status", "MISSING_ACTUATION_HARDPOINTS");
  await expect(vehicleViewport).toHaveAttribute("data-coilover-count", "0");
  await expect(page.getByText("COILOVER GİZLENDİ · MONTAJ VERİSİ YOK", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: /temsili çalıştırma/i }).click({ force: true });
  await page.waitForTimeout(1_000);
  await expect(vehicleViewport).toHaveAttribute("data-glb-ready", "true", { timeout: 30_000 });
  const layer = page.getByTestId("representative-actuation-layer");
  await expect(layer).toHaveAttribute("data-status", "UNSUPPORTED_STATIC_REFERENCE");
  await expect(layer).toHaveAttribute("data-corner", "front_left");
  await expect(page.getByText("TEMSİLİ PUSHROD", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Geometri" }).click();
  await page.waitForTimeout(1_000);
  await expect(page.getByTestId("suspension-viewport")).toHaveAttribute("data-glb-ready", "true", { timeout: 30_000 });
  await expect(page.getByText("GLB COILOVER GİZLENDİ · UPRIGHT/ROCKER/ŞASİ", { exact: false })).toBeVisible();
});

test("keeps per-corner edits persistent and blocks unsupported playback", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Etkin araç köşesi").selectOption("rear_left");
  await page.getByRole("button", { name: "Geometri" }).click();
  await page.getByLabel("Seçili bağlantı noktası").selectOption("uca_outboard");
  const rearX = page.getByRole("spinbutton", { name: "X mm" });
  await rearX.fill("27.00");
  await rearX.press("Enter");
  await page.getByRole("button", { name: "Araç" }).click();
  await page.getByLabel("Etkin araç köşesi").selectOption("front_left");
  await page.getByRole("button", { name: "Geometri" }).click();
  await page.getByLabel("Seçili bağlantı noktası").selectOption("uca_outboard");
  await expect(page.getByRole("spinbutton", { name: "X mm" })).toHaveValue("10.00");
  await page.getByRole("button", { name: "Araç" }).click();
  await page.getByLabel("Etkin araç köşesi").selectOption("rear_left");
  await page.getByLabel("Araç görünüm modu").selectOption("kinematics");
  await expect(page.getByText("Önce bu köşenin çözücüsünü çalıştırın", { exact: false })).toBeVisible();
});

test("exposes traceable reports and evidence-led validation without auto approval", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Karşılaştır" }).click();
  await expect(page.getByRole("heading", { name: "Köşe karşılaştırması" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rijit bağlantı uzunluğu karşılaştırması" })).toBeVisible();
  await expect(page.getByText("Köşe taraması yok", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Raporlar" }).click();
  await expect(page.getByText("Mühendislik rapor paketi")).toBeVisible();
  await expect(page.getByRole("button", { name: "PDF indir" })).toBeEnabled();
  await expect(page.getByText("Onaylanmadı", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Dört köşe geometri diyagramları")).toBeVisible();
  await page.getByRole("button", { name: "Doğrulama" }).click();
  await expect(page.getByText("Fiziksel olarak doğrulanmadı", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mühendislik onayı yazılım üzerinden verilemez" })).toBeDisabled();
  await page.getByPlaceholder("ör. CAD hareket analizi karşılaştırması rev B").fill("Fikstür köken incelemesi");
  await page.getByPlaceholder("Kontrollü yol, çizim kimliği, test kimliği veya URI").fill("TEST-TRACE-001");
  await page.getByRole("button", { name: "İzlenebilirlik kaydı ekle" }).click();
  await expect(page.getByText("Fikstür köken incelemesi")).toBeVisible();
  await expect(page.getByText("Fiziksel olarak doğrulanmadı", { exact: true })).toBeVisible();
});

test("runs guarded quasi-static force, load-transfer, and actuation calculations", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Yükler" }).click();

  await expect(page.getByText("TAŞIYICI TEMAS KUVVET-MOMENTİ", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Onaylı dışa aktarma kapalı" })).toBeDisabled();

  await page.getByRole("button", { name: "Sentetik ön ayar" }).click();
  await page.getByRole("button", { name: "Çöz", exact: true }).click();
  await expect(page.getByRole("cell", { name: "explicit_actuation_link" })).toBeVisible();
  await expect(page.getByText("Referansla karşılaştırıldı", { exact: true })).toBeVisible();
  await expect(page.getByText("Fiziksel olarak doğrulanmadı", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Yük transferini hesapla" }).click();
  await expect(page.getByText("FL", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Hareket oranını hesapla" }).click();
  await expect(page.getByText("Hareket oranı", { exact: true })).toBeVisible();
  await expect(page.getByText("Tekerlek oranı", { exact: true })).toBeVisible();
});

test("runs a traceable quarter-car simulation and animates calculated samples", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Dinamik" }).click();

  await expect(page.getByText("MODEL SEÇİMİ", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Doğrulanmamış CSV dışa aktar" })).toBeDisabled();
  await page.getByRole("button", { name: "Simülasyonu çalıştır" }).click();

  await expect(page.getByText("Sayısal olarak doğrulandı", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Referansla karşılaştırıldı", { exact: true })).toBeVisible();
  await expect(page.getByText("Fiziksel olarak doğrulanmadı", { exact: true })).toBeVisible();
  await expect(page.getByText("Onaylanmadı", { exact: true })).toBeVisible();
  await expect(page.getByText("YER DEĞİŞTİRME YANITI", { exact: true })).toBeVisible();
  await expect(page.getByTestId("quarter-car-animation")).toBeVisible();
  await expect(page.getByRole("button", { name: "Doğrulanmamış CSV dışa aktar" })).toBeEnabled();

  const timeSlider = page.getByLabel("Simülasyon zamanı");
  await timeSlider.fill("100");
  await expect(page.getByText("0.500 s", { exact: true })).toBeVisible();
});

test("runs a deterministic bounded optimization and reports the candidate", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Optimizasyon" }).click();

  await expect(page.getByText("MODEL VE HEDEFLER", { exact: true })).toBeVisible();
  await page.getByLabel("Doğrulanmış model").selectOption("bicycle");
  await page.getByLabel("Ağırlıklı çoklu hedef + Pareto").uncheck();
  await page.getByLabel("parameters.rearCorneringStiffnessNPerRad").uncheck();
  await page.getByLabel("Nesiller").fill("50");
  await page.getByRole("button", { name: "Optimizasyonu çalıştır" }).click();

  await expect(page.getByText("Sayısal olarak doğrulandı", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("REFERANS VE ADAY", { exact: true })).toBeVisible();
  await expect(page.getByText("YEREL DUYARLILIK", { exact: true })).toBeVisible();
  await expect(page.getByText("Fiziksel olarak doğrulanmadı", { exact: true })).toBeVisible();
  await expect(page.getByText("Onaylanmadı", { exact: true })).toBeVisible();
});

test("keeps candidate preview non-mutating until explicit apply", async ({ page }) => {
  await page.route("**/api/v1/optimization/run", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: "1.0.0",
        model: "kinematics",
        calculationStatus: "VERIFIED_NUMERICALLY",
        validationStatus: {
          numerical: "VERIFIED_NUMERICALLY",
          reference: "REFERENCE_BENCHMARKED",
          physical: "UNVALIDATED_PHYSICALLY",
          engineeringApproval: "NOT_APPROVED",
        },
        solverVersion: "5.0.0",
        units: { designVariables: "SI", objectives: "rad", sensitivity: "rad/m" },
        availableObjectives: ["bump_steer_rms_rad", "camber_variation_rms_rad"],
        baseline: {
          variableValues: { "hardpoints.tie_rod_inboard.y": 0.29 },
          metrics: { bump_steer_rms_rad: 0.01 },
          normalizedObjectives: { bump_steer_rms_rad: 1 },
          weightedObjective: 1,
        },
        optimized: {
          variableValues: { "hardpoints.tie_rod_inboard.y": 0.3 },
          metrics: { bump_steer_rms_rad: 0.005 },
          normalizedObjectives: { bump_steer_rms_rad: 0.5 },
          weightedObjective: 0.5,
        },
        paretoFront: [],
        convergence: [{ generation: 1, bestWeightedObjective: 0.5, convergenceIndicator: 0.01 }],
        sensitivities: [{
          variablePath: "hardpoints.tie_rod_inboard.y",
          metricId: "bump_steer_rms_rad",
          derivative: -0.5,
          step: 0.000006,
          method: "central",
        }],
        diagnostics: {
          success: true,
          message: "accepted",
          method: "scipy_differential_evolution",
          evaluations: 20,
          feasibleEvaluations: 20,
          rejectedEvaluations: 0,
          generations: 1,
          seed: 2307,
        },
        provenance: {
          inputSha256: "a".repeat(64),
          dataClassification: "demonstration",
          sourceLabel: "Synthetic UI fixture",
        },
        warnings: ["PHYSICALLY_UNVALIDATED_OPTIMUM"],
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Optimizasyon" }).click();
  await page.getByLabel("Ağırlıklı çoklu hedef + Pareto").uncheck();
  await page.getByRole("button", { name: "Optimizasyonu çalıştır" }).click();
  await expect(page.getByRole("button", { name: "Etkin projeye uygula" })).toBeEnabled();

  await page.getByRole("button", { name: "Geometri" }).click();
  await page.getByLabel("Seçili bağlantı noktası").selectOption("tie_rod_inboard");
  await expect(page.getByRole("spinbutton", { name: "Y mm" })).toHaveValue("290.00");

  await page.getByRole("button", { name: "Optimizasyon" }).click();
  await page.getByLabel("Ağırlıklı çoklu hedef + Pareto").uncheck();
  await page.getByRole("button", { name: "Optimizasyonu çalıştır" }).click();
  await page.getByRole("button", { name: "Etkin projeye uygula" }).click();
  await page.getByRole("button", { name: "Geometri" }).click();
  await page.getByLabel("Seçili bağlantı noktası").selectOption("tie_rod_inboard");
  await expect(page.getByRole("spinbutton", { name: "Y mm" })).toHaveValue("300.00");
});

