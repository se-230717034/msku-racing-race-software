import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("shows compatibility and verifies an explicit-path Mechanical launch", async ({ page }) => {
  const token = "browser-session-token";
  let processVerified = false;
  let startedByBridge = false;
  let analysisStarted = false;
  const connection = () => ({
    state: processVerified ? "VERIFIED" : "NOT_TESTED",
    processVerified,
    licenseVerified: processVerified,
    startedByBridge,
    host: "127.0.0.1",
    port: 10000,
    checkedAt: processVerified ? "2026-10-20T18:00:00Z" : null,
    mechanicalVersion: processVerified ? "261" : null,
    productInfo: processVerified ? "Ansys Mechanical [Student] Product Version:261" : null,
    errorCode: null,
    message: processVerified ? "Gerçek Ansys Mechanical prosesi PyMechanical ile doğrulandı." : "Henüz test edilmedi.",
  });
  await page.route("http://127.0.0.1:8765/bridge/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/health/live")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          status: "ok",
          service: "msku-ansys-local-bridge",
          version: "0.3.0",
          scope: "localhost_only",
          tokenConfigured: true,
        }),
      });
      return;
    }
    expect(route.request().headers()["x-msku-bridge-token"]).toBe(token);
    if (path.endsWith("/connection/test")) {
      expect(route.request().method()).toBe("POST");
      processVerified = true;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(connection()) });
      return;
    }
    if (path.endsWith("/connection/launch")) {
      expect(route.request().method()).toBe("POST");
      processVerified = true;
      startedByBridge = true;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(connection()) });
      return;
    }
    if (path.endsWith("/analyses/static-structural") && route.request().method() === "POST") {
      analysisStarted = true;
      expect(route.request().postDataJSON()).toMatchObject({
        material: "Structural Steel",
        fixedNamedSelection: "NS_Fixed",
        forceNamedSelection: "NS_Force",
        forceN: 1000,
      });
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({
        jobId: "11111111-1111-4111-8111-111111111111",
        state: "QUEUED", stage: "queued", message: "İş kuyruğa alındı",
        startedAt: "2026-10-21T10:00:00Z", completedAt: null, errorCode: null, result: null,
      }) });
      return;
    }
    if (path.includes("/analyses/static-structural/") && analysisStarted) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({
        jobId: "11111111-1111-4111-8111-111111111111",
        state: "SUCCEEDED", stage: "done", message: "Mechanical çözümü tamamlandı",
        startedAt: "2026-10-21T10:00:00Z", completedAt: "2026-10-21T10:00:10Z", errorCode: null,
        result: {
          solverStatus: "Done", maximumVonMisesStressPa: 1250,
          maximumTotalDeformationM: 0.0002, meshNodes: 500, meshElements: 200,
          geometrySha256: "a".repeat(64), material: "Structural Steel",
          fixedNamedSelection: "NS_Fixed", forceNamedSelection: "NS_Force",
          forceAxis: "X", forceN: 1000, meshSizeMm: 25,
          mechanicalVersion: "261", productInfo: "Ansys Mechanical",
          units: "SI", validationStatus: "NUMERIC_RESULT_UNVALIDATED_PHYSICALLY", warnings: ["MAPDL 3 uyarı bildirdi."],
        },
      }) });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        service: "msku-ansys-local-bridge",
        version: "0.3.0",
        transport: "localhost_token_wnua",
        adapter: {
          adapter: "pymechanical",
          state: "READY_FOR_CONNECTION_TEST",
          ansysConnected: processVerified,
          simulationsEnabled: false,
          capabilities: ["windows_installation_detection", "existing_process_connection_test"],
          message: "Kurulum bulundu; gerçek proses bağlantısı kullanıcı isteğiyle test edilebilir.",
          installation: {
            platform: "Windows",
            state: "FOUND",
            selected: {
              versionCode: 261,
              release: "2026 R1",
              productKind: "student",
              executablePath: "C:/Program Files/ANSYS Inc/ANSYS Student/v261/aisol/bin/winx64/AnsysWBU.exe",
              source: "AWP_ROOT261",
            },
            installations: [],
            warnings: [],
          },
          compatibility: {
            state: "COMPATIBLE",
            pymechanicalVersion: "0.13.4",
            pythonVersion: "3.12",
            minimumMechanicalVersionCode: 242,
            message: "Uyumlu.",
          },
          connection: connection(),
        },
        warnings: ["STATIC_STRUCTURAL_REQUIRES_EXPLICIT_LOCAL_ACTION"],
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "ANSYS YEREL" }).click();
  const panel = page.getByRole("region", { name: "ANSYS yerel bağlantı durumu" });
  await expect(panel.getByRole("status")).toContainText("token gerekli");
  await page.getByPlaceholder("Bridge konsolundaki token").fill(token);
  await page.getByRole("button", { name: "Durumu yenile" }).click();

  await expect(panel.getByRole("status")).toContainText("köprü hazır");
  await expect(page.getByText("2026 R1 · Student")).toBeVisible();
  await expect(page.getByText("0.13.4 · Uyumlu")).toBeVisible();
  await expect(page.getByText("Test edilmedi")).toBeVisible();
  await page.getByRole("button", { name: "Mechanical'ı başlat" }).click();
  await expect(panel.getByRole("status")).toContainText("proses doğrulandı");
  await expect(page.getByText("Gerçek proses doğrulandı").first()).toBeVisible();
  await expect(page.getByText("Aktif ve yazılabilir")).toBeVisible();
  await expect(page.getByText("Açık yoldan yerel bridge")).toBeVisible();
  await expect(page.getByText("Yalnızca açık kullanıcı eylemiyle")).toBeVisible();
  const analysis = page.getByRole("region", { name: "Static Structural analizi" });
  await analysis.getByLabel("CAD yolu (.agdb, .pmdb, .step, .stp)").fill("C:\\CAD\\small.agdb");
  await analysis.getByLabel("Sabit mesnet seçimi").fill("NS_Fixed");
  await analysis.getByLabel("Kuvvet yüzeyi seçimi").fill("NS_Force");
  await analysis.getByLabel("Kuvvet ekseni").selectOption("X");
  await analysis.getByLabel("Kuvvet (N)").fill("1000");
  await analysis.getByRole("button", { name: "Analizi açıkça başlat" }).click();
  // The UI polls explicit jobs every 2 s; allow slower CI/browser startup.
  await expect(analysis).toContainText("Mechanical çözümü tamamlandı", { timeout: 15_000 });
  await expect(analysis).toContainText("0.0012500 MPa");
  await expect(analysis).toContainText("fiziksel olarak doğrulanmamıştır.");
  await expect(analysis.getByRole("note", { name: "Analiz uyarıları" })).toContainText("MAPDL 3 uyarı bildirdi.");
});

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

  const viewport = page.getByTestId("suspension-viewport");
  await expect(viewport).toHaveAttribute("data-coilover-status", "SOLVED_ACTUATION_GEOMETRY");
  const initialRockerAngle = Number(await viewport.getAttribute("data-rocker-angle-rad"));
  const initialCoiloverLength = Number(await viewport.getAttribute("data-coilover-length-m"));
  const slider = page.getByLabel("Tekerlek hareketi");
  await slider.fill("30");
  await expect(page.getByText("25.0 mm", { exact: true })).toBeVisible();
  await expect(viewport).toHaveAttribute("data-coilover-status", "SOLVED_ACTUATION_GEOMETRY");
  const movedRockerAngle = Number(await viewport.getAttribute("data-rocker-angle-rad"));
  const movedCoiloverLength = Number(await viewport.getAttribute("data-coilover-length-m"));
  const pushrodResidual = Number(await viewport.getAttribute("data-pushrod-residual-m"));
  expect(Math.abs(movedRockerAngle - initialRockerAngle)).toBeGreaterThan(1e-4);
  expect(Math.abs(movedCoiloverLength - initialCoiloverLength)).toBeGreaterThan(1e-5);
  expect(pushrodResidual).toBeLessThan(1e-7);
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
  await expect(vehicleViewport).toHaveAttribute("data-coilover-status", "SOLVED_ACTUATION_GEOMETRY");
  await expect(vehicleViewport).toHaveAttribute("data-coilover-count", "4");
  await expect(vehicleViewport).toHaveAttribute(
    "data-coilover-mounted-corners",
    "front_left,front_right,rear_left,rear_right",
  );
  await expect(vehicleViewport).toHaveAttribute(
    "data-coilover-missing-corners",
    "",
  );
  await expect(page.getByText("COILOVER MONTAJ DENETİMİ · FL:DEMO · FR:DEMO · RL:DEMO · RR:DEMO", { exact: true })).toBeVisible();
  await expect(page.getByText("DEMO/SENTETİK PUSHROD–ROCKER–COILOVER", { exact: false })).toBeVisible();
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
  await expect(suspensionViewport).toHaveAttribute("data-coilover-status", "SOLVED_ACTUATION_GEOMETRY");
  await expect(page.getByText("GLB COILOVER · İKİ GÖZ ÇÖZÜLMÜŞ", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "coilover (montaj verisi gerekir)", exact: true }).click();
  await expect(suspensionViewport).toHaveAttribute("data-coilover-status", "HIDDEN");
  await page.getByRole("button", { name: "coilover (montaj verisi gerekir)", exact: true }).click();
  await expect(suspensionViewport).toHaveAttribute("data-coilover-status", "SOLVED_ACTUATION_GEOMETRY");
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
  await expect(suspensionViewport).toHaveAttribute("data-coilover-status", "SOLVED_ACTUATION_GEOMETRY");
  await expect(page.getByText("DEMO/SENTETİK AKTÜASYON", { exact: false })).toBeVisible();
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

test("uses solved synthetic demo actuation without the unsupported representative layer", async ({ page }) => {
  await page.goto("/");
  const vehicleViewport = page.getByTestId("full-vehicle-viewport");
  await expect(vehicleViewport).toHaveAttribute("data-coilover-status", "SOLVED_ACTUATION_GEOMETRY");
  await expect(vehicleViewport).toHaveAttribute("data-coilover-count", "4");
  await page.getByRole("button", { name: /temsili çalıştırma/i }).click({ force: true });
  await page.waitForTimeout(1_000);
  await expect(vehicleViewport).toHaveAttribute("data-glb-ready", "true", { timeout: 30_000 });
  await expect(page.getByTestId("representative-actuation-layer")).toHaveCount(0);
  await expect(page.getByText("DEMO/SENTETİK PUSHROD–ROCKER–COILOVER", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Geometri" }).click();
  await page.waitForTimeout(1_000);
  await expect(page.getByTestId("suspension-viewport")).toHaveAttribute("data-glb-ready", "true", { timeout: 30_000 });
  await expect(page.getByText("DEMO/SENTETİK AKTÜASYON", { exact: false })).toBeVisible();
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

