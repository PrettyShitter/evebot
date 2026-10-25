import { parseExact } from "../../shared/contracts/esi";
import { gunzipSync, gzipSync } from "node:zlib";
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
  notModified: boolean;
  raw: string;
}
type Persisted = Omit<Cached, "body" | "notModified" | "raw"> & { raw: string | null };
export interface EsiResponseCache {
  get(key: string): Persisted | undefined;
  set(key: string, value: Persisted): void;
}

/** A bounded, compressed cache for public ESI responses in market-cache.sqlite. */
export class SqliteEsiResponseCache implements EsiResponseCache {
  private readonly maxBytes = 128 * 1024 * 1024;
  private readonly maxEntries = 20_000;
  constructor(private readonly db: import("better-sqlite3").Database) {
    db.exec("CREATE TABLE IF NOT EXISTS esi_response_cache (cache_key TEXT PRIMARY KEY, etag TEXT, modified TEXT, expires_at INTEGER NOT NULL, pages INTEGER NOT NULL, body BLOB, body_bytes INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS esi_response_cache_updated ON esi_response_cache(updated_at)");
  }
  get(key: string): Persisted | undefined {
    const row = this.db.prepare(
      "SELECT etag,modified,expires_at,pages,body FROM esi_response_cache WHERE cache_key=?",
    ).get(key) as { etag: string | null; modified: string | null; expires_at: number; pages: number; body: Buffer | null } | undefined;
    if (!row) return undefined;
    this.db.prepare("UPDATE esi_response_cache SET updated_at=? WHERE cache_key=?").run(Date.now(), key);
    return {
      etag: row.etag,
      modified: row.modified,
      expires: row.expires_at,
      pages: row.pages,
      raw: row.body ? gunzipSync(row.body).toString("utf8") : null,
    };
  }
  set(key: string, value: Persisted) {
    const body = value.raw === null ? null : gzipSync(value.raw);
    const bodyBytes = body?.byteLength ?? 0;
    this.db.prepare(`INSERT INTO esi_response_cache(cache_key,etag,modified,expires_at,pages,body,body_bytes,updated_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET etag=excluded.etag,modified=excluded.modified,expires_at=excluded.expires_at,pages=excluded.pages,body=excluded.body,body_bytes=excluded.body_bytes,updated_at=excluded.updated_at`)
      .run(key, value.etag, value.modified, value.expires, value.pages, body, bodyBytes, Date.now());
    this.db.prepare(`DELETE FROM esi_response_cache WHERE cache_key IN (
      SELECT cache_key FROM esi_response_cache WHERE cache_key<>? ORDER BY updated_at ASC LIMIT MAX(0,(SELECT count(*) FROM esi_response_cache)-?)
    )`).run(key, this.maxEntries);
    let total = Number((this.db.prepare("SELECT COALESCE(SUM(body_bytes),0) n FROM esi_response_cache").get() as { n: number }).n);
    while (total > this.maxBytes) {
      const oldest = this.db.prepare("SELECT cache_key,body_bytes FROM esi_response_cache WHERE cache_key<>? ORDER BY updated_at ASC LIMIT 1").get(key) as { cache_key: string; body_bytes: number } | undefined;
      if (!oldest) {
        this.db.prepare("UPDATE esi_response_cache SET body=NULL,body_bytes=0 WHERE cache_key=?").run(key);
        break;
      }
      this.db.prepare("UPDATE esi_response_cache SET body=NULL,body_bytes=0 WHERE cache_key=?").run(oldest.cache_key);
      total -= oldest.body_bytes;
    }
  }
}
export class EsiClient {
  private cache = new Map<string, Cached>();
  private pending = new Map<string, Promise<Cached>>();
  private blockedUntil = 0;
  constructor(
    private fetcher: typeof fetch = fetch,
    private clock: () => number = Date.now,
    private persistent?: EsiResponseCache,
  ) {}
  async get(
    path: string,
    token?: string,
    characterId?: string,
  ): Promise<Cached> {
    if (!path.startsWith("/") || path.includes("://"))
      throw Error("Invalid ESI path");
    const key = (characterId ?? "public") + ":" + path;
    let c = this.cache.get(key);
    if (!c && !token) {
      const saved = this.persistent?.get(key);
      if (saved?.raw !== null && saved?.raw !== undefined) {
        c = { ...saved, body: parseExact(saved.raw), raw: saved.raw, notModified: false };
        this.cache.set(key, c);
      } else if (saved) {
        c = { ...saved, body: undefined, raw: "", notModified: false } as Cached;
      }
    }
    if (c && c.body !== undefined && c.expires > this.clock()) return c;
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
      let r = await this.fetcher(url, {
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
      let expires = Number.isFinite(expiry)
        ? expiry
        : this.clock() + Number(maxAge ?? 60) * 1000;
      if (r.status === 304 && (c?.body === undefined || c.raw === "")) {
        // A validator may outlive its bounded response body. Retry once without
        // validators so callers never mistake a bodyless 304 for an empty page.
        const unconditional = new Headers(headers);
        unconditional.delete("If-None-Match");
        r = await this.fetcher(url, { headers: unconditional, signal: AbortSignal.timeout(25000) });
        if (!r.ok) throw new EsiError(r.status, this.clock() + 30000, "Не удалось получить тело ответа ESI");
        const unconditionalExpiry = Date.parse(r.headers.get("Expires") ?? "");
        const unconditionalMaxAge = r.headers.get("Cache-Control")?.match(/max-age=(\d+)/)?.[1];
        expires = Number.isFinite(unconditionalExpiry)
          ? unconditionalExpiry
          : this.clock() + Number(unconditionalMaxAge ?? 60) * 1000;
      }
      const notModified = r.status === 304;
      const raw = notModified && c ? c.raw : await r.text();
      const entry: Cached = {
        body: notModified && c ? c.body : parseExact(raw),
        raw,
        expires,
        etag: r.headers.get("ETag") ?? c?.etag ?? null,
        modified: r.headers.get("Last-Modified") ?? c?.modified ?? null,
        pages: Number(r.headers.get("X-Pages") ?? c?.pages ?? 1),
        notModified,
      };
      this.cache.set(key, entry);
      if (!token) this.persistent?.set(key, {
        raw,
        expires: entry.expires,
        etag: entry.etag,
        modified: entry.modified,
        pages: entry.pages,
      });
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
