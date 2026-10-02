import { it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UpdateController } from "../../desktop/update-controller";
import { verifyManifest, isNewer } from "../../engine/updates/manifest";
import { SignedMacUpdater } from "../../desktop/signed-mac-updater";
class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowDowngrade = true;
  allowPrerelease = true;
  checks = 0;
  downloads = 0;
  installs = 0;
  async checkForUpdates() {
    this.checks++;
    this.emit("update-available", { version: "0.1.3" });
  }
  async downloadUpdate() {
    this.downloads++;
    this.emit("download-progress", { percent: 50 });
    this.emit("update-downloaded");
  }
  quitAndInstall() {
    this.installs++;
  }
}
it("updater requires explicit download/install, coalesces checks and preserves downloaded state", async () => {
  const backend = new FakeUpdater();
  let backups = 0;
  const c = new UpdateController(
    backend,
    "0.1.2",
    null,
    async () => {
      backups++;
    },
    () => 10000000,
  );
  await Promise.all([c.check(), c.check()]);
  expect(backend.checks).toBe(1);
  expect(backend.autoDownload).toBe(false);
  expect(backend.autoInstallOnAppQuit).toBe(false);
  await c.install();
  expect(backups).toBe(0);
  await c.download();
  expect(c.view.phase).toBe("downloaded");
  await c.check();
  expect(backend.checks).toBe(1);
  await c.install();
  expect(backups).toBe(1);
  expect(backend.installs).toBe(1);
});
it("backup failure prevents replacement, permits retry and hides sensitive upstream errors", async () => {
  const backend = new FakeUpdater();
  let reset = 0;
  const c = new UpdateController(
    backend,
    "0.1.2",
    null,
    async () => {
      throw Error("secret-file-path");
    },
    Date.now,
    () => reset++,
  );
  await c.check();
  await c.download();
  await c.install();
  expect(backend.installs).toBe(0);
  expect(reset).toBe(1);
  expect(c.view.phase).toBe("downloaded");
  expect(c.view.message).not.toContain("secret");
  backend.emit("error", Error("token=secret"));
  expect(c.view.message).not.toContain("token");
});
it("disabled updater never contacts server", async () => {
  const b = new FakeUpdater();
  const c = new UpdateController(b, "0.1.2", "Unconfigured", async () => {});
  await c.check();
  await c.download();
  await c.install();
  expect(b.checks + b.downloads + b.installs).toBe(0);
});
const keys = generateKeyPairSync("ed25519");
const key = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
function signed(version = "0.1.3") {
  const payload = JSON.stringify({
    schema: 1,
    version,
    platform: "darwin",
    arch: "arm64",
    size: 4,
    sha512: createHash("sha512").update("good").digest("hex"),
    url: `https://github.com/PrettyShitter/evebot/releases/download/v${version}/EVE-Trader-${version}-mac-arm64.zip`,
  });
  return {
    payload,
    signature: sign(null, Buffer.from(payload), keys.privateKey).toString(
      "base64",
    ),
  };
}
it("signed manifest rejects tampering, wrong key/architecture, and version comparison rejects downgrade", () => {
  expect(verifyManifest(signed(), key, "arm64").version).toBe("0.1.3");
  const bad = signed();
  bad.payload = bad.payload.replace("0.1.3", "9.9.9");
  expect(() => verifyManifest(bad, key, "arm64")).toThrow();
  expect(() => verifyManifest(signed(), key, "x64")).toThrow();
  const other = generateKeyPairSync("ed25519")
    .publicKey.export({ type: "spki", format: "pem" })
    .toString();
  expect(() => verifyManifest(signed(), other, "arm64")).toThrow();
  expect(isNewer("0.1.3", "0.1.2")).toBe(true);
  expect(isNewer("0.1.1", "0.1.2")).toBe(false);
  expect(isNewer("0.1.2", "0.1.2")).toBe(false);
});
it("corrupted downloaded bytes cannot become installable despite a valid manifest", async () => {
  const directory = mkdtempSync(join(tmpdir(), "eve-update-test-"));
  try {
    let calls = 0;
    const backend = new SignedMacUpdater(
      {
        version: "0.1.2",
        arch: "arm64",
        publicKey: key,
        userData: directory,
        appPath: join(directory, "EVE Trader.app"),
        helper: "resources/install-update.sh",
        quit: () => {},
        demo: () => true,
      },
      async () =>
        ++calls === 1
          ? new Response(JSON.stringify(signed()))
          : new Response("evil"),
    );
    await backend.checkForUpdates();
    await expect(backend.downloadUpdate()).rejects.toThrow("checksum");
    expect(() => backend.quitAndInstall()).toThrow("No downloaded");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
