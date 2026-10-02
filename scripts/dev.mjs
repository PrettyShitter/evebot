import electron from "electron";
import { spawn, spawnSync } from "node:child_process";
const build = spawnSync("node", ["scripts/build.mjs"], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);
const child = spawn(electron, ["."], { stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 0));
