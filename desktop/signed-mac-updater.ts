import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { execFile, spawn } from "node:child_process";
import {
  mkdir,
  open,
  rm,
  writeFile,
  copyFile,
  mkdtemp,
} from "node:fs/promises";
import { closeSync, openSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  isNewer,
  manifestName,
  verifyManifest,
  RELEASE_REPOSITORY,
  type UpdateManifest,
} from "../engine/updates/manifest";
const exec = promisify(execFile);
export class SignedMacUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowDowngrade = false;
  allowPrerelease = false;
  private manifest: UpdateManifest | null = null;
  private token = "";
  private archive = "";
  constructor(
    private config: {
      version: string;
      arch: string;
      publicKey: string;
      userData: string;
      appPath: string;
      helper: string;
      quit: () => void;
      demo: () => boolean;
    },
    private fetcher: typeof fetch = fetch,
  ) {
    super();
  }
  get backupDirectory() {
    if (!this.token) throw Error("No staged update");
    return join(this.config.userData, "update-cache", this.token, "backups");
  }
  async checkForUpdates() {
    const response = await this.fetcher(
      `https://github.com/${RELEASE_REPOSITORY}/releases/latest/download/${manifestName(this.config.arch)}`,
      {
        signal: AbortSignal.timeout(30000),
        headers: { "User-Agent": "EVE-Trader-Updater" },
      },
    );
    if (!response.ok) throw Error("Release metadata unavailable");
    const reader = response.body?.getReader();
    if (!reader) throw Error("Missing manifest");
    let text = "";
    const decoder = new TextDecoder();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      text += decoder.decode(part.value, { stream: true });
      if (text.length > 32768) {
        await reader.cancel();
        throw Error("Manifest too large");
      }
    }
    const next = verifyManifest(
      JSON.parse(text),
      this.config.publicKey,
      this.config.arch,
    );
    if (!isNewer(next.version, this.config.version)) {
      this.manifest = null;
      this.emit("update-not-available");
      return null;
    }
    this.manifest = next;
    this.emit("update-available", { version: next.version });
    return next;
  }
  async downloadUpdate() {
    const manifest = this.manifest;
    if (!manifest) throw Error("No verified manifest");
    this.token = randomUUID();
    const directory = join(this.config.userData, "update-cache", this.token);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, "release.zip");
    const file = await open(path, "wx", 0o600);
    try {
      const response = await this.fetcher(manifest.url, {
        signal: AbortSignal.timeout(600000),
        headers: { "User-Agent": "EVE-Trader-Updater" },
      });
      if (!response.ok || !response.body) throw Error("Download failed");
      const hash = createHash("sha512");
      let size = 0;
      let progressAt = 0;
      const reader = response.body.getReader();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const part = chunk.value;
        size += part.length;
        if (size > manifest.size) throw Error("Release too large");
        hash.update(part);
        let offset = 0;
        while (offset < part.length) {
          const written = await file.write(part, offset, part.length - offset);
          if (!written.bytesWritten) throw Error("Incomplete file write");
          offset += written.bytesWritten;
        }
        if (Date.now() - progressAt > 200) {
          progressAt = Date.now();
          this.emit("download-progress", {
            percent: (size / manifest.size) * 100,
          });
        }
      }
      if (size !== manifest.size || hash.digest("hex") !== manifest.sha512)
        throw Error("Release checksum mismatch");
      await file.sync();
    } catch (error) {
      await file.close();
      await rm(path, { force: true });
      this.archive = "";
      throw error;
    }
    await file.close();
    const listing = await exec("/usr/bin/unzip", ["-Z1", path], {
      maxBuffer: 16 * 1024 * 1024,
    });
    if (
      listing.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .some(
          (p) =>
            !p.startsWith("EVE Trader.app/") ||
            p.split("/").includes("..") ||
            p.includes("\\"),
        )
    )
      throw Error("Unexpected archive contents");
    const probe = await mkdtemp(
      join(dirname(this.config.appPath), ".eve-update-write-"),
    );
    await rm(probe, { recursive: true });
    await copyFile(this.config.helper, join(directory, "install.sh"));
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify(manifest),
      { mode: 0o600 },
    );
    this.archive = path;
    this.emit("update-downloaded", { version: manifest.version });
    return [path];
  }
  quitAndInstall() {
    if (!this.archive || !this.manifest) throw Error("No downloaded update");
    const directory = join(this.config.userData, "update-cache", this.token);
    const log = openSync(join(directory, "install.log"), "a", 0o600);
    try {
      const helper = spawn(
        "/bin/sh",
        [
          join(directory, "install.sh"),
          this.config.appPath,
          this.archive,
          this.manifest.sha512,
          String(process.pid),
          this.token,
          this.config.userData,
          this.backupDirectory,
          this.manifest.version,
          this.config.demo() ? "1" : "0",
        ],
        { detached: true, stdio: ["ignore", log, log] },
      );
      helper.on("error", () =>
        this.emit("error", new Error("Installer failed to start")),
      );
      helper.once("spawn", () => {
        helper.unref();
        this.config.quit();
      });
    } finally {
      closeSync(log);
    }
  }
  acknowledgeHealthy(args: string[]) {
    const token = args
      .find((a) => a.startsWith("--eve-update-token="))
      ?.split("=")[1];
    if (
      token &&
      /^[a-f0-9-]{36}$/.test(token) &&
      existsSync(
        join(this.config.userData, "update-cache", token, "manifest.json"),
      )
    )
      writeFileSync(
        join(this.config.userData, "update-cache", token, "healthy"),
        this.config.version,
        { mode: 0o600 },
      );
  }
}
