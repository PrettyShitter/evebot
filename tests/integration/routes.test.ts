import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Store } from "../../db/store";
import { seedDemo } from "../../engine/market/demo";
import { readStatic } from "../../engine/market/static-data";
import { demoScan } from "../fixtures/demo-scan";
import { Trades } from "../../engine/portfolio/trades";
it("stage 6: per-deal routes and independent child survive restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "eve-route-")),
    path = join(dir, "db.sqlite");
  let s = new Store(path, resolve("db/migrations"));
  try {
    seedDemo(s);
    const data = readStatic(s)!;
    let t = new Trades(s, () => data);
    const all = demoScan(s);
    const parent = all.find(
      (o) =>
        o.source.id === "60003760" &&
        o.destination.id === "60008494" &&
        o.type.id === "587",
    )!;
    const child = all.find(
      (o) =>
        o.source.id === "60000001" &&
        o.destination.id === "60008494" &&
        o.type.id === "35",
    )!;
    expect(parent).toBeTruthy();
    expect(child).toBeTruthy();
    t.accept("parent", [parent]);
    const before = t.list()[0].forecast;
    t.accept("child", [child], "parent");
    expect(t.list().find((d) => d.id === "parent")!.forecast).toEqual(before);
    t.route("parent", "lowsec");
    expect(t.list().find((d) => d.id === "child")!.routeMode).toBe("highsec");
    s.close();
    s = new Store(path, resolve("db/migrations"));
    t = new Trades(s, () => data);
    expect(t.list().find((d) => d.id === "parent")!.routeMode).toBe("lowsec");
    expect(t.list().find((d) => d.id === "child")!.parentId).toBe("parent");
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
