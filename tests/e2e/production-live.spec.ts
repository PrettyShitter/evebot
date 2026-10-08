import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("local production tab loads live public ESI data without GitHub or SSO", async () => {
  test.skip(process.env.EVE_LIVE_TEST !== "1", "Run only with pnpm test:e2e:live");
  test.setTimeout(180_000);
  const directory = mkdtempSync(join(tmpdir(), "eve-production-live-"));
  const app = await electron.launch({
    args: ["."],
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
    await expect(page.getByText("DEV · live ESI")).toBeVisible();
    await expect(page.getByLabel("Недостающие ESI scopes")).toContainText("esi-skills.read_skillqueue.v1");
    await expect(page.getByLabel("Недостающие ESI scopes")).toContainText("esi-characters.read_standings.v1");
    const update = page.getByRole("button", { name: /Обновить данные ESI|Обновляем ESI/ });
    await expect(update).toBeVisible();
    const syncStatus = page.getByLabel("Статус обновления ESI");
    await expect.poll(async () => syncStatus.innerText(), { timeout: 120_000 })
      .toMatch(/Публичные данные ESI обновлены|обновление ESI не удалось/i);
    await expect(syncStatus).toContainText("Публичные данные ESI обновлены");
    await expect(update).toBeEnabled();
    await expect(page.getByText("Ошибка ESI", { exact: false })).toHaveCount(0);
    const facilityMetric = page.getByText("Площадки в Jita/Perimeter").locator("..");
    await expect(facilityMetric).toContainText(/[1-9][\d,]*/);
    const indexMetric = page.getByText("Индексы системы и активности").locator("..");
    await expect(indexMetric).toContainText(/[1-9][\d,]*/);
    const contractsPanel = page.locator('[aria-label="Публичные контракты с копиями чертежей"]');
    await expect(contractsPanel).toBeVisible();
    await expect(contractsPanel.getByText(/проверено/)).toBeVisible();
    await expect(contractsPanel).not.toContainText("ESI не дал полный список контрактов");
    const expandContracts = contractsPanel.getByRole("button", { name: /Показать все контракты/ });
    if (await expandContracts.count()) {
      await expect(contractsPanel.locator("article")).toHaveCount(5);
      await expandContracts.click();
      expect(await contractsPanel.locator("article").count()).toBeGreaterThan(5);
      await contractsPanel.getByRole("button", { name: "Свернуть список контрактов" }).click();
      await expect(contractsPanel.locator("article")).toHaveCount(5);
    }
    await expect(page.getByText("Баланс основы · без торгового haircut")).toBeVisible();
    await expect(page.getByText(/CCP от 4 февраля 2026/)).toBeVisible();
    await page.getByLabel("Фильтр вида производства").selectOption("reprocessing");
    await expect(page.getByLabel("Предложения переработки")).toBeVisible();
    await expect(page.getByLabel("Производственные предложения")).toHaveCount(0);
    const sortBy = page.getByLabel("Сортировка производства");
    await expect
      .poll(() => sortBy.locator('option[value="slotHour"]').evaluate((option) => (option as HTMLOptionElement).disabled))
      .toBe(true);
    await expect(sortBy).toHaveValue("profit");
    await page.getByLabel("Фильтр вида производства").selectOption("manufacturing");
    await expect(page.getByLabel("Производственные предложения")).toBeVisible();
    await expect(page.getByLabel("Предложения переработки")).toHaveCount(0);
    await expect.poll(() => sortBy.locator('option[value="slotHour"]').evaluate((option) => (option as HTMLOptionElement).disabled)).toBe(false);
    await page.getByLabel("Фильтр вида производства").selectOption("all");
    const structureId = page.getByRole("textbox", { name: "ID структуры в Jita/Perimeter" });
    const addStructure = page.getByRole("button", { name: "Добавить структуру" });
    await structureId.fill("0");
    await expect(addStructure).toBeDisabled();
    await structureId.fill("1030000000001");
    await page.getByRole("textbox", { name: "Название структуры из игры" }).fill("QA Structure (manual candidate)");
    await page.getByRole("combobox", { name: "Система структуры" }).selectOption("30000142");
    await addStructure.click();
    const savedProfiles = page.getByLabel("Сохранённые профили площадок");
    await expect(savedProfiles).toContainText("QA Structure (manual candidate)");
    await expect(savedProfiles).toContainText("доступ не подтверждён");
    await expect(savedProfiles).toContainText("ручное добавление");
    await expect(page.getByRole("combobox", { name: "Площадка производства" })).toHaveValue("1030000000001");
    await expect(page.getByRole("button", { name: "Сохранить подтверждённый профиль" })).toBeDisabled();
    const structureCoverage = page.getByText("Рынки структур в Jita/Perimeter").locator("..");
    await expect(structureCoverage).not.toContainText("1030000000001");
    const maxCost = page.getByRole("spinbutton", { name: "Максимальная себестоимость партии" });
    await maxCost.fill("25000000");
    await expect(maxCost).toHaveValue("25000000");
    await maxCost.clear();
    const minProfit = page.getByRole("spinbutton", { name: "Минимальная чистая прибыль производства" });
    await minProfit.fill("5000000");
    await expect(minProfit).toHaveValue("5000000");
    await minProfit.clear();
    const typeFilter = page.getByRole("textbox", { name: "Фильтр типа предмета производства" });
    await typeFilter.fill("Afterburner");
    await expect(typeFilter).toHaveValue("Afterburner");
    await typeFilter.clear();
    await page.getByLabel("Сценарий продажи").selectOption("sellOrder");
    await page.getByLabel("Сортировка производства").selectOption("roi");
    await expect(page.getByText("Последняя синхронизация:")).not.toContainText("нет данных");
    await page.getByRole("combobox", { name: "Площадка производства" }).selectOption({ index: 1 });
    const accessConfirmed = page.getByRole("checkbox", { name: "Доступ к площадке подтверждён в игре" });
    const saveProfile = page.getByRole("button", { name: "Сохранить подтверждённый профиль" });
    await page.getByRole("textbox", { name: "Свидетельство профиля площадки" }).fill("Публичный ESI не подтверждает доступ к услугам");
    await expect(saveProfile).toBeDisabled();
    await accessConfirmed.check();
    await expect(saveProfile).toBeEnabled();
    // The live ESI smoke test has no in-game evidence. Verify the explicit gate,
    // then leave the isolated profile unconfirmed instead of manufacturing proof.
    await accessConfirmed.uncheck();
    await expect(page.getByText("Пока нет подтверждённых прибыльных партий")).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: "test-results/production-live-1280x800.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: "test-results/production-live-1440x900.png", fullPage: true });
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
