// Real signed GitHub release -> installed app -> restart -> preserved portfolio.
import { _electron as electron } from "@playwright/test";
import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const executable = resolve(process.argv[2]);
const expected = process.argv[3];
const data = resolve(".cache/update-smoke/data-" + Date.now());
mkdirSync(data, { recursive: true });
let app;
const env = {
  ...process.env,
  EVE_USER_DATA: data,
  EVE_DEMO: "1",
  EVE_OFFLINE: "0",
};
const launch = () =>
  electron.launch({ executablePath: executable, env, timeout: 30000 });
async function until(read, predicate, timeout = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await read();
    if (predicate(value)) return value;
    await delay(500);
  }
  throw Error("Timeout waiting for update; data at " + data);
}
try {
  app = await launch();
  let page = await app.firstWindow();
  await page.locator(".data-row").first().waitFor();
  await page.locator(".data-row").first().click();
  await page.getByRole("button", { name: "Добавить в корзину" }).click();
  await page.getByRole("button", { name: "Взять сделку", exact: true }).click();
  await page
    .getByText("Сделка добавлена в текущие. Бюджет зарезервирован.")
    .waitFor();
  await page.evaluate(async () => {
    const s = await window.eve.request({ kind: "state" });
    await window.eve.request({
      kind: "settings.save",
      value: { ...s.settings, minProfit: "123456" },
    });
  });
  const before = await page.evaluate(() =>
    window.eve.request({ kind: "state" }),
  );
  if (!before.deals.length) throw Error("Missing test deal");
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page
    .getByRole("button", { name: "Проверить обновления", exact: true })
    .click();
  const state = () =>
    page.evaluate(() => window.eve.request({ kind: "state" }));
  let current = await until(state, (s) =>
    ["available", "error"].includes(s.update.phase),
  );
  if (
    current.update.nextVersion !== expected ||
    current.update.phase !== "available"
  )
    throw Error(JSON.stringify(current.update));
  console.log(
    "Verified GitHub manifest: " +
      before.update.currentVersion +
      " -> " +
      expected,
  );
  await page
    .getByRole("button", { name: "Скачать обновление", exact: true })
    .click();
  current = await until(
    state,
    (s) => ["downloaded", "error"].includes(s.update.phase),
    600000,
  );
  if (current.update.phase !== "downloaded")
    throw Error(JSON.stringify(current.update));
  console.log("Archive verified; installing");
  const exited = new Promise((resolve) => app.once("close", resolve));
  await page
    .getByRole("button", { name: "Обновить и перезапустить", exact: true })
    .click();
  await Promise.race([
    exited,
    delay(30000).then(() => {
      throw Error("Old app did not exit");
    }),
  ]);
  app = undefined;
  const resultFile = join(data, "update-result.txt");
  const result = await until(
    () => (existsSync(resultFile) ? readFileSync(resultFile, "utf8") : ""),
    (s) => Boolean(s),
    120000,
  );
  if (result.trim() !== "installed\n" + expected)
    throw Error("Installer result: " + result);
  const cache = join(
    data,
    "update-cache",
    readdirSync(join(data, "update-cache"))[0],
  );
  if (!existsSync(join(cache, "backups", "demo.sqlite")))
    throw Error("Missing SQLite backup");
  const newPid = Number(readFileSync(join(cache, "new-pid"), "utf8"));
  process.kill(newPid, "SIGTERM");
  await until(
    () => {
      try {
        process.kill(newPid, 0);
        return false;
      } catch {
        return true;
      }
    },
    Boolean,
    30000,
  );
  app = await launch();
  page = await app.firstWindow();
  await page.getByRole("tab", { name: "Рынок", exact: true }).waitFor();
  const after = await page.evaluate(() =>
    window.eve.request({ kind: "state" }),
  );
  if (
    after.update.currentVersion !== expected ||
    after.settings.minProfit !== "123456" ||
    JSON.stringify(after.deals) !== JSON.stringify(before.deals) ||
    after.reserved !== before.reserved
  )
    throw Error("Version or portfolio preservation failed");
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page
    .getByRole("button", { name: "Проверить обновления", exact: true })
    .click();
  const latest = await until(
    () => page.evaluate(() => window.eve.request({ kind: "state" })),
    (s) => ["idle", "error"].includes(s.update.phase),
  );
  if (latest.update.phase !== "idle") throw Error("Post-update check failed");
  mkdirSync("docs/verification/screenshots", { recursive: true });
  await page.screenshot({
    path: "docs/verification/screenshots/update-macos.png",
  });
  const report = {
    at: new Date().toISOString(),
    status: "PASS",
    from: before.update.currentVersion,
    to: expected,
    source: "GitHub Releases",
    checks: [
      "signed metadata",
      "archive size and SHA-512",
      "UI download and install",
      "SQLite backup",
      "helper restart health",
      "version changed",
      "settings, deal and reserves preserved",
      "latest version check",
    ],
  };
  writeFileSync(
    "docs/verification/update-macos.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await app?.close();
}
