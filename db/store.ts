import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import {
  readFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { settings } from "./schema";
import type { Settings } from "../shared/contracts/app";
import { DEFAULT_SETTINGS } from "../shared/contracts/app";
export class Store {
  readonly sql: Database.Database;
  readonly orm;
  constructor(
    readonly path: string,
    migrationPath: string,
  ) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.sql = new Database(path);
    this.sql.pragma("foreign_keys = ON");
    this.sql.pragma("journal_mode = WAL");
    this.sql.pragma("busy_timeout = 5000");
    this.orm = drizzle(this.sql);
    const version = Number(this.sql.pragma("user_version", { simple: true }));
    try {
      if (version > 2) throw Error("Версия базы новее приложения");
      if (version > 0 && version < 2 && path !== ":memory:")
        this.sql
          .prepare("VACUUM INTO ?")
          .run(path + ".before-migration-" + version + "-" + Date.now());
      for (let next = version + 1; next <= 2; next++)
        this.sql.transaction(() => {
          this.sql.exec(
            readFileSync(
              join(migrationPath, String(next).padStart(3, "0") + ".sql"),
              "utf8",
            ),
          );
          this.sql.pragma("user_version = " + next);
        })();
    } catch (error) {
      this.sql.close();
      throw error;
    }
  }
  getSettings(): Settings {
    const row = this.orm
      .select()
      .from(settings)
      .where(eq(settings.key, "app"))
      .get();
    return { ...DEFAULT_SETTINGS, ...(row ? JSON.parse(row.value) : {}) };
  }
  saveSettings(value: Settings) {
    this.sql.transaction(() => {
      const prior = this.orm
        .select()
        .from(settings)
        .where(eq(settings.key, "app"))
        .get();
      this.orm
        .insert(settings)
        .values({
          key: "app",
          value: JSON.stringify(value),
          version: (prior?.version ?? 0) + 1,
        })
        .onConflictDoUpdate({
          target: settings.key,
          set: {
            value: JSON.stringify(value),
            version: (prior?.version ?? 0) + 1,
          },
        })
        .run();
      this.sql
        .prepare("INSERT INTO settings_versions VALUES (?,?,?)")
        .run(
          crypto.randomUUID(),
          new Date().toISOString(),
          JSON.stringify(value),
        );
    })();
  }
  async backup(destination: string) {
    await this.sql.backup(destination);
    const copy = new Database(destination, { readonly: true });
    try {
      if (
        copy.pragma("integrity_check", { simple: true }) !== "ok" ||
        (copy.pragma("foreign_key_check") as unknown[]).length
      )
        throw Error("Резервная копия повреждена");
    } finally {
      copy.close();
    }
  }
  close() {
    this.sql.close();
  }
}
// Called only after the worker has closed its writer. Validate a temporary copy before replacing.
export function restoreBackup(source: string, destination: string) {
  const candidate = destination + ".restore";
  copyFileSync(source, candidate);
  const db = new Database(candidate);
  try {
    if (
      db.pragma("integrity_check", { simple: true }) !== "ok" ||
      (db.pragma("foreign_key_check") as unknown[]).length ||
      ![1, 2].includes(Number(db.pragma("user_version", { simple: true })))
    )
      throw Error("Некорректная резервная копия");
    db.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
  if (existsSync(destination)) {
    const previous = new Database(destination);
    try {
      previous.pragma("wal_checkpoint(TRUNCATE)");
    } finally {
      previous.close();
    }
    renameSync(destination, destination + ".before-restore-" + Date.now());
  }
  for (const suffix of ["-wal", "-shm"])
    rmSync(destination + suffix, { force: true });
  renameSync(candidate, destination);
}
