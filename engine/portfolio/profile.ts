import { z } from "zod";
import { EsiClient } from "../esi/client";
import type { SellerProfile } from "../market/fees";
import type { Station } from "../market/static-data";
const int = z.coerce.number().int();
const skillsSchema = z.object({
  skills: z.array(
    z.object({
      skill_id: z.string(),
      active_skill_level: int,
      trained_skill_level: int,
    }),
  ),
});
const queueSchema = z.array(
  z.object({
    skill_id: z.string(),
    finished_level: int,
    finish_date: z.iso.datetime().optional(),
  }),
);
const standingsSchema = z.array(
  z.object({
    from_id: z.string(),
    from_type: z.string(),
    standing: z.string(),
  }),
);
export interface ProfileData {
  skills: z.infer<typeof skillsSchema>["skills"];
  standings: z.infer<typeof standingsSchema>;
  queue: z.infer<typeof queueSchema>;
  at: string;
}
export async function fetchProfile(
  client: EsiClient,
  id: string,
  token: string,
): Promise<ProfileData> {
  const skills = skillsSchema.parse(
    (await client.get(`/characters/${id}/skills`, token, id)).body,
  ).skills;
  const standings = standingsSchema.parse(
    (await client.get(`/characters/${id}/standings`, token, id)).body,
  );
  const queue = queueSchema.parse(
    (await client.get(`/characters/${id}/skillqueue`, token, id)).body,
  );
  return { skills, standings, queue, at: new Date().toISOString() };
}
export function stationProfile(
  data: ProfileData,
  station: Station,
): SellerProfile | null {
  const skill = (id: string) => {
    const row = data.skills.find((s) => s.skill_id === id);
    const completed = data.queue
      .filter(
        (q) => q.skill_id === id && q.finish_date && q.finish_date <= data.at,
      )
      .reduce((n, q) => Math.max(n, q.finished_level), 0);
    if (completed > (row?.trained_skill_level ?? 0)) return null;
    return row?.active_skill_level ?? 0;
  };
  const accounting = skill("16622"),
    brokerRelations = skill("3446"),
    advancedBrokerRelations = skill("16597");
  if (
    accounting === null ||
    brokerRelations === null ||
    advancedBrokerRelations === null
  )
    return null;
  return {
    accounting,
    brokerRelations,
    advancedBrokerRelations,
    corporationStanding:
      data.standings.find(
        (s) => s.from_type === "npc_corp" && s.from_id === station.ownerId,
      )?.standing ?? "0",
    factionStanding:
      data.standings.find(
        (s) => s.from_type === "faction" && s.from_id === station.factionId,
      )?.standing ?? "0",
  };
}
