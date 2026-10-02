import { createHash, sign, verify } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error("Stable version required");
const arch = process.argv[2] ?? process.arch;
if (!["arm64", "x64"].includes(arch)) throw Error("Unsupported architecture");
const name = `EVE-Trader-${version}-mac-${arch}.zip`;
const archive = readFileSync(join("release", name));
const payload = JSON.stringify({
  schema: 1,
  version,
  platform: "darwin",
  arch,
  size: archive.length,
  sha512: createHash("sha512").update(archive).digest("hex"),
  url: `https://github.com/PrettyShitter/evebot/releases/download/v${version}/${name}`,
});
const key =
  process.env.EVE_UPDATE_PRIVATE_KEY ??
  readFileSync(
    process.env.EVE_UPDATE_KEY_FILE ??
      join(homedir(), ".config", "eve-trader", "updates-private-key.pem"),
    "utf8",
  );
const signature = sign(null, Buffer.from(payload), key).toString("base64");
if (
  !verify(
    null,
    Buffer.from(payload),
    readFileSync("resources/updates-public-key.pem"),
    Buffer.from(signature, "base64"),
  )
)
  throw Error("Signing key does not match the public key embedded in the app");
writeFileSync(
  `release/eve-trader-darwin-${arch}.update.json`,
  JSON.stringify({ payload, signature }, null, 2),
);
console.log(`Signed update ${version} / ${arch}`);
