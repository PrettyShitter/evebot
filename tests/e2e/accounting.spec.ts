import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("stage 7: desktop selection, imported operations, review and explicit closing survives restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "eve-accounting-e2e-"));
  let app = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      EVE_OFFLINE: "1",
      EVE_USER_DATA: directory,
      EVE_DEMO: "1",
    },
  });
  try {
    const page = await app.firstWindow();
    await page.locator(".data-row").first().click();
    await page.getByRole("button", { name: "Добавить в корзину" }).click();
    await page
      .getByRole("button", { name: "Взять сделку", exact: true })
      .click();
    await page.getByRole("tab", { name: /Текущие сделки/ }).click();
    await page.getByRole("button", { name: "Маршрут и подробности" }).click();
    await page
      .getByRole("button", { name: "DEMO: загрузить покупки и продажи" })
      .click();
    await page.getByRole("button", { name: "Это покупка сделки" }).click();
    await expect(page.getByText("Готово к закрытию")).toBeVisible();
    await page
      .getByRole("button", { name: "Все расходы сделки сопоставлены" })
      .click();
    await expect(
      page.getByRole("button", { name: "ПРОДАЛ", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "ПРОДАЛ", exact: true }).click();
    await expect(page.getByText("Текущих сделок пока нет")).toBeVisible();
    await page.getByRole("tab", { name: /Закрытые сделки/ }).click();
    await expect(
      page.getByText("Подтверждённая прибыль за всё время:"),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/closed-deal.png" });
    await app.close();
    app = await electron.launch({
      args: ["."],
      env: {
        ...process.env,
        EVE_OFFLINE: "1",
        EVE_USER_DATA: directory,
        EVE_DEMO: "1",
      },
    });
    const restarted = await app.firstWindow();
    await restarted.getByRole("tab", { name: /Закрытые сделки/ }).click();
    await expect(
      restarted.getByText("Подтверждённая прибыль за всё время:"),
    ).toBeVisible();
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
