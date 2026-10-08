import { describe, expect, it } from "vitest";
import { effectiveAlphaSkills, manufacturingJobSlots, missingManufacturingSkills } from "../../engine/production/skills";
import type { StaticData } from "../../engine/market/static-data";

const data = {
  types: [
    { id: "3387", englishName: "Mass Production" },
    { id: "24625", englishName: "Advanced Mass Production" },
  ],
  alphaSkillCaps: { Amarr: { "3387": 3 } },
} as unknown as StaticData;

describe("manufacturing job slot skills", () => {
  it("uses the active Alpha-capped level and the base manufacturing slot", () => {
    const skills = effectiveAlphaSkills({
      race: "Amarr",
      skills: [
        { skill_id: "3387", trained_skill_level: 5, active_skill_level: 5 },
        { skill_id: "24625", trained_skill_level: 5, active_skill_level: 5 },
      ],
    }, data);
    expect(skills.map((skill) => skill.usableLevel)).toEqual([3, 0]);
    expect(manufacturingJobSlots(skills, data)).toBe(4);
  });

  it("uses active level rather than trained level and blocks Omega-only recipe requirements", () => {
    const skills = effectiveAlphaSkills({
      race: "Amarr",
      skills: [
        { skill_id: "3387", trained_skill_level: 5, active_skill_level: 3 },
        { skill_id: "24625", trained_skill_level: 5, active_skill_level: 5 },
      ],
    }, data);

    expect(skills.map((skill) => ({ trained: skill.trainedLevel, active: skill.activeLevel, usable: skill.usableLevel }))).toEqual([
      { trained: 5, active: 3, usable: 3 },
      { trained: 5, active: 5, usable: 0 },
    ]);
    expect(missingManufacturingSkills([
      { typeId: "3387", level: 3 },
      { typeId: "24625", level: 1 },
    ], skills)).toEqual([{ typeId: "24625", level: 1 }]);
  });

  it("falls back to the base slot when no skill profile exists", () => {
    expect(manufacturingJobSlots([], data)).toBe(1);
  });
});
