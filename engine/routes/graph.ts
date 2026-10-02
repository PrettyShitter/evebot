export interface System {
  id: string;
  name: string;
  regionId: string;
  security: number;
  neighbors: string[];
}
export const SEARCH_RADIUS = 3;
export type RouteMode = "highsec" | "lowsec";
export const CENTERS = ["30000142", "30002187", "30002659"];
// CCP system-security guide: positive values below .05 display as .1; >=.45 highsec.
export function securityClass(raw: number): "highsec" | "lowsec" | "nullsec" {
  return raw >= 0.45 ? "highsec" : raw > 0 ? "lowsec" : "nullsec";
}
export class Graph {
  readonly systems: Map<string, System>;
  constructor(systems: System[]) {
    this.systems = new Map(systems.map((s) => [s.id, s]));
  }
  zone(centers: string[], radius = SEARCH_RADIUS) {
    const found = new Set<string>();
    const queue: [string, number][] = [];
    for (const c of centers) {
      if (!this.systems.has(c)) throw Error("Неизвестный центр");
      found.add(c);
      queue.push([c, 0]);
    }
    for (let i = 0; i < queue.length; i++) {
      const [id, d] = queue[i];
      if (d === radius) continue;
      for (const n of this.systems.get(id)!.neighbors) {
        if (!found.has(n) && this.systems.has(n)) {
          found.add(n);
          queue.push([n, d + 1]);
        }
      }
    }
    return found;
  }
  route(from: string, to: string, mode?: RouteMode): string[] | null {
    const allowed = (id: string) => {
      const s = this.systems.get(id);
      return (
        !!s &&
        (!mode ||
          (mode === "highsec"
            ? securityClass(s.security) === "highsec"
            : securityClass(s.security) !== "nullsec"))
      );
    };
    if (!allowed(from) || !allowed(to)) return null;
    const prev = new Map<string, string | null>([[from, null]]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      if (id === to) {
        const path: string[] = [];
        let cur: string | null = to;
        while (cur !== null) {
          path.push(cur);
          cur = prev.get(cur)!;
        }
        return path.reverse();
      }
      for (const n of this.systems.get(id)!.neighbors)
        if (allowed(n) && !prev.has(n)) {
          prev.set(n, id);
          queue.push(n);
        }
    }
    return null;
  }
  buyApplies(
    order: {
      locationId: string;
      systemId: string;
      regionId: string;
      range: string;
    },
    station: { id: string; systemId: string; regionId: string },
  ) {
    if (order.regionId !== station.regionId) return false;
    if (order.range === "station") return order.locationId === station.id;
    if (order.range === "region") return true;
    if (order.range === "solarsystem")
      return order.systemId === station.systemId;
    const distance = this.route(order.systemId, station.systemId);
    return distance !== null && distance.length - 1 <= Number(order.range);
  }
}
export function isAdditional(
  path: string[] | null,
  mode: RouteMode,
  zone: Set<string>,
  source: string,
  destination: string,
) {
  return (
    mode === "highsec" &&
    !!path &&
    path.slice(1, -1).includes(source) &&
    zone.has(source) &&
    path.at(-1) === destination
  );
}
