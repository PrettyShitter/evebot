import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("shell: four tabs, production data panel, restricted preload and settings survive restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "eve-e2e-"));
  const launch = () =>
    electron.launch({
      args: ["."],
      env: {
        ...process.env,
        EVE_OFFLINE: "1",
        EVE_USER_DATA: directory,
        EVE_DEMO: "1",
      },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await expect(page.getByText("DEMO", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Текущие сделки" }).click();
    await expect(page.getByText("Текущих сделок пока нет")).toBeVisible();
    await page.getByRole("tab", { name: "Закрытые сделки" }).click();
    await expect(
      page.getByText("История начинается с первой сделки"),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Рынок", exact: true }).click();
    await page.getByRole("tab", { name: "Производство" }).click();
    await expect(page.getByRole("heading", { name: "Производство", exact: true })).toBeVisible();
    await expect(page.getByText("DEV · live ESI")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Обновить данные ESI" })).toBeDisabled();
    await page.screenshot({ path: "test-results/production-demo-1280.png" });
    await expect(page.getByText(/4[\s,.]?867/)).toBeVisible();
    await page.getByRole("tab", { name: "Мои проекты" }).click();
    await expect(page.getByText("Проектов пока нет")).toBeVisible();
    await page.getByRole("tab", { name: "Возможности" }).click();
    expect(
      await page.evaluate(
        () => typeof (window as unknown as { require?: unknown }).require,
      ),
    ).toBe("undefined");
    expect(await page.evaluate(() => Object.keys(window.eve))).toEqual([
      "request",
    ]);
    await expect(
      page.evaluate(() => window.eve.request({ kind: "sql" } as never)),
    ).rejects.toThrow();
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Обновления приложения" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Проверить обновления", exact: true }),
    ).toBeDisabled();
    await page
      .getByLabel("Минимальная прибыль", { exact: true })
      .fill("7654321");
    await page.getByRole("button", { name: "Сохранить настройки" }).click();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: "test-results/shell-1280.png" });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25),
    );
    await page.screenshot({ path: "test-results/shell-1440-125.png" });
    expect(errors).toEqual([]);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await expect(
      page.getByLabel("Минимальная прибыль", { exact: true }),
    ).toHaveValue("7654321");
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
