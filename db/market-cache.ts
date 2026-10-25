import Database from "better-sqlite3";
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const CACHE_SCHEMA_VERSION = 2;
const DAY_MS = 86_400_000;

const CACHE_SCHEMA = `
CREATE TABLE cache_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE systems (id TEXT PRIMARY KEY, name TEXT NOT NULL, region_id TEXT NOT NULL, security REAL NOT NULL);
CREATE TABLE stargates (source TEXT NOT NULL REFERENCES systems(id), destination TEXT NOT NULL REFERENCES systems(id), PRIMARY KEY(source,destination));
CREATE TABLE stations (id TEXT PRIMARY KEY, name TEXT NOT NULL, system_id TEXT NOT NULL REFERENCES systems(id), owner_id TEXT NOT NULL, region_id TEXT NOT NULL);
CREATE TABLE item_types (id TEXT PRIMARY KEY, name TEXT NOT NULL, english_name TEXT NOT NULL, group_id TEXT NOT NULL, market_group_id TEXT, volume TEXT, payload TEXT NOT NULL);
CREATE TABLE market_snapshot_runs (id TEXT PRIMARY KEY, region_id TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, modified_at TEXT, expires_at TEXT, status TEXT NOT NULL, pages INTEGER NOT NULL);
CREATE INDEX market_snapshot_latest ON market_snapshot_runs(region_id,status,completed_at);
CREATE TABLE market_orders (generation TEXT NOT NULL REFERENCES market_snapshot_runs(id) ON DELETE CASCADE, id TEXT NOT NULL, type_id TEXT NOT NULL, location_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(generation,id));
CREATE INDEX market_orders_generation_location ON market_orders(generation,location_id);
CREATE INDEX market_orders_type_location ON market_orders(type_id,location_id);
CREATE TABLE regional_history (region_id TEXT NOT NULL, type_id TEXT NOT NULL, date TEXT NOT NULL, payload TEXT NOT NULL, available_at TEXT NOT NULL, PRIMARY KEY(region_id,type_id,date));
CREATE INDEX regional_history_type_date ON regional_history(type_id,date,region_id);
CREATE TABLE station_observations (id TEXT PRIMARY KEY, station_id TEXT NOT NULL, type_id TEXT NOT NULL, at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE INDEX station_observations_station_at_type ON station_observations(station_id,at,type_id);
CREATE TABLE opportunities (id TEXT PRIMARY KEY, at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE opportunity_features (id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL, event_time TEXT NOT NULL, available_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE model_versions (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE market_sync_cursors (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE esi_response_cache (cache_key TEXT PRIMARY KEY, etag TEXT, modified TEXT, expires_at INTEGER NOT NULL, pages INTEGER NOT NULL, body BLOB, body_bytes INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
CREATE INDEX esi_response_cache_updated ON esi_response_cache(updated_at);
PRAGMA user_version = ${CACHE_SCHEMA_VERSION};
`;

export type MarketCacheMigrationResult = {
  status: "migrated" | "already_migrated";
  backupPath: string | null;
  manifestPath: string;
  counts: {
    generations: number;
    orders: number;
    history: number;
    observations: number;
    types: number;
    systems: number;
    stations: number;
  };
};

export function openMarketCache(path: string, readonly = false) {
  const db = new Database(path, { readonly, fileMustExist: readonly });
  try {
    let version = Number(db.pragma("user_version", { simple: true }));
    if (!readonly && version === 1) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS esi_response_cache (cache_key TEXT PRIMARY KEY, etag TEXT, modified TEXT, expires_at INTEGER NOT NULL, pages INTEGER NOT NULL, body BLOB, body_bytes INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS esi_response_cache_updated ON esi_response_cache(updated_at);
        PRAGMA user_version = ${CACHE_SCHEMA_VERSION};
      `);
      version = CACHE_SCHEMA_VERSION;
    }
    if (version !== CACHE_SCHEMA_VERSION)
      throw Error("Нужна поддерживаемая схема рыночного кеша");
    const complete = db
      .prepare("SELECT value FROM cache_meta WHERE key='migration_complete'")
      .get() as { value: string } | undefined;
    if (complete?.value !== "true") throw Error("Миграция рыночного кеша не завершена");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    if (!readonly) db.pragma("journal_mode = WAL");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Remove duplicate, reconstructible cache rows only after a validated split. */
export function retireLegacyMarketData(portfolioPath: string, cachePath: string) {
  const cache = openMarketCache(cachePath, true);
  try {
    if (cache.pragma("integrity_check", { simple: true }) !== "ok")
      throw Error("Нельзя очистить старый кеш: новая рыночная база не прошла проверку");
  } finally {
    cache.close();
  }
  const portfolio = new Database(portfolioPath);
  try {
    portfolio.pragma("foreign_keys = ON");
    portfolio.pragma("busy_timeout = 5000");
    const detached = portfolio
      .prepare("SELECT value FROM sync_cursors WHERE key='market-cache-detached'")
      .get() as { value: string } | undefined;
    if (detached?.value === "true") return false;
    portfolio.transaction(() => {
      // These tables hold only reproducible market material. Trade forecasts,
      // wallet evidence, allocations, and the retired production archive stay.
      for (const table of [
        "production_market_orders",
        "market_orders",
        "market_snapshot_runs",
        "station_observations",
        "regional_history",
        "opportunity_features",
        "opportunities",
        "model_versions",
      ])
        portfolio.exec(`DROP TABLE ${table}`);
      portfolio.exec(`
        CREATE TABLE market_snapshot_runs (id TEXT PRIMARY KEY, region_id TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, modified_at TEXT, expires_at TEXT, status TEXT NOT NULL, pages INTEGER NOT NULL);
        CREATE TABLE market_orders (generation TEXT NOT NULL REFERENCES market_snapshot_runs(id) ON DELETE CASCADE, id TEXT NOT NULL, type_id TEXT NOT NULL, location_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(generation,id));
        CREATE INDEX market_type_location ON market_orders(type_id,location_id);
        CREATE INDEX market_orders_generation_location ON market_orders(generation,location_id);
        CREATE TABLE production_market_orders (generation TEXT NOT NULL REFERENCES market_snapshot_runs(id) ON DELETE CASCADE, order_id TEXT NOT NULL, type_id TEXT NOT NULL, location_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(generation,order_id));
        CREATE INDEX production_market_orders_type_generation ON production_market_orders(type_id,generation);
        CREATE INDEX production_market_orders_generation_location ON production_market_orders(generation,location_id);
        CREATE TABLE regional_history (type_id TEXT NOT NULL, region_id TEXT NOT NULL, date TEXT NOT NULL, payload TEXT NOT NULL, available_at TEXT NOT NULL, PRIMARY KEY(type_id,region_id,date));
        CREATE TABLE station_observations (id TEXT PRIMARY KEY, station_id TEXT NOT NULL, type_id TEXT NOT NULL, at TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE INDEX station_observations_station_at_type ON station_observations(station_id,at,type_id);
        CREATE TABLE opportunities (id TEXT PRIMARY KEY, at TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE opportunity_features (id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL, event_time TEXT NOT NULL, available_at TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE model_versions (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      `);
      portfolio
        .prepare("DELETE FROM sync_cursors WHERE key IN ('static','history-revision')")
        .run();
      portfolio
        .prepare("INSERT INTO sync_cursors VALUES ('market-cache-detached','true')")
        .run();
    })();
    portfolio.pragma("wal_checkpoint(TRUNCATE)");
    return true;
  } finally {
    portfolio.close();
  }
}

type MigrationOptions = {
  now?: number;
  onProgress?: (phase: string) => void;
  /** Test-only fault injection to prove that an interrupted copy is retryable. */
  failAfterCopy?: boolean;
  /** Test-only disk threshold override. */
  minimumFreeBytes?: number;
};

function completedRange(now: number) {
  const end = new Date(now).toISOString().slice(0, 10);
  const start = new Date(Date.parse(`${end}T00:00:00.000Z`) - 7 * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return { start, end };
}

function cacheCounts(db: Database.Database) {
  const count = (table: string) =>
    Number((db.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n);
  return {
    generations: count("market_snapshot_runs"),
    orders: count("market_orders"),
    history: count("regional_history"),
    observations: count("station_observations"),
    types: count("item_types"),
    systems: count("systems"),
    stations: count("stations"),
  };
}

/**
 * Build the disposable market cache from a consistent SQLite backup of the
 * portfolio. The source remains untouched. An incomplete `.tmp` is discarded
 * on retry; only a validated complete cache is atomically published.
 */
export async function migrateMarketCache(
  portfolioPath: string,
  cachePath: string,
  options: MigrationOptions = {},
): Promise<MarketCacheMigrationResult> {
  const manifestPath = cachePath + ".migration.json";
  mkdirSync(dirname(cachePath), { recursive: true });

  if (existsSync(cachePath)) {
    const existing = new Database(cachePath, { readonly: true, fileMustExist: true });
    try {
      const complete = existing
        .prepare("SELECT value FROM cache_meta WHERE key='migration_complete'")
        .get() as { value: string } | undefined;
      if (complete?.value === "true")
        return {
          status: "already_migrated",
          backupPath: null,
          manifestPath,
          counts: cacheCounts(existing),
        };
      throw Error("Рыночный кеш существует, но его миграция не подтверждена");
    } finally {
      existing.close();
    }
  }

  if (!existsSync(portfolioPath)) throw Error("Не найдена база портфеля");
  options.onProgress?.("Проверяем свободное место…");
  const sourceBytes = [portfolioPath, portfolioPath + "-wal", portfolioPath + "-shm"]
    .filter(existsSync)
    .reduce((total, file) => total + statSync(file).size, 0);
  const availableBytes = (directory: string) => {
    const disk = statfsSync(directory);
    return disk.bavail * disk.bsize;
  };
  const requiredFree = options.minimumFreeBytes ?? sourceBytes * 2 + 128 * 1024 * 1024;
  if (
    availableBytes(dirname(portfolioPath)) < requiredFree ||
    availableBytes(dirname(cachePath)) < requiredFree
  )
    throw Error("Недостаточно свободного места для безопасной миграции рыночного кеша");

  const stamp = new Date(options.now ?? Date.now()).toISOString().replaceAll(":", "-");
  const backupPath = `${portfolioPath}.before-market-cache-${stamp}-${randomUUID()}.sqlite`;
  const tempPath = `${cachePath}.tmp`;
  rmSync(tempPath, { force: true });

  const source = new Database(portfolioPath, { readonly: true, fileMustExist: true });
  try {
    options.onProgress?.("Создаём согласованную резервную копию портфеля…");
    await source.backup(backupPath);
  } finally {
    source.close();
  }

  const snapshot = new Database(backupPath, { readonly: true, fileMustExist: true });
  const target = new Database(tempPath);
  let completeCounts: MarketCacheMigrationResult["counts"];
  try {
    options.onProgress?.("Проверяем резервную копию и переносим справочники…");
    if (snapshot.pragma("integrity_check", { simple: true }) !== "ok")
      throw Error("Предмиграционная копия портфеля не прошла integrity_check");
    target.exec(CACHE_SCHEMA);
    const { start, end } = completedRange(options.now ?? Date.now());
    const copy = target.transaction(() => {
      for (const table of [
        "systems",
        "stargates",
        "stations",
        "item_types",
      ]) {
        const columns = snapshot
          .prepare(`PRAGMA table_info(${table})`)
          .all() as { name: string }[];
        const names = columns.map((column) => column.name);
        const select = snapshot.prepare(`SELECT ${names.join(",")} FROM ${table}`);
        const insert = target.prepare(
          `INSERT INTO ${table}(${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`,
        );
        for (const row of select.iterate() as Iterable<Record<string, unknown>>)
          insert.run(...names.map((name) => row[name]));
      }

      const generations = snapshot.prepare(`
        SELECT r.* FROM market_snapshot_runs r
        WHERE r.status='complete' AND r.id IN (
          SELECT id FROM (
            SELECT id,region_id,completed_at,rowid,
              row_number() OVER (PARTITION BY region_id ORDER BY completed_at DESC,rowid DESC) rank
            FROM market_snapshot_runs WHERE status='complete'
          ) WHERE rank=1
        ) ORDER BY r.region_id
      `);
      const insertGeneration = target.prepare(
        "INSERT INTO market_snapshot_runs VALUES (?,?,?,?,?,?,?,?)",
      );
      const insertOrder = target.prepare(
        "INSERT INTO market_orders VALUES (?,?,?,?,?)",
      );
      for (const raw of generations.iterate() as Iterable<Record<string, unknown>>) {
        const generation = String(raw.id);
        insertGeneration.run(
          raw.id,
          raw.region_id,
          raw.started_at,
          raw.completed_at,
          raw.modified_at,
          raw.expires_at,
          raw.status,
          raw.pages,
        );
        const orders = snapshot.prepare(
          "SELECT generation,id,type_id,location_id,payload FROM market_orders WHERE generation=?",
        );
        for (const order of orders.iterate(generation) as Iterable<Record<string, unknown>>)
          insertOrder.run(
            order.generation,
            order.id,
            order.type_id,
            order.location_id,
            order.payload,
          );
      }

      options.onProgress?.("Переносим актуальные снимки ордеров и недельную историю…");

      const insertHistory = target.prepare(
        "INSERT INTO regional_history VALUES (?,?,?,?,?)",
      );
      const history = snapshot.prepare(
        "SELECT region_id,type_id,date,payload,available_at FROM regional_history WHERE date>=? AND date<? ORDER BY region_id,type_id,date",
      );
      for (const row of history.iterate(start, end) as Iterable<Record<string, unknown>>)
        insertHistory.run(row.region_id, row.type_id, row.date, row.payload, row.available_at);

      const insertObservation = target.prepare(
        "INSERT INTO station_observations VALUES (?,?,?,?,?)",
      );
      const observations = snapshot.prepare(
        "SELECT id,station_id,type_id,at,payload FROM station_observations WHERE at>=? ORDER BY at,id",
      );
      const observationCutoff = new Date((options.now ?? Date.now()) - 7 * DAY_MS).toISOString();
      for (const row of observations.iterate(observationCutoff) as Iterable<Record<string, unknown>>)
        insertObservation.run(row.id, row.station_id, row.type_id, row.at, row.payload);

      const insertCursor = target.prepare(
        "INSERT INTO market_sync_cursors VALUES (?,?)",
      );
      for (const key of ["history-revision", "static"]) {
        const cursor = snapshot
          .prepare("SELECT value FROM sync_cursors WHERE key=?")
          .get(key) as { value: string } | undefined;
        if (cursor) insertCursor.run(key, cursor.value);
      }
    });
    copy();
    if ((snapshot.pragma("foreign_key_check") as unknown[]).length)
      throw Error("Снимок портфеля содержит нарушение внешних ключей");
    if ((target.pragma("foreign_key_check") as unknown[]).length)
      throw Error("Мигрированный рыночный кеш содержит нарушение внешних ключей");
    const sourceOrders = Number(
      (
        snapshot
          .prepare(`SELECT count(*) n FROM market_orders WHERE generation IN (
            SELECT id FROM market_snapshot_runs WHERE status='complete' AND id IN (
              SELECT id FROM (
                SELECT id,region_id,completed_at,rowid,row_number() OVER (PARTITION BY region_id ORDER BY completed_at DESC,rowid DESC) rank
                FROM market_snapshot_runs WHERE status='complete'
              ) WHERE rank=1
            )
          )`)
          .get() as { n: number }
      ).n,
    );
    completeCounts = cacheCounts(target);
    if (completeCounts.orders !== sourceOrders)
      throw Error("Число перенесённых рыночных ордеров не совпало с исходной копией");
    const historyRange = completedRange(options.now ?? Date.now());
    if (
      target
        .prepare("SELECT 1 FROM regional_history WHERE date<? OR date>=? LIMIT 1")
        .get(historyRange.start, historyRange.end)
    )
      throw Error("В кеше обнаружена история вне семидневного окна");
    target
      .prepare("INSERT INTO cache_meta VALUES ('migration_complete','true')")
      .run();
    target
      .prepare("INSERT INTO cache_meta VALUES ('source_schema_version',?)")
      .run(String(snapshot.pragma("user_version", { simple: true })));
    target
      .prepare("INSERT INTO cache_meta VALUES ('week_start',?)")
      .run(historyRange.start);
    target
      .prepare("INSERT INTO cache_meta VALUES ('week_end_exclusive',?)")
      .run(historyRange.end);
    target.pragma("optimize");
    if (options.failAfterCopy) throw Error("Тестовый сбой после сборки временного кеша");
  } finally {
    target.close();
    snapshot.close();
  }

  const validation = new Database(tempPath, { readonly: true, fileMustExist: true });
  try {
    options.onProgress?.("Проверяем целостность нового рыночного кеша…");
    if (validation.pragma("integrity_check", { simple: true }) !== "ok")
      throw Error("Новый рыночный кеш не прошёл integrity_check");
    if ((validation.pragma("foreign_key_check") as unknown[]).length)
      throw Error("Новый рыночный кеш не прошёл foreign_key_check");
  } finally {
    validation.close();
  }
  renameSync(tempPath, cachePath);
  options.onProgress?.("Кеш готов; завершаем переключение…");
  const manifest = {
    format: "eve-market-cache-migration-v1",
    completedAt: new Date(options.now ?? Date.now()).toISOString(),
    source: portfolioPath,
    sourceBackup: backupPath,
    cache: cachePath,
    counts: completeCounts!,
  };
  const manifestTemp = join(dirname(manifestPath), ".market-cache-migration.tmp");
  writeFileSync(manifestTemp, JSON.stringify(manifest, null, 2) + "\n", { flag: "w" });
  renameSync(manifestTemp, manifestPath);
  return { status: "migrated", backupPath, manifestPath, counts: completeCounts! };
}
