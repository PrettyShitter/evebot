import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("production tab remains available and empty while market and deal tabs remain", async () => {
  const directory = mkdtempSync(join(tmpdir(), "eve-production-retired-"));
  const app = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      EVE_DEMO: "1",
      EVE_OFFLINE: "1",
      EVE_USER_DATA: directory,
    },
  });
  try {
    const page = await app.firstWindow();
    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(4);
    await expect(tabs.nth(0)).toHaveText("Рынок");
    await expect(tabs.nth(1)).toHaveText("Текущие сделки");
    await expect(tabs.nth(2)).toHaveText("Закрытые сделки");
    const productionTab = page.getByRole("tab", { name: /производство/i });
    await expect(productionTab).toBeVisible();
    await productionTab.click();
    const productionPanel = page.getByRole("tabpanel");
    await expect(productionPanel).toBeEmpty();
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
