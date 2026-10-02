import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
export const CALLBACK = "http://localhost:43827/callback";
export const SCOPES = {
  buyer: ["esi-wallet.read_character_wallet.v1"],
  seller: [
    "esi-wallet.read_character_wallet.v1",
    "esi-skills.read_skills.v1",
    "esi-skills.read_skillqueue.v1",
    "esi-characters.read_standings.v1",
    "esi-markets.read_character_orders.v1",
  ],
};
export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: randomBytes(32).toString("base64url"),
  };
}
export interface TokenRecord {
  characterId: string;
  name: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  scopes: string[];
}
export interface Vault {
  read(id: string): Promise<TokenRecord | null>;
  write(record: TokenRecord): Promise<void>;
  remove(id: string): Promise<void>;
}
const responseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number().positive(),
});
const metadataSchema = z.object({
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  jwks_uri: z.url(),
  issuer: z.string(),
});
export class SsoClient {
  private metadata: Promise<z.infer<typeof metadataSchema>> | undefined;
  constructor(
    readonly clientId: string,
    private readonly request: typeof fetch = fetch,
  ) {}
  async discovery() {
    if (!this.metadata)
      this.metadata = this.request(
        "https://login.eveonline.com/.well-known/oauth-authorization-server",
        { signal: AbortSignal.timeout(15000) },
      )
        .then(async (r) => {
          if (!r.ok) throw Error("SSO недоступен");
          const data = metadataSchema.parse(await r.json());
          for (const url of [
            data.authorization_endpoint,
            data.token_endpoint,
            data.jwks_uri,
          ])
            if (new URL(url).origin !== "https://login.eveonline.com")
              throw Error("Недоверенный SSO endpoint");
          return data;
        })
        .catch((e) => {
          this.metadata = undefined;
          throw e;
        });
    return this.metadata;
  }
  async authorization(scopes: string[]) {
    const secret = pkce();
    const meta = await this.discovery();
    const url = new URL(meta.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: CALLBACK,
      scope: scopes.join(" "),
      state: secret.state,
      code_challenge: secret.challenge,
      code_challenge_method: "S256",
    }).toString();
    return { ...secret, url: url.href, expiresAt: Date.now() + 300000 };
  }
  async exchange(body: Record<string, string>): Promise<TokenRecord> {
    const meta = await this.discovery();
    const response = await this.request(meta.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...body, client_id: this.clientId }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw Error(
        response.status === 400 || response.status === 401
          ? "Доступ EVE отозван. Подключите персонажа повторно."
          : "SSO временно недоступен",
      );
    const token = responseSchema.parse(await response.json());
    const { payload } = await jwtVerify(
      token.access_token,
      createRemoteJWKSet(new URL(meta.jwks_uri)),
      {
        issuer: [
          meta.issuer,
          "login.eveonline.com",
          "https://login.eveonline.com",
          "https://login.eveonline.com/",
        ],
        audience: this.clientId,
        algorithms: ["RS256"],
      },
    );
    if (
      !Array.isArray(payload.aud) ||
      !payload.aud.includes("EVE Online") ||
      !payload.sub?.match(/^CHARACTER:EVE:\d+$/)
    )
      throw Error("Некорректный EVE JWT");
    return {
      characterId: payload.sub.split(":")[2],
      name: z.string().parse(payload.name),
      refreshToken: token.refresh_token,
      accessToken: token.access_token,
      expiresAt: Math.min(
        (payload.exp ?? 0) * 1000,
        Date.now() + token.expires_in * 1000,
      ),
      scopes:
        typeof payload.scp === "string"
          ? payload.scp.split(" ")
          : z.array(z.string()).parse(payload.scp),
    };
  }
  code(code: string, verifier: string) {
    return this.exchange({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: CALLBACK,
    });
  }
  refresh(refreshToken: string) {
    return this.exchange({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  }
}
export class TokenManager {
  private flights = new Map<string, Promise<TokenRecord>>();
  constructor(
    private vault: Vault,
    private refresh: (token: string) => Promise<TokenRecord>,
    private clock: () => number = Date.now,
  ) {}
  async access(id: string) {
    const existing = this.flights.get(id);
    if (existing) return (await existing).accessToken;
    const promise = (async () => {
      const record = await this.vault.read(id);
      if (!record) throw Error("Персонаж не подключён");
      if (record.expiresAt > this.clock() + 60000) return record;
      const updated = await this.refresh(record.refreshToken);
      if (updated.characterId !== id)
        throw Error("SSO вернул другого персонажа");
      await this.vault.write(updated);
      return updated;
    })();
    this.flights.set(id, promise);
    try {
      return (await promise).accessToken;
    } finally {
      this.flights.delete(id);
    }
  }
}
