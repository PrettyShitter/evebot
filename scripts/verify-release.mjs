import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
const target =
  process.platform === "darwin"
    ? "mac"
    : process.platform === "win32"
      ? "win"
      : null;
if (!target) throw Error("This release verification requires macOS or Windows");
const revision = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
let report =
  "# Этап 10 — реальная упаковка\n\nUTC: " +
  new Date().toISOString() +
  "\n\nCommit: " +
  (revision.status === 0
    ? revision.stdout.trim()
    : "репозиторий без коммитов; рабочее дерево") +
  "\n\n";
const commands = [
  ["pnpm", ["dist:" + target]],
  ["node", ["scripts/packaged-smoke.mjs"]],
];
let failed = false;
for (const [command, args] of commands) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  report +=
    "## " +
    command +
    " " +
    args.join(" ") +
    "\n\nExit code: " +
    result.status +
    "; " +
    (result.status === 0 ? "PASS" : "FAIL") +
    "\n\n```text\n" +
    (result.stdout ?? "") +
    (result.stderr ?? "") +
    "\n```\n\n";
  if (result.status !== 0) {
    failed = true;
    break;
  }
}
if (!failed) {
  const hashes =
    readdirSync("release")
      .filter((p) => /\.(dmg|exe|zip)$/.test(p))
      .map(
        (file) =>
          createHash("sha256")
            .update(readFileSync("release/" + file))
            .digest("hex") +
          "  " +
          file,
      )
      .join("\n") + "\n";
  writeFileSync("release/checksums.sha256", hashes);
  writeFileSync("docs/verification/checksums.sha256", hashes);
  report += "## SHA-256\n\n```text\n" + hashes + "```\n\n";
}
report +=
  "Платформа: " +
  process.platform +
  "/" +
  process.arch +
  ".\n\nLive SSO и подпись/notarization: BLOCKED. Windows pipeline не запускался в локальной macOS-сессии. Подробности: [scope-10.md](./scope-10.md).\n";
mkdirSync("docs/verification", { recursive: true });
writeFileSync("docs/verification/stage-10.md", report);
process.exit(failed ? 1 : 0);
