import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Store } from "../../db/store";

test("unknown public BPC attributes can be confirmed in the desktop UI", async () => {
  const directory = mkdtempSync(join(tmpdir(), "eve-bpc-confirm-"));
  const contractId = "9988776655";
  const observedAt = new Date().toISOString();
  const store = new Store(join(directory, "demo.sqlite"), resolve("db/migrations"));
  store.sql.prepare(
    `INSERT INTO production_contract_sources(contract_id,region_id,location_id,contract_type,status,price,expires_at,items_payload,observed_at,coverage_status)
     VALUES (?,?,?,'item_exchange','outstanding',?,?,?,?, 'available')`,
  ).run(
    contractId,
    "10000002",
    "60003760",
    "1000",
    new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    JSON.stringify({
      title: "Unknown blueprint fixture",
      blueprintOnly: true,
      includedItemCount: 1,
      items: [{
        recordId: "9988776656",
        typeId: "683",
        quantity: 1,
        isBlueprintCopy: true,
        materialEfficiency: null,
        timeEfficiency: null,
        runs: null,
      }],
    }),
    observedAt,
  );
  store.close();

  let app = await electron.launch({
    args: ["."],
    env: { ...process.env, EVE_DEMO: "1", EVE_OFFLINE: "1", EVE_USER_DATA: directory },
  });
  try {
    let page = await app.firstWindow();
    await page.getByRole("tab", { name: "Производство" }).click();
    const panel = page.locator('[aria-label="Публичные контракты с копиями чертежей"]');
    const row = panel.locator("article").filter({ hasText: `#${contractId}` });
    await expect(row).toContainText("Атрибуты неизвестны");
    const copyButton = row.locator('button[aria-label^="Скопировать "]').first();
    const copiedName = (await copyButton.getAttribute("aria-label"))?.replace(/^Скопировать /, "");
    expect(copiedName).toBeTruthy();
    await copyButton.click();
    await expect(page.locator('[role="status"]').filter({ hasText: `Скопировано: ${copiedName}` })).toBeVisible();
    await expect(row).toContainText("Атрибуты неизвестны");
    await expect(row.getByRole("spinbutton", { name: `ME контракта ${contractId}, запись 9988776656` })).toBeVisible();
    await row.getByRole("spinbutton", { name: `ME контракта ${contractId}, запись 9988776656` }).fill("0");
    await row.getByRole("spinbutton", { name: `TE контракта ${contractId}, запись 9988776656` }).fill("0");
    await row.getByRole("spinbutton", { name: `Прогоны контракта ${contractId}, запись 9988776656` }).fill("2");
    await row.getByRole("textbox", { name: `Свидетельство контракта ${contractId}, запись 9988776656` }).fill("Проверено в клиенте EVE");
    await row.getByRole("button", { name: "Подтвердить атрибуты из игры" }).click();
    await expect(row).toContainText("вручную");
    await expect(row).toContainText("ME 0 · TE 0 · 2 runs");
    await expect(row).toContainText("Проверено в клиенте EVE");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await app.close();
    app = await electron.launch({
      args: ["."],
      env: { ...process.env, EVE_DEMO: "1", EVE_OFFLINE: "1", EVE_USER_DATA: directory },
    });
    page = await app.firstWindow();
    await page.getByRole("tab", { name: "Производство" }).click();
    const reopenedRow = page.locator('[aria-label="Публичные контракты с копиями чертежей"] article').filter({ hasText: `#${contractId}` });
    await expect(reopenedRow).toContainText("ME 0 · TE 0 · 2 runs");
    await expect(reopenedRow).toContainText("Проверено в клиенте EVE");
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
