import { expect, test } from "@playwright/test";

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
  await expect(page.getByText("SOLVED STATE")).toBeVisible();
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

