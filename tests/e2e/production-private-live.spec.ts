import { test, expect, _electron as electron } from "@playwright/test";

test("authorized private production data syncs in non-demo Electron", async () => {
  test.skip(
    process.env.EVE_PRIVATE_LIVE_TEST !== "1" ||
      !process.env.EVE_PRIVATE_USER_DATA,
    "Set EVE_PRIVATE_LIVE_TEST=1 and EVE_PRIVATE_USER_DATA to a locally authorized profile",
  );
  test.setTimeout(180_000);

  const app = await electron.launch({
    args: ["."],
    timeout: 60_000,
    env: {
      ...process.env,
      EVE_DEMO: "0",
      EVE_OFFLINE: "0",
      EVE_USER_DATA: process.env.EVE_PRIVATE_USER_DATA!,
    },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("tab", { name: "Производство" }).click();
    const syncStatus = page.getByLabel("Статус обновления ESI");
    const sync = page.getByRole("button", {
      name: /Обновить данные ESI|Обновляем ESI/,
    });
    await expect(sync).toBeVisible();
    await sync.click();
    await expect
      .poll(async () => syncStatus.innerText(), { timeout: 150_000 })
      .toMatch(/Обновлено|не удалось|ошибка/i);
    await expect(syncStatus).not.toContainText(/race|Invalid input/i);
    await expect(
      page.getByText(/Навыки, чертежи, assets, задания и контракты:/),
    ).not.toContainText("ещё не обновлялись");
  } finally {
    await app.close();
  }
});
