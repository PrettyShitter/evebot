import { _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const executable =
  process.argv[2] ??
  (process.platform === "darwin"
    ? "release/mac-arm64/EVE Trader.app/Contents/MacOS/EVE Trader"
    : "release/win-unpacked/EVE Trader.exe");
const directory = mkdtempSync(join(tmpdir(), "eve-packaged-"));
let app;
const checks = [];
try {
  const launch = () =>
    electron.launch({
      executablePath: resolve(executable),
      env: {
        ...process.env,
        EVE_USER_DATA: directory,
        EVE_DEMO: "1",
        EVE_OFFLINE: "1",
      },
      timeout: 30000,
    });
  app = await launch();
  let page = await app.firstWindow();
  await page.getByRole("tab", { name: "Рынок", exact: true }).waitFor();
  const state = await page.evaluate(() =>
    window.eve.request({ kind: "state" }),
  );
  if (state.characters.length !== 3 || !state.opportunities.length)
    throw Error("Packaged SQLite/worker did not load DEMO");
  checks.push("packaged worker + native SQLite + migrations + DEMO");
  await page.evaluate(async () => {
    const s = await window.eve.request({ kind: "state" });
    await window.eve.request({
      kind: "settings.save",
      value: { ...s.settings, minProfit: "123456" },
    });
  });
  checks.push("settings write");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  if (
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    )
  )
    throw Error("Close did not hide to tray");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].show(),
  );
  checks.push("hide to tray + show");
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.getByRole("tab", { name: "Рынок", exact: true }).waitFor();
  const restarted = await page.evaluate(() =>
    window.eve.request({ kind: "state" }),
  );
  if (restarted.settings.minProfit !== "123456")
    throw Error("Settings lost after restart");
  checks.push("restart persistence");
  mkdirSync("docs/verification/screenshots", { recursive: true });
  await page.screenshot({
    path: "docs/verification/screenshots/packaged-" + process.platform + ".png",
  });
  writeFileSync(
    "docs/verification/packaged-" + process.platform + ".json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        executable,
        platform: process.platform,
        arch: process.arch,
        status: "PASS",
        checks,
        blocked: [
          "live SSO callback/user authorization",
          "signed installer trust/notarization",
        ],
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: "PASS", checks }));
} finally {
  await app?.close();
  rmSync(directory, { recursive: true, force: true });
}
