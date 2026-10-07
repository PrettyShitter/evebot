import type { ProductionSkillRequirement, StaticData } from "../market/static-data";
import type { ProfileData } from "../portfolio/profile";

export interface EffectiveSkill {
  typeId: string;
  trainedLevel: number;
  activeLevel: number;
  alphaCap: number;
  usableLevel: number;
}

/** Resolve current skill capability for the tab's explicit Alpha profile. */
export function effectiveAlphaSkills(
  profile: Pick<ProfileData, "race" | "skills">,
  data: StaticData,
): EffectiveSkill[] {
  const caps = profile.race ? data.alphaSkillCaps?.[profile.race] : undefined;
  return profile.skills.map((skill) => {
    const trainedLevel = Math.max(0, Math.min(5, skill.trained_skill_level));
    const activeLevel = Math.max(
      0,
      Math.min(trainedLevel, 5, skill.active_skill_level),
    );
    const alphaCap = caps?.[skill.skill_id] ?? 0;
    return {
      typeId: skill.skill_id,
      trainedLevel,
      activeLevel,
      alphaCap,
      usableLevel: Math.min(activeLevel, alphaCap),
    };
  });
}

export function missingManufacturingSkills(
  requirements: ProductionSkillRequirement[],
  skills: EffectiveSkill[],
): ProductionSkillRequirement[] {
  const levels = new Map(skills.map((skill) => [skill.typeId, skill.usableLevel]));
  return requirements.filter((requirement) => (levels.get(requirement.typeId) ?? 0) < requirement.level);
}

/** EVE grants one manufacturing job plus the two production skill bonuses. */
export function manufacturingJobSlots(
  skills: EffectiveSkill[],
  data: StaticData,
): number {
  const levels = new Map(skills.map((skill) => [skill.typeId, skill.usableLevel]));
  const levelByName = (name: string) => {
    const skill = data.types.find((type) => type.englishName === name);
    return skill ? levels.get(skill.id) ?? 0 : 0;
  };
  return 1 + levelByName("Mass Production") + levelByName("Advanced Mass Production");
}
