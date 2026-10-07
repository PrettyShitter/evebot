import { build } from "esbuild";
import { writeFileSync, renameSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const modulePath = resolve(tmpdir(), "eve-static-data-parser.cjs");
await build({
  entryPoints: ["engine/market/static-data.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: modulePath,
});
const require = createRequire(import.meta.url);
const { extractSde, withSearchZone } = require(modulePath);
const archive = process.argv[2]
  ? new Uint8Array(readFileSync(process.argv[2]))
  : await (async () => {
      const response = await fetch(
        "https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip",
        { signal: AbortSignal.timeout(180000) },
      );
      if (!response.ok) throw Error(`Official SDE download failed: ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    })();

const data = withSearchZone(extractSde(archive));
for (let i = 0; i < data.stations.length; i += 500) {
  const batch = data.stations.slice(i, i + 500);
  const response = await fetch(
    "https://esi.evetech.net/universe/names/?datasource=tranquility&language=en",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "EVE-Trader/0.1 (static station names)",
      },
      body: JSON.stringify(batch.map((station) => Number(station.id))),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok) throw Error(`Station-name lookup failed: ${response.status}`);
  const names = await response.json();
  const byId = new Map(names.map((name) => [String(name.id), name.name]));
  for (const station of batch)
    station.name = byId.get(station.id) ?? station.name;
}

if (
  !data.manufacturing?.length ||
  !data.reprocessing?.length ||
  Object.keys(data.alphaSkillCaps ?? {}).length !== 4
)
  throw Error("SDE parser produced incomplete production datasets");
const target = resolve("resources/static-data.json");
const temporary = target + ".tmp";
writeFileSync(temporary, JSON.stringify(data));
renameSync(temporary, target);
process.stdout.write(
  `Bundled SDE ${data.version}: ${data.manufacturing.length} manufacturing blueprints, ` +
    `${data.reprocessing.length} reprocessing compositions, ` +
    `${data.types.length} published market types.\n`,
);
