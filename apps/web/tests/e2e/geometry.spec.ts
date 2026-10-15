import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("edits geometry and runs the constrained kinematics workflow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("DYNAMICS STUDIO")).toBeVisible();
  await expect(page.getByTestId("suspension-viewport")).toBeVisible();

  await page.getByLabel("Selected hardpoint").selectOption("uca_outboard");
  const x = page.getByLabel("X");
  await x.fill("15.00");
  await x.press("Enter");
  await expect(x).toHaveValue("15.00");

  await page.getByRole("button", { name: "Kinematics" }).click();
  await expect(page.getByText("SOLVED STATE")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("converged", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("ALIGNMENT", { exact: true })).toBeVisible();
  await expect(page.getByText("SOLVER DIAGNOSTICS", { exact: true })).toBeVisible();
  await expect(page.getByText("CALCULATION QUALITY", { exact: true })).toBeVisible();
  await expect(page.getByText("VERIFIED_NUMERICALLY", { exact: true })).toBeVisible();
  await expect(page.getByText("REFERENCE_BENCHMARKED", { exact: true })).toBeVisible();
  await expect(page.getByText("UNVALIDATED_PHYSICALLY", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeEnabled();

  const slider = page.getByLabel("Wheel travel");
  await slider.fill("30");
  await expect(page.getByText("25.0 mm", { exact: true })).toBeVisible();
});

test("runs guarded quasi-static force, load-transfer, and actuation calculations", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Loads" }).click();

  await expect(page.getByText("UPRIGHT CONTACT WRENCH", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approved export disabled" })).toBeDisabled();

  await page.getByRole("button", { name: "Synthetic preset" }).click();
  await page.getByRole("button", { name: "Solve", exact: true }).click();
  await expect(page.getByRole("cell", { name: "explicit_actuation_link" })).toBeVisible();
  await expect(page.getByText("REFERENCE_BENCHMARKED", { exact: true })).toBeVisible();
  await expect(page.getByText("UNVALIDATED_PHYSICALLY", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Calculate load transfer" }).click();
  await expect(page.getByText("FL", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Calculate motion ratio" }).click();
  await expect(page.getByText("Motion ratio", { exact: true })).toBeVisible();
  await expect(page.getByText("Wheel rate", { exact: true })).toBeVisible();
});

test("runs a traceable quarter-car simulation and animates calculated samples", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Dynamics" }).click();

  await expect(page.getByText("MODEL SELECTION", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export unvalidated CSV" })).toBeDisabled();
  await page.getByRole("button", { name: "Run simulation" }).click();

  await expect(page.getByText("VERIFIED_NUMERICALLY", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("REFERENCE_BENCHMARKED", { exact: true })).toBeVisible();
  await expect(page.getByText("UNVALIDATED_PHYSICALLY", { exact: true })).toBeVisible();
  await expect(page.getByText("NOT_APPROVED", { exact: true })).toBeVisible();
  await expect(page.getByText("DISPLACEMENT RESPONSE", { exact: true })).toBeVisible();
  await expect(page.getByTestId("quarter-car-animation")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export unvalidated CSV" })).toBeEnabled();

  const timeSlider = page.getByLabel("Simulation time");
  await timeSlider.fill("100");
  await expect(page.getByText("0.500 s", { exact: true })).toBeVisible();
});

test("runs a deterministic bounded optimization and reports the candidate", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Optimization" }).click();

  await expect(page.getByText("MODEL & OBJECTIVES", { exact: true })).toBeVisible();
  await page.getByLabel("Verified model").selectOption("bicycle");
  await page.getByLabel("Weighted multi-objective + Pareto").uncheck();
  await page.getByLabel("parameters.rearCorneringStiffnessNPerRad").uncheck();
  await page.getByLabel("Generations").fill("50");
  await page.getByRole("button", { name: "Run optimization" }).click();

  await expect(page.getByText("VERIFIED_NUMERICALLY", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("BASELINE VS CANDIDATE", { exact: true })).toBeVisible();
  await expect(page.getByText("LOCAL SENSITIVITY", { exact: true })).toBeVisible();
  await expect(page.getByText("UNVALIDATED_PHYSICALLY", { exact: true })).toBeVisible();
  await expect(page.getByText("NOT_APPROVED", { exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "Optimization" }).click();
  await page.getByLabel("Weighted multi-objective + Pareto").uncheck();
  await page.getByRole("button", { name: "Run optimization" }).click();
  await expect(page.getByRole("button", { name: "Apply to active project" })).toBeEnabled();

  await page.getByRole("button", { name: "Geometry" }).click();
  await page.getByLabel("Selected hardpoint").selectOption("tie_rod_inboard");
  await expect(page.getByRole("spinbutton", { name: "Y mm" })).toHaveValue("290.00");

  await page.getByRole("button", { name: "Optimization" }).click();
  await page.getByLabel("Weighted multi-objective + Pareto").uncheck();
  await page.getByRole("button", { name: "Run optimization" }).click();
  await page.getByRole("button", { name: "Apply to active project" }).click();
  await page.getByRole("button", { name: "Geometry" }).click();
  await page.getByLabel("Selected hardpoint").selectOption("tie_rod_inboard");
  await expect(page.getByRole("spinbutton", { name: "Y mm" })).toHaveValue("300.00");
});

