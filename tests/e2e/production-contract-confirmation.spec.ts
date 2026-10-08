import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("production shows craft opportunities without a standalone public-contract inventory", async () => {
  const directory = mkdtempSync(join(tmpdir(), "eve-bpc-offers-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, EVE_DEMO: "1", EVE_OFFLINE: "1", EVE_USER_DATA: directory },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("tab", { name: "Производство" }).click();
    const offers = page.locator('[aria-label="Производственные предложения"]');
    await expect(offers).toBeVisible();
    await expect(offers.getByRole("heading", { name: "Выгодные предложения крафта" })).toBeVisible();
    await expect(offers).toContainText("публичные BPC-контракты");
    await expect(page.locator('[aria-label="Публичные контракты с копиями чертежей"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Подтвердить атрибуты из игры" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
