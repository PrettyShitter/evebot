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
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { UpdateController } from "./update-controller";
import { Worker } from "node:worker_threads";
import { SignedMacUpdater } from "./signed-mac-updater";
import { waitForUpdateIdle } from "./update-readiness";
import { join, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  requestSchema,
  type AppState,
  PRODUCTION_SCOPES,
} from "../shared/contracts/app";
import { Store, restoreBackup } from "../db/store";
import { SecureVault } from "./vault";
import { authorize } from "./authorization";
import { SsoClient, TokenManager } from "../engine/auth/tokens";
import { EsiClient } from "../engine/esi/client";
import { fetchWallet } from "../engine/portfolio/sync";
import { fetchProfile } from "../engine/portfolio/profile";
import {
  fetchOwnProductionData,
  fetchPublicProductionData,
  fetchStructureMarkets,
} from "../engine/production/esi";
let updates: UpdateController | undefined;
let installingUpdate = false;
let quitting = false;
let tray: Tray | undefined;
let syncing = false;
let productionSyncing = false;
let productionSyncError: string | null = null;
let walletError = "";
let window: BrowserWindow;
let worker: Worker;
let demo = process.env.EVE_DEMO === "1";
const ENGINE_REQUEST_TIMEOUT_MS = 30_000;
const UPDATE_BACKUP_TIMEOUT_MS = 10 * 60_000;
const UPDATE_STARTUP_TIMEOUT_MS = 3 * 60_000;
let engineReady = false;
let engineFailed = false;
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
          else
            p.resolve({
              ...m.value,
              production: {
                ...m.value.production,
                syncing: productionSyncing,
                syncError: productionSyncError,
              },
              update: updates?.view,
            });
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
function requestEngine(
  request: unknown,
  backupPath?: string,
  internal?: unknown,
  timeoutMs = ENGINE_REQUEST_TIMEOUT_MS,
) {
  return new Promise<AppState>((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Движок не ответил вовремя"));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, request, backupPath, internal });
  });
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
        // ESI wallet/production syncs write through the engine and must finish
        // before its database is backed up. Market scans can run for a long
        // time, so stop the worker instead of waiting for every renderer state
        // request to drain before an update.
        await waitForUpdateIdle(() => syncing || productionSyncing, {
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
        req.kind === "deal.reconcile" ? req : { kind: "state" },
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
  async function syncProduction() {
    if (demo) throw Error("Производство недоступно в DEMO");
    if (productionSyncing || syncing)
      throw Error("Дождитесь завершения текущей сверки ESI");
    productionSyncing = true;
    const syncWorker = worker;
    try {
      const current = await requestEngine({ kind: "state" });
      const mainCharacter = current.characters.find((character) => character.isSeller);
      const staticData = JSON.parse(readFileSync(join(__dirname, "../../resources/static-data.json"), "utf8")) as {
        stations: { id: string; systemId: string; regionId: string }[];
      };
      const hubSystems = new Set(["30000142", "30000144"]);
      const hubStations = staticData.stations.filter((station) => hubSystems.has(station.systemId));
      const publicData = await fetchPublicProductionData(
        esi,
        hubSystems,
        new Set(hubStations.map((station) => station.id)),
        new Set(hubStations.map((station) => station.regionId)),
      );
      if (syncWorker !== worker)
        throw Error("Портфель изменился во время синхронизации");
      await requestEngine(
        { kind: "state" },
        undefined,
        { kind: "public-production", publicData },
      );
      productionSyncError = null;
      if (!mainCharacter) return requestEngine({ kind: "state" });
      const record = await vault.read(mainCharacter.id);
      if (!record) return requestEngine({ kind: "state" });
      await requestEngine(
        { kind: "state" },
        undefined,
        {
          kind: "production-scopes",
          characterId: mainCharacter.id,
          scopes: record.scopes,
        },
      );
      const missing = PRODUCTION_SCOPES.filter((scope) => !record.scopes.includes(scope));
      if (missing.length) return requestEngine({ kind: "state" });
      if (!tokens || tokenClientId !== current.settings.clientId) {
        tokenClientId = current.settings.clientId;
        const sso = new SsoClient(tokenClientId);
        tokens = new TokenManager(vault, (token) => sso.refresh(token));
      }
      const accessToken = await tokens.access(mainCharacter.id);
      const structureProfiles = current.production.facilityProfiles
        .filter((facility) => facility.kind === "structure" && facility.accessStatus === "confirmed")
        .filter((facility) => hubSystems.has(facility.systemId))
        .map((facility) => ({ id: facility.id, systemId: facility.systemId }));
      const hasStructureMarketScope = record.scopes.includes("esi-markets.structure_markets.v1");
      const [profile, own] = await Promise.all([
        fetchProfile(esi, mainCharacter.id, accessToken),
        fetchOwnProductionData(esi, mainCharacter.id, accessToken),
      ]);
      const structureMarkets = hasStructureMarketScope
        ? await fetchStructureMarkets(esi, accessToken, mainCharacter.id, structureProfiles)
        : structureProfiles.map((facility) => ({
            structureId: facility.id,
            systemId: facility.systemId,
            state: "missing_scope" as const,
            pages: 0,
            observedAt: new Date().toISOString(),
            message: "Не выдан scope esi-markets.structure_markets.v1",
            orders: [],
          }));
      if (syncWorker !== worker)
        throw Error("Портфель изменился во время синхронизации");
      return requestEngine(
        { kind: "state" },
        undefined,
        {
          kind: "production-data",
          characterId: mainCharacter.id,
          profile,
          own,
          publicData,
          structureMarkets,
        },
      );
    } catch (error) {
      productionSyncError = error instanceof Error ? error.message : "Ошибка ESI";
      throw error;
    } finally {
      productionSyncing = false;
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
    if (req.kind === "production.sync") return syncProduction();
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
        try {
          restoreBackup(
            target.filePaths[0],
            join(
              app.getPath("userData"),
              demo ? "demo.sqlite" : "portfolio.sqlite",
            ),
          );
        } finally {
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
      void requestEngine({ kind: "state" })
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
      void requestEngine({ kind: "state" }, undefined, {
        kind: "suspend",
      }).catch(() => {}),
  );
  powerMonitor.on(
    "resume",
    () =>
      void requestEngine({ kind: "state" }, undefined, {
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
  const initialState = await requestEngine({ kind: "state" });
  if (!demo && process.env.EVE_BENCHMARK !== "1") {
    const wallets =
      initialState.characters.length === 3 &&
      initialState.characters.every((c) => c.status !== "revoked")
        ? syncWallets({ kind: "wallet.sync" }).catch(() => undefined)
        : Promise.resolve(undefined);
    // Public facilities, indices, prices, and contract listings do not require
    // a connected character. Keep them available even when wallet auth expires.
    void wallets.then(() => syncProduction()).catch(() => {});
    const productionRefresh = setInterval(
      () => void syncProduction().catch(() => {}),
      30 * 60 * 1000,
    );
    productionRefresh.unref();
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
