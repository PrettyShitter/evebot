import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  clipboard,
  Tray,
  nativeImage,
  powerMonitor,
} from "electron";
import { autoUpdater } from "electron-updater";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { UpdateController } from "./update-controller";
import { Worker } from "node:worker_threads";
import { SignedMacUpdater } from "./signed-mac-updater";
import { waitForUpdateIdle } from "./update-readiness";
import { join, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { requestSchema, type AppState } from "../shared/contracts/app";
import { Store, restoreBackup } from "../db/store";
import { openMarketCache } from "../db/market-cache";
import { SecureVault } from "./vault";
import { authorize } from "./authorization";
import { SsoClient, TokenManager } from "../engine/auth/tokens";
import { EsiClient } from "../engine/esi/client";
import { fetchWallet } from "../engine/portfolio/sync";
import { fetchProfile } from "../engine/portfolio/profile";
let updates: UpdateController | undefined;
let installingUpdate = false;
let quitting = false;
let tray: Tray | undefined;
let syncing = false;
let walletError = "";
let window: BrowserWindow;
let worker: Worker;
let demo = process.env.EVE_DEMO === "1";
const ENGINE_REQUEST_TIMEOUT_MS = 30_000;
const UPDATE_BACKUP_TIMEOUT_MS = 10 * 60_000;
const UPDATE_STARTUP_TIMEOUT_MS = 3 * 60_000;
let engineReady = false;
let engineFailed = false;
const coalescedStateRequests = new Map<boolean, Promise<AppState>>();
const pending = new Map<
  string,
  {
    resolve: (v: AppState) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
function startWorker() {
  worker = new Worker(join(__dirname, "worker.cjs"), {
    workerData: {
      directory: app.getPath("userData"),
      migrations: join(__dirname, "../../db/migrations"),
      resources: join(__dirname, "../../resources"),
      demo,
      marketCachePath: join(app.getPath("userData"), "market-cache.sqlite"),
      offline: process.env.EVE_OFFLINE === "1",
      devBuild: !app.isPackaged,
    },
  });
  worker.on(
    "message",
    (
      m:
        | { kind: "ready" }
        | { id: string; value: AppState; error?: string },
    ) => {
      if ("id" in m) {
        const p = pending.get(m.id);
        if (p) {
          clearTimeout(p.timer);
          pending.delete(m.id);
          if (m.error) p.reject(new Error(m.error));
          else p.resolve({ ...m.value, update: updates?.view });
        }
        return;
      }
      if (m.kind === "ready") {
        engineReady = true;
      }
    },
  );
  worker.on("error", () => {
    engineFailed = true;
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("Движок остановлен. Перезапустите приложение."));
    }
    pending.clear();
  });
}
async function ensureMarketCache(): Promise<boolean> {
  if (demo) return true;
  const userData = app.getPath("userData");
  const portfolioPath = join(userData, "portfolio.sqlite");
  const cachePath = join(userData, "market-cache.sqlite");
  const migrationPath = join(__dirname, "../../db/migrations");
  if (existsSync(cachePath)) {
    try {
      const existingCache = openMarketCache(cachePath, true);
      existingCache.close();
    } catch {
      const parked = cachePath + ".unusable-" + Date.now();
      renameSync(cachePath, parked);
      for (const suffix of ["-wal", "-shm", ".migration.json"])
        rmSync(cachePath + suffix, { force: true });
    }
  }
  if (!existsSync(portfolioPath)) {
    const initial = new Store(portfolioPath, migrationPath);
    initial.close();
  }
  const splash = new BrowserWindow({
    width: 520,
    height: 240,
    resizable: false,
    show: true,
    frame: true,
    backgroundColor: "#101318",
    title: "Подготовка EVE Trader",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  await splash.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(`<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#101318;color:#edf1f8;font:16px -apple-system,BlinkMacSystemFont,sans-serif;display:grid;place-content:center;height:100vh;text-align:center}h2{font-size:22px}p{color:#98a6b8;max-width:390px;line-height:1.5}</style><main><h2>EVE Trader</h2><p id="status">Подготавливаем локальный рынок…</p></main>`),
  );
  const migration = new Worker(join(__dirname, "cacheMigrationWorker.cjs"), {
    workerData: { portfolioPath, cachePath },
  });
  const updateStatus = (status: string) => {
    void splash.webContents
      .executeJavaScript(`document.getElementById('status').textContent=${JSON.stringify(status)}`)
      .catch(() => undefined);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      migration.on("message", (message: { progress?: string; result?: unknown; error?: string }) => {
        if (message.progress) updateStatus(message.progress);
        if (message.error) reject(new Error(message.error));
        if (message.result) resolve();
      });
      migration.once("error", reject);
      migration.once("exit", (code) => {
        if (code !== 0) reject(new Error("Процесс миграции рыночного кеша остановился"));
      });
    });
  } catch (error) {
    migration.terminate();
    if (!splash.isDestroyed()) splash.destroy();
    await dialog.showMessageBox({
      type: "error",
      title: "Не удалось подготовить рынок",
      message: error instanceof Error ? error.message : "Не удалось подготовить локальный кеш рынка",
      detail: "Портфель сохранён без изменений. Освободите место или восстановите доступ к диску и запустите приложение снова.",
    });
    app.quit();
    return false;
  }
  if (!splash.isDestroyed()) splash.destroy();
  return true;
}
function requestEngine(
  request: unknown,
  backupPath?: string,
  internal?: unknown,
  timeoutMs = engineReady
    ? ENGINE_REQUEST_TIMEOUT_MS
    : UPDATE_STARTUP_TIMEOUT_MS,
) {
  const engineRequest =
    typeof request === "object" &&
    request !== null &&
    "kind" in request &&
    request.kind === "state"
      ? { ...request, includeProduction: false }
      : request;
  const coalesce =
    !backupPath &&
    !internal &&
    typeof request === "object" &&
    request !== null &&
    "kind" in request &&
    request.kind === "state";
  const includeProduction =
    typeof request === "object" &&
    request !== null &&
    "includeProduction" in request &&
    request.includeProduction === false
      ? false
      : true;
  if (coalesce && coalescedStateRequests.has(includeProduction))
    return coalescedStateRequests.get(includeProduction)!;
  const operation = new Promise<AppState>((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Движок не ответил вовремя"));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, request: engineRequest, backupPath, internal });
  });
  if (coalesce) {
    coalescedStateRequests.set(includeProduction, operation);
    const clear = () => {
      if (coalescedStateRequests.get(includeProduction) === operation)
        coalescedStateRequests.delete(includeProduction);
    };
    void operation.then(clear, clear);
  }
  return operation;
}
app.setName("EVE Trader");
if (process.env.EVE_USER_DATA)
  app.setPath("userData", process.env.EVE_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  window?.show();
  window?.focus();
});
app.whenReady().then(async () => {
  if (!(await ensureMarketCache())) return;
  startWorker();
  autoUpdater.logger = null;
  const publicKeyPath = join(
    __dirname,
    "../../resources/updates-public-key.pem",
  );
  const macUpdates =
    process.platform === "darwin" && existsSync(publicKeyPath)
      ? new SignedMacUpdater({
          version: app.getVersion(),
          arch: process.arch,
          publicKey: readFileSync(publicKeyPath, "utf8"),
          userData: app.getPath("userData"),
          appPath: resolve(dirname(app.getPath("exe")), "../.."),
          helper: join(__dirname, "../../resources/install-update.sh"),
          quit: () => app.quit(),
          demo: () => demo,
        })
      : undefined;
  const updateReason = !app.isPackaged
    ? "Обновления доступны в установленном приложении."
    : process.env.EVE_OFFLINE === "1"
      ? "Проверка обновлений отключена в тестовом режиме."
      : !macUpdates &&
          !existsSync(join(process.resourcesPath, "app-update.yml"))
        ? "GitHub Releases ещё не подключён к этой сборке."
        : null;
  updates = new UpdateController(
    macUpdates ?? autoUpdater,
    app.getVersion(),
    updateReason,
    async () => {
      installingUpdate = true;
      try {
        // ESI wallet syncs write through the engine and must finish before its
        // database is backed up. Market scans can run for a long
        // time, so stop the worker instead of waiting for every renderer state
        // request to drain before an update.
        await waitForUpdateIdle(() => syncing, {
          timeoutMs: UPDATE_BACKUP_TIMEOUT_MS,
        });
        const directory =
          macUpdates?.backupDirectory ??
          join(app.getPath("userData"), "backups", "pre-update-" + Date.now());
        mkdirSync(directory, { recursive: true });
        // The worker may be calculating thousands of market opportunities and
        // cannot handle a backup message until that calculation finishes.
        // Terminate it first: SQLite rolls back any uncommitted transaction,
        // and Store.backup then snapshots the committed database including WAL.
        const activeWorker = worker;
        await activeWorker.terminate();
        for (const p of pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error("Приложение обновляется"));
        }
        pending.clear();
        engineReady = false;
        for (const name of [
          demo ? "demo.sqlite" : "portfolio.sqlite",
          demo ? "portfolio.sqlite" : "demo.sqlite",
        ]) {
          const source = join(app.getPath("userData"), name);
          if (!existsSync(source)) continue;
          const db = new Store(source, join(__dirname, "../../db/migrations"));
          try {
            await db.backup(join(directory, name));
          } finally {
            db.close();
          }
        }
        const cachePath = join(app.getPath("userData"), "market-cache.sqlite");
        if (!demo && existsSync(cachePath)) {
          const portfolio = new Store(
            join(app.getPath("userData"), "portfolio.sqlite"),
            join(__dirname, "../../db/migrations"),
            { marketCachePath: cachePath, readonly: true },
          );
          try {
            await portfolio.market.backup(join(directory, "market-cache.sqlite"));
          } finally {
            portfolio.close();
          }
        }
        quitting = true;
      } catch (error) {
        if (!engineReady) {
          engineFailed = false;
          startWorker();
        }
        installingUpdate = false;
        throw error;
      }
    },
    Date.now,
    () => {
      installingUpdate = false;
      quitting = false;
    },
  );
  const resultPath = join(app.getPath("userData"), "update-result.txt");
  if (
    existsSync(resultPath) &&
    readFileSync(resultPath, "utf8").startsWith("failed\n")
  )
    updates.reportRollback();
  if (!updateReason) {
    const first = setTimeout(() => void updates?.check(true), 30000);
    first.unref();
    const interval = setInterval(() => void updates?.check(true), 4 * 3600000);
    interval.unref();
  }
  const vault = new SecureVault(join(app.getPath("userData"), "credentials"));
  const esi = new EsiClient();
  let tokens: TokenManager | undefined;
  let tokenClientId = "";
  async function syncWallets(
    req: { kind: "wallet.sync" } | { kind: "deal.reconcile"; id: string },
  ) {
    if (demo) return requestEngine(req);
    if (syncing) throw Error("Сверка кошельков уже выполняется");
    syncing = true;
    const syncWorker = worker;
    try {
      const s = await requestEngine({ kind: "state" });
      if (s.characters.length !== 3)
        throw Error("Сначала подключите три персонажа");
      if (!tokens || tokenClientId !== s.settings.clientId) {
        tokenClientId = s.settings.clientId;
        const sso = new SsoClient(tokenClientId);
        tokens = new TokenManager(vault, (t) => sso.refresh(t));
      }
      const wallets = [];
      const scopes: Record<string, string[]> = {};
      for (const c of s.characters) {
        try {
          const accessToken = await tokens.access(c.id);
          const tokenRecord = await vault.read(c.id);
          scopes[c.id] = tokenRecord?.scopes ?? [];
          wallets.push(await fetchWallet(esi, c.id, accessToken, c.isSeller));
        } catch (error) {
          if (
            error instanceof Error &&
            /отозван|недействителен/.test(error.message)
          )
            await requestEngine({ kind: "character.disconnect", id: c.id });
          throw error;
        }
      }
      const seller = s.characters.find((c) => c.isSeller);
      const profile = seller
        ? await fetchProfile(esi, seller.id, await tokens.access(seller.id))
        : undefined;
      if (syncWorker !== worker)
        throw Error("Портфель изменился во время синхронизации");
      const result = await requestEngine(
        req.kind === "deal.reconcile"
          ? req
          : { kind: "state", includeProduction: false },
        undefined,
        { kind: "wallets", wallets, profile, scopes },
      );
      walletError = "";
      return result;
    } catch (e) {
      walletError = e instanceof Error ? e.message : "Ошибка сверки";
      throw e;
    } finally {
      syncing = false;
    }
  }
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#101318",
    title: "EVE Trader",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const entry =
    process.env.EVE_DEV_URL ??
    pathToFileURL(join(__dirname, "../renderer/index.html")).href;
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== entry) event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  ipcMain.handle("eve:request", async (event, raw: unknown) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw Error("Недоверенный отправитель");
    const req = requestSchema.parse(raw);
    if (installingUpdate && req.kind !== "state")
      throw Error("Подготовка обновления. Дождитесь перезапуска.");
    if (req.kind === "update.check") {
      void updates?.check();
      return requestEngine({ kind: "state" });
    }
    if (req.kind === "update.download") {
      void updates?.download();
      return requestEngine({ kind: "state" });
    }
    if (req.kind === "update.install") {
      await updates?.install();
      return requestEngine({ kind: "state" });
    }

    if (req.kind === "clipboard.copy") {
      clipboard.writeText(req.text);
      return requestEngine({ kind: "state" });
    }

    if (req.kind === "basket.copy") {
      const result = await requestEngine(req);
      clipboard.writeText(result.basket?.multibuy ?? "");
      return result;
    }
    if (req.kind === "character.connect") {
      if (demo) throw Error("SSO недоступен в DEMO");
      const s = await requestEngine({ kind: "state" });
      if (
        !req.expectedId &&
        s.characters.length >= 3 &&
        s.characters.every((c) => c.status === "connected")
      )
        throw Error("Уже подключены три персонажа");
      const original = req.expectedId
        ? s.characters.find((c) => c.id === req.expectedId)
        : undefined;
      if (req.expectedId && !original) throw Error("Подключение не найдено");
      const seller = original?.isSeller ?? req.seller;
      const authWorker = worker;
      const record = await authorize(s.settings.clientId, seller);
      if (authWorker !== worker)
        throw Error("Портфель изменился во время входа");
      if (req.expectedId && record.characterId !== req.expectedId)
        throw Error(
          "В браузере выбран другой персонаж. Повторите вход для выбранного подключения.",
        );
      await vault.write(record);
      return requestEngine({ kind: "state" }, undefined, {
        kind: "connected",
        id: record.characterId,
        name: record.name,
        seller,
        scopes: record.scopes,
      });
    }
    if (req.kind.startsWith("production."))
      throw Error("Вкладка производства отключена; данные архива сохранены локально");
    if (req.kind === "character.disconnect") {
      if (syncing)
        throw Error("Дождитесь завершения сверки перед отключением персонажа");
      await vault.remove(req.id);
      return requestEngine(req);
    }
    if (req.kind === "wallet.sync" || req.kind === "deal.reconcile")
      return syncWallets(req);
    if (req.kind === "demo.enable" || req.kind === "demo.disable") {
      await worker.terminate();
      demo = req.kind === "demo.enable";
      startWorker();
      return requestEngine({ kind: "state" });
    }
    if (req.kind === "export") {
      const target = await dialog.showSaveDialog(window, {
        defaultPath: "eve-analysis.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      return !target.canceled && target.filePath
        ? requestEngine(req, target.filePath)
        : requestEngine({ kind: "state" });
    }
    if (req.kind === "backup") {
      const target = await dialog.showSaveDialog(window, {
        defaultPath: `eve-trader-${Date.now()}.sqlite`,
        filters: [{ name: "SQLite", extensions: ["sqlite"] }],
      });
      if (!target.canceled && target.filePath)
        return requestEngine(req, target.filePath);
      return requestEngine({ kind: "state" });
    }
    if (req.kind === "restore") {
      const target = await dialog.showOpenDialog(window, {
        filters: [{ name: "SQLite backup", extensions: ["sqlite"] }],
        properties: ["openFile"],
      });
      if (!target.canceled) {
        await worker.terminate();
      const cachePath = join(app.getPath("userData"), "market-cache.sqlite");
      const staleCachePath = cachePath + ".before-restore-" + Date.now();
      let movedCache = false;
        try {
          restoreBackup(
            target.filePaths[0],
            join(
              app.getPath("userData"),
              demo ? "demo.sqlite" : "portfolio.sqlite",
            ),
          );
        if (!demo && existsSync(cachePath)) {
          renameSync(cachePath, staleCachePath);
          movedCache = true;
          for (const suffix of ["-wal", "-shm", ".migration.json"])
            rmSync(cachePath + suffix, { force: true });
          await ensureMarketCache();
        }
        } finally {
        if (movedCache && !existsSync(cachePath))
          renameSync(staleCachePath, cachePath);
          startWorker();
        }
      }
      return requestEngine({ kind: "state" });
    }
    const result = await requestEngine(req);
    if (walletError) result.sync = walletError;
    return result;
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: "EVE Trader", submenu: [{ role: "about" }, { role: "quit" }] },
      { role: "editMenu" },
      { role: "viewMenu" },
    ]),
  );
  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  const icon = nativeImage.createFromPath(
    join(__dirname, "../../resources/tray.png"),
  );
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("EVE Trader");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Открыть EVE Trader", click: () => window.show() },
      { label: "Выход", click: () => app.quit() },
    ]),
  );
  tray.on("click", () => window.show());
  const background = setInterval(() => {
    if (!demo && !syncing && !installingUpdate)
      void requestEngine({ kind: "state", includeProduction: false })
        .then((s) =>
          s.characters.length === 3 &&
          s.characters.every((c) => c.status !== "revoked")
            ? syncWallets({ kind: "wallet.sync" })
            : undefined,
        )
        .catch(() => {});
  }, 60000);
  background.unref();
  powerMonitor.on(
    "suspend",
    () =>
      void requestEngine({ kind: "state", includeProduction: false }, undefined, {
        kind: "suspend",
      }).catch(() => {}),
  );
  powerMonitor.on(
    "resume",
    () =>
      void requestEngine({ kind: "state", includeProduction: false }, undefined, {
        kind: "resume",
      }).catch(() => {}),
  );
  await window.loadURL(entry);
  if (process.argv.some((arg) => arg.startsWith("--eve-update-token="))) {
    await waitForUpdateIdle(
      () => !engineReady && !engineFailed,
      { timeoutMs: UPDATE_STARTUP_TIMEOUT_MS, intervalMs: 25 },
    );
    if (!engineReady)
      throw new Error("Локальная база не успела открыться после обновления");
    // Acknowledge as soon as the window and database are ready. The first full
    // market state may take much longer while its background calculation runs.
    macUpdates?.acknowledgeHealthy(process.argv);
  }
  const initialState = await requestEngine({ kind: "state", includeProduction: false });
  if (!demo && process.env.EVE_BENCHMARK !== "1") {
    if (
      initialState.characters.length === 3 &&
      initialState.characters.every((c) => c.status !== "revoked")
    )
      void syncWallets({ kind: "wallet.sync" }).catch(() => undefined);
  }
});
app.on("window-all-closed", () => {
  if (quitting) app.quit();
});
app.on("before-quit", () => {
  quitting = true;
  tray?.destroy();
  void worker?.terminate();
});
