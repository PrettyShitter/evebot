import { it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Store, restoreBackup } from "../../db/store";
import { DEFAULT_SETTINGS, requestSchema } from "../../shared/contracts/app";
it("stage 1: clean migration, persistence, rollback, backup and restored copy", async () => {
  const dir = mkdtempSync(join(tmpdir(), "eve-store-"));
  const path = join(dir, "portfolio.sqlite");
  let store = new Store(path, resolve("db/migrations"));
  try {
    expect(store.sql.pragma("user_version", { simple: true })).toBe(2);
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
