import { it, expect } from "vitest";
import {
  pkce,
  TokenManager,
  type TokenRecord,
  type Vault,
} from "../../engine/auth/tokens";
import { createHash } from "node:crypto";
it("PKCE uses cryptographic unique state and S256 of verifier string", () => {
  const a = pkce(),
    b = pkce();
  expect(a.state).not.toBe(b.state);
  expect(a.verifier.length).toBeGreaterThanOrEqual(43);
  expect(a.challenge).toBe(
    createHash("sha256").update(a.verifier).digest("base64url"),
  );
});
it("three token lifecycles are isolated, refresh is single-flight, revoked access does not erase others", async () => {
  const data = new Map<string, TokenRecord>(
    ["1", "2", "3"].map((id) => [
      id,
      {
        characterId: id,
        name: id,
        refreshToken: "refresh-" + id,
        accessToken: "old-" + id,
        expiresAt: 0,
        scopes: [],
      },
    ]),
  );
  let calls = 0;
  const vault: Vault = {
    read: async (id) => data.get(id) ?? null,
    write: async (r) => {
      data.set(r.characterId, r);
    },
    remove: async (id) => {
      data.delete(id);
    },
  };
  const manager = new TokenManager(
    vault,
    async (token) => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      const id = token.split("-")[1];
      if (id === "3") throw Error("revoked");
      return { ...data.get(id)!, accessToken: "new-" + id, expiresAt: 999999 };
    },
    () => 100,
  );
  expect(
    await Promise.all([
      manager.access("1"),
      manager.access("1"),
      manager.access("2"),
    ]),
  ).toEqual(["new-1", "new-1", "new-2"]);
  expect(calls).toBe(2);
  await expect(manager.access("3")).rejects.toThrow("revoked");
  expect(await manager.access("1")).toBe("new-1");
  expect(data.has("3")).toBe(true);
});
