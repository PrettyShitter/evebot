import { build } from "esbuild";
import { build as viteBuild } from "vite";
import { mkdirSync } from "node:fs";
mkdirSync("dist/desktop", { recursive: true });
await build({
  entryPoints: {
    main: "desktop/main.ts",
    preload: "desktop/preload.ts",
    worker: "engine/worker.ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  outdir: "dist/desktop",
  outExtension: { ".js": ".cjs" },
  external: ["electron", "better-sqlite3", "electron-updater"],
  sourcemap: true,
});
await viteBuild();
