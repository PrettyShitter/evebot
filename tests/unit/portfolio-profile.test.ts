import { describe, expect, it } from "vitest";
import { EsiClient } from "../../engine/esi/client";
import { fetchProfile } from "../../engine/portfolio/profile";

describe("fetchProfile", () => {
  it("maps ESI race_id when public character info omits the UI race name", async () => {
    const bodies: Record<string, unknown> = {
      "/characters/9001": { race_id: 1 },
      "/characters/9001/skills": { skills: [] },
      "/characters/9001/standings": [],
      "/characters/9001/skillqueue": [],
    };
    const client = new EsiClient(async (input) => {
      const path = new URL(String(input)).pathname;
      return new Response(JSON.stringify(bodies[path]), {
        status: 200,
        headers: { "Cache-Control": "max-age=60" },
      });
    });

    const profile = await fetchProfile(client, "9001", "test-token");

    expect(profile.race).toBe("Amarr");
    expect(profile.skills).toEqual([]);
    expect(profile.standings).toEqual([]);
    expect(profile.queue).toEqual([]);
  });
});
