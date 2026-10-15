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

