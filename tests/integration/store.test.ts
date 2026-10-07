import { it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { Store, restoreBackup } from "../../db/store";
import { DEFAULT_SETTINGS, requestSchema } from "../../shared/contracts/app";
it("stage 1: clean migration, persistence, rollback, backup and restored copy", async () => {
  const dir = mkdtempSync(join(tmpdir(), "eve-store-"));
  const path = join(dir, "portfolio.sqlite");
  let store = new Store(path, resolve("db/migrations"));
  try {
    expect(store.sql.pragma("user_version", { simple: true })).toBe(11);
    expect(store.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='production_structure_product_profiles'").get()).toEqual({ name: "production_structure_product_profiles" });
    store.saveSettings({ ...DEFAULT_SETTINGS, minProfit: "1234567" });
    expect(() =>
      store.sql.transaction(() => {
        store.sql
          .prepare("INSERT INTO settings VALUES (?,?,?)")
          .run("transient", "{}", 1);
        throw Error("simulated crash");
      })(),
    ).toThrow();
    expect(
      store.sql.prepare("SELECT * FROM settings WHERE key=?").get("transient"),
    ).toBeUndefined();
    await store.backup(join(dir, "backup.sqlite"));
    store.close();
    store = new Store(path, resolve("db/migrations"));
    expect(store.getSettings().minProfit).toBe("1234567");
    store.saveSettings({ ...DEFAULT_SETTINGS, minProfit: "9" });
    store.close();
    restoreBackup(join(dir, "backup.sqlite"), path);
    store = new Store(path, resolve("db/migrations"));
    expect(store.getSettings().minProfit).toBe("1234567");
    expect(store.sql.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(store.sql.pragma("foreign_key_check")).toEqual([]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("migration failure rolls back DDL", () => {
  const dir = mkdtempSync(join(tmpdir(), "eve-migration-"));
  writeFileSync(
    join(dir, "001.sql"),
    "CREATE TABLE x(id TEXT); INVALID STATEMENT;",
  );
  expect(() => new Store(join(dir, "db.sqlite"), dir)).toThrow();
  rmSync(dir, { recursive: true, force: true });
});
it("stage 1: upgrades a version-2 portfolio without losing existing deals or characters", () => {
  const dir = mkdtempSync(join(tmpdir(), "eve-v2-upgrade-"));
  const path = join(dir, "portfolio.sqlite");
  const legacy = new Database(path);
  try {
    legacy.exec(readFileSync("db/migrations/001.sql", "utf8"));
    legacy.exec(readFileSync("db/migrations/002.sql", "utf8"));
    legacy.pragma("user_version = 2");
    legacy
      .prepare("INSERT INTO characters(id,name,status,is_seller) VALUES (?,?,?,?)")
      .run("9001", "Main", "connected", 1);
    legacy
      .prepare("INSERT INTO deals(id,source,destination,status,seller_id,forecast,created_at) VALUES (?,?,?,?,?,?,?)")
      .run("trade-1", "600", "601", "OPEN", "9001", "[]", "2026-10-08T00:00:00Z");
  } finally {
    legacy.close();
  }

  const upgraded = new Store(path, resolve("db/migrations"));
  try {
    expect(upgraded.sql.pragma("user_version", { simple: true })).toBe(11);
    expect(upgraded.sql.prepare("SELECT id FROM deals").get()).toEqual({
      id: "trade-1",
    });
    expect(upgraded.sql.prepare("SELECT id,scopes FROM characters").get()).toEqual({
      id: "9001",
      scopes: "[]",
    });
    expect(
      upgraded.sql
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='production_projects'")
        .get(),
    ).toEqual({ name: "production_projects" });
    expect(upgraded.sql.pragma("foreign_key_check")).toEqual([]);
  } finally {
    upgraded.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("IPC rejects arbitrary SQL, network, path and unrecognized settings", () => {
  for (const payload of [
    { kind: "sql", sql: "DROP TABLE deals" },
    { kind: "state", path: "/etc/passwd" },
    { kind: "fetch", url: "https://example.com" },
    { kind: "settings.save", value: { ...DEFAULT_SETTINGS, token: "secret" } },
  ])
    expect(requestSchema.safeParse(payload).success).toBe(false);
});
it("removes the former per-item budget cap from settings on legacy installs", () => {
  const store = new Store(":memory:", resolve("db/migrations"));
  try {
    store.saveSettings({ ...DEFAULT_SETTINGS, maxTypeShare: 0.2 });
    expect(store.getSettings().maxTypeShare).toBe(1);
    expect(DEFAULT_SETTINGS.maxTypeShare).toBe(1);
  } finally {
    store.close();
  }
});
