import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("stage 5: filters, quantity quote, basket and idempotent acceptance", async () => {
  const directory = mkdtempSync(join(tmpdir(), "eve-market-e2e-"));
  const app = await electron.launch({
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
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await expect(
      page.getByRole("table", { name: "Торговые возможности" }),
    ).toBeVisible();
    const rows = page.locator(".data-row");
    await expect(rows.first()).toBeVisible();
    await page.getByRole("button", { name: "Все фильтры" }).click();
    const min = page.getByLabel("Фильтр прибыль");
    await min.fill("999999999999");
    await min.blur();
    await expect(
      page.getByText("Подходящих предложений пока нет"),
    ).toBeVisible();
    await min.fill("100000");
    await min.blur();
    await expect(rows.first()).toBeVisible();
    await rows.first().click();
    const before = await page.getByTestId("quote-cost").textContent();
    const quantity = page.getByLabel("Количество в партии");
    const q = Number(await quantity.inputValue());
    await quantity.fill(String(Math.floor(q / 2)));
    await expect(page.getByTestId("quote-cost")).not.toHaveText(before!);
    await page.getByRole("button", { name: "Добавить в корзину" }).click();
    await expect(page.getByText(/Корзина · 1 поз/)).toBeVisible();
    await page
      .getByRole("button", { name: "Взять сделку", exact: true })
      .click();
    await expect(
      page.getByText("Сделка добавлена в текущие. Бюджет зарезервирован."),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/market-selected-1440.png" });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
