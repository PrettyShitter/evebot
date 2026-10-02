import { readFileSync, writeFileSync } from "node:fs";
import { extractSde } from "../engine/market/static-data";
const data = extractSde(readFileSync(".cache/sde.zip"));
for (let i = 0; i < data.stations.length; i += 500) {
  const batch = data.stations.slice(i, i + 500);
  const r = await fetch(
    "https://esi.evetech.net/universe/names?compatibility_date=2026-08-18",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "EVE-Trader/0.1 (static station names)",
      },
      body: JSON.stringify(batch.map((s) => Number(s.id))),
    },
  );
  if (!r.ok) throw Error("Station names " + r.status);
  const rows = (await r.json()) as { id: number; name: string }[];
  for (const row of rows) {
    const station = batch.find((s) => s.id === String(row.id));
    if (station) station.name = row.name;
  }
}
writeFileSync("resources/static-data.json", JSON.stringify(data));
console.log(
  JSON.stringify({
    version: data.version,
    systems: data.systems.length,
    zone: data.zone.length,
    stations: data.stations.length,
    types: data.types.length,
    regions: data.regions,
  }),
);
