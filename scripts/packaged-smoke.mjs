import { _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
const executable =
  process.argv[2] ??
  (process.platform === "darwin"
    ? "release/mac-arm64/EVE Trader.app/Contents/MacOS/EVE Trader"
    : "release/win-unpacked/EVE Trader.exe");
const directory = mkdtempSync(join(tmpdir(), "eve-packaged-"));
let app;
const checks = [];
try {
  console.log("Launching packaged EVE Trader");
  if (process.platform === "darwin") {
    execFileSync(
      "/usr/bin/codesign",
      [
        "--verify",
        "--deep",
        "--strict",
        "--verbose=2",
        resolve(executable, "../../.."),
      ],
      { stdio: "inherit" },
    );
    checks.push("macOS bundle signature integrity (not Apple notarization)");
  }
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
  console.log("Packaged app launched; waiting for its first window");
  let page = await app.firstWindow();
  console.log("First window opened; waiting for the market tab");
  await page.getByRole("tab", { name: "Рынок", exact: true }).waitFor();
  console.log("Market tab opened; requesting initial engine state");
  const state = await page.evaluate(() =>
    window.eve.request({ kind: "state" }),
  );
  console.log(
    `Initial state returned: ${state.opportunities.length} opportunities`,
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
  console.log("Settings persisted; checking tray and restart behavior");
  checks.push("settings write");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  console.log("Window close requested; checking tray behavior");
  if (
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    )
  )
    throw Error("Close did not hide to tray");
  console.log("Window is hidden; showing it again");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].show(),
  );
  console.log("Window shown; requesting app quit");
  checks.push("hide to tray + show");
  // The app intentionally hides BrowserWindow on close, so ElectronApplication.close()
  // alone waits forever for a process that remains alive in the tray.
  // Resolve the Electron main-process evaluation before app.quit closes its
  // Playwright transport. Calling quit directly inside evaluate can leave the
  // smoke test waiting forever on macOS runners.
  await app.evaluate(({ app }) => {
    setTimeout(() => app.quit(), 0);
    return true;
  });
  console.log("Graceful app quit scheduled; waiting for process close");
  await app.close();
  console.log("First packaged process closed; launching restart");
  app = await launch();
  console.log("Restarted packaged app; checking saved settings");
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
  if (app) {
    await app.evaluate(({ app }) => app.quit()).catch(() => {});
    await app.close().catch(() => {});
  }
  rmSync(directory, { recursive: true, force: true });
}
