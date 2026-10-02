import { it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
for (const healthy of [true, false])
  it.skipIf(process.platform !== "darwin")(
    "Mac update helper: " +
      (healthy
        ? "healthy restart commits replacement"
        : "failed boot restores old app and database"),
    () => {
      const root = mkdtempSync(join(tmpdir(), "eve-helper-"));
      try {
        const target = join(root, "installed", "EVE Trader.app"),
          source = join(root, "new", "EVE Trader.app"),
          data = join(root, "userData"),
          token = randomUUID(),
          cache = join(data, "update-cache", token),
          backups = join(cache, "backups");
        for (const app of [target, source]) {
          mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
          writeFileSync(
            join(app, "Contents", "Info.plist"),
            '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.eve.trader</string><key>CFBundleShortVersionString</key><string>0.1.3</string></dict></plist>',
          );
        }
        mkdirSync(backups, { recursive: true });
        writeFileSync(join(data, "portfolio.sqlite"), "old database");
        writeFileSync(join(backups, "portfolio.sqlite"), "old database");
        writeFileSync(
          join(target, "Contents", "MacOS", "EVE Trader"),
          '#!/bin/sh\ntouch "$EVE_USER_DATA/old-launched"\n',
          { mode: 0o755 },
        );
        const script =
          '#!/bin/sh\nprintf "new database" > "$EVE_USER_DATA/portfolio.sqlite"\n' +
          (healthy
            ? 'token=${1#--eve-update-token=}\nprintf "0.1.3" > "$EVE_USER_DATA/update-cache/$token/healthy"\n'
            : "exit 42\n");
        writeFileSync(join(source, "Contents", "MacOS", "EVE Trader"), script, {
          mode: 0o755,
        });
        const zip = join(cache, "release.zip");
        execFileSync("/usr/bin/ditto", [
          "-c",
          "-k",
          "--keepParent",
          source,
          zip,
        ]);
        const hash = createHash("sha512")
          .update(readFileSync(zip))
          .digest("hex");
        let succeeded = true;
        try {
          execFileSync(
            "/bin/sh",
            [
              resolve("resources/install-update.sh"),
              target,
              zip,
              hash,
              "999999",
              token,
              data,
              backups,
              "0.1.3",
              "1",
            ],
            { timeout: 15000, stdio: "pipe" },
          );
        } catch {
          succeeded = false;
        }
        expect(succeeded).toBe(healthy);
        expect(readFileSync(join(data, "portfolio.sqlite"), "utf8")).toBe(
          healthy ? "new database" : "old database",
        );
        expect(readFileSync(join(data, "update-result.txt"), "utf8")).toContain(
          healthy ? "installed" : "failed",
        );
        expect(existsSync(target)).toBe(true);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    20000,
  );
