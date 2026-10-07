import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("packaged macOS app starts non-demo and reads live public ESI without GitHub", async () => {
  test.skip(process.env.EVE_PACKAGED_TEST !== "1", "Run after building the local macOS app bundle");
  test.skip(process.platform !== "darwin", "The packaged artifact under test is macOS arm64");
  test.setTimeout(180_000);
  const directory = mkdtempSync(join(tmpdir(), "eve-production-packaged-"));
  const executablePath = resolve("release/mac-arm64/EVE Trader.app/Contents/MacOS/EVE Trader");
  const app = await electron.launch({
    executablePath,
    args: [],
    timeout: 60_000,
    env: {
      ...process.env,
      EVE_DEMO: "0",
      EVE_OFFLINE: "1",
      EVE_USER_DATA: directory,
    },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("tab", { name: "Производство" }).click();
    await expect(page.getByText("DEMO", { exact: true })).toHaveCount(0);
    const refresh = page.getByRole("button", { name: "Обновить данные ESI" });
    await refresh.click();
    await expect(refresh).toBeEnabled({ timeout: 120_000 });
    await expect(page.getByText("Ошибка ESI", { exact: false })).toHaveCount(0);
    await expect(page.getByText("Площадки в Jita/Perimeter").locator("..")).toContainText(/[1-9][\d,]*/);
    await expect(page.getByText("Индексы системы и активности").locator("..")).toContainText(/[1-9][\d,]*/);
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: "test-results/production-packaged-1280x800.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: "test-results/production-packaged-1440x900.png", fullPage: true });
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
