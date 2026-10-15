import { expect, test } from "@playwright/test";

test("edits geometry and exposes unavailable modules honestly", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("DYNAMICS STUDIO")).toBeVisible();
  await expect(page.getByTestId("suspension-viewport")).toBeVisible();

  await page.getByLabel("Selected hardpoint").selectOption("uca_outboard");
  const x = page.getByLabel("X");
  await x.fill("15.00");
  await x.press("Enter");
  await expect(x).toHaveValue("15.00");

  await page.getByRole("button", { name: "Kinematics" }).click();
  await expect(page.getByRole("heading", { name: "Kinematics" })).toBeVisible();
  await expect(page.getByText("Not implemented", { exact: true })).toBeVisible();
});

