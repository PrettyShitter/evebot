import { parseExact } from "../../shared/contracts/esi";
export class EsiError extends Error {
  constructor(
    readonly status: number,
    readonly retryAt: number,
    message: string,
  ) {
    super(message);
  }
}
interface Cached {
  body: unknown;
  expires: number;
  etag: string | null;
  modified: string | null;
  pages: number;
}
export class EsiClient {
  private cache = new Map<string, Cached>();
  private pending = new Map<string, Promise<Cached>>();
  private blockedUntil = 0;
  constructor(
    private fetcher: typeof fetch = fetch,
    private clock: () => number = Date.now,
  ) {}
  async get(
    path: string,
    token?: string,
    characterId?: string,
  ): Promise<Cached> {
    if (!path.startsWith("/") || path.includes("://"))
      throw Error("Invalid ESI path");
    const key = (characterId ?? "public") + ":" + path;
    const c = this.cache.get(key);
    if (c && c.expires > this.clock()) return c;
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
    const job = (async () => {
      if (this.blockedUntil > this.clock())
        throw new EsiError(429, this.blockedUntil, "Ожидание лимита ESI");
      const url = new URL("https://esi.evetech.net" + path);
      url.searchParams.set("compatibility_date", "2026-08-18");
      const headers: Record<string, string> = {
        "User-Agent": "EVE-Trader/0.1 (local desktop market companion)",
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (c?.etag) headers["If-None-Match"] = c.etag;
      const r = await this.fetcher(url, {
        headers,
        signal: AbortSignal.timeout(25000),
      });
      const seconds = Number(r.headers.get("Retry-After") ?? "30");
      const retry = Number.isFinite(seconds) ? seconds : 30;
      const remaining = r.headers.get("X-Ratelimit-Remaining");
      const errorRemaining = r.headers.get("X-Esi-Error-Limit-Remain");
      if (remaining !== null && Number(remaining) < 10)
        this.blockedUntil = Math.max(this.blockedUntil, this.clock() + 30000);
      if (errorRemaining !== null && Number(errorRemaining) < 5)
        this.blockedUntil = Math.max(
          this.blockedUntil,
          this.clock() +
            Math.max(
              1000,
              Number(r.headers.get("X-Esi-Error-Limit-Reset") ?? 60) * 1000,
            ),
        );
      if (r.status === 429 || r.status === 420) {
        this.blockedUntil = this.clock() + Math.max(1000, retry * 1000);
        throw new EsiError(
          r.status,
          this.blockedUntil,
          "ESI ограничил запросы",
        );
      }
      if (!r.ok && r.status !== 304)
        throw new EsiError(
          r.status,
          this.clock() + 30000,
          r.status === 401 || r.status === 403
            ? "Доступ персонажа недействителен"
            : "ESI временно недоступен",
        );
      const expiry = Date.parse(r.headers.get("Expires") ?? "");
      const maxAge = r.headers
        .get("Cache-Control")
        ?.match(/max-age=(\d+)/)?.[1];
      const expires = Number.isFinite(expiry)
        ? expiry
        : this.clock() + Number(maxAge ?? 60) * 1000;
      const entry: Cached =
        r.status === 304 && c
          ? { ...c, expires }
          : {
              body: parseExact(await r.text()),
              expires,
              etag: r.headers.get("ETag"),
              modified: r.headers.get("Last-Modified"),
              pages: Number(r.headers.get("X-Pages") ?? 1),
            };
      this.cache.set(key, entry);
      if (this.cache.size > 1000) {
        const oldest = this.cache.keys().next().value;
        if (oldest) this.cache.delete(oldest);
      }
      return entry;
    })();
    this.pending.set(key, job);
    try {
      return await job;
    } finally {
      this.pending.delete(key);
    }
  }
  clear() {
    this.cache.clear();
  }
}
