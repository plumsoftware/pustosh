import type { Registry } from '../data/Registry';

/** Уровни навыков: id навыка → 0…levels. */
export type SkillLevels = Record<string, number>;

/** Опыт до следующего уровня: 60 × level^1.45, округлить до 5 (skills.json → xpCurve). */
export function xpToNext(level: number): number {
  return Math.round((60 * Math.pow(level, 1.45)) / 5) * 5;
}

export interface LevelState {
  level: number;
  xp: number;
  skills: SkillLevels;
}

/** Добавить опыт; возвращает, сколько уровней получено (максимум skills.maxLevel). */
export function addXp(reg: Registry, s: LevelState, n: number): number {
  const max = reg.skills.maxLevel as number;
  if (n <= 0 || s.level >= max) return 0;
  s.xp += n;
  let gained = 0;
  while (s.level < max && s.xp >= xpToNext(s.level)) {
    s.xp -= xpToNext(s.level);
    s.level++;
    gained++;
  }
  if (s.level >= max) s.xp = 0;
  return gained;
}

export function skillDef(
  reg: Registry,
  id: string,
): { id: string; name_ru: string; levels: number; perLevel: string; branch: string } | null {
  for (const b of reg.skills.branches)
    for (const sk of b.skills)
      if (sk.id === id)
        return { ...sk, levels: sk.levels as number, perLevel: String(sk['perLevel'] ?? ''), branch: b.id };
  return null;
}

/** Очков навыков всего: (уровень − 1) × pointsPerLevel; свободных — минус потраченные. */
export function freePoints(reg: Registry, s: LevelState): number {
  const spent = Object.values(s.skills).reduce((a, b) => a + b, 0);
  return (s.level - 1) * ((reg.skills.pointsPerLevel as number) ?? 1) - spent;
}

/** Вложить очко в навык. */
export function learn(reg: Registry, s: LevelState, id: string): boolean {
  const d = skillDef(reg, id);
  if (!d || freePoints(reg, s) <= 0 || (s.skills[id] ?? 0) >= d.levels) return false;
  s.skills[id] = (s.skills[id] ?? 0) + 1;
  return true;
}

/** Очки в ветке (requiresSkill «engineer_2» = 2 очка в ветке Инженер — skills.json → note). */
export function branchPoints(reg: Registry, skills: Readonly<SkillLevels>, branch: string): number {
  const b = reg.skills.branches.find((x) => x.id === branch);
  return b ? b.skills.reduce((a, sk) => a + (skills[sk.id] ?? 0), 0) : 0;
}

/**
 * Суммарный эффект навыков по ключу (progression.json → skillEffects): число × уровень,
 * массив — значение для достигнутого уровня (Жадность 20/35/50%).
 */
export function skillEffect(reg: Registry, skills: Readonly<SkillLevels>, key: string): number {
  let n = 0;
  for (const [id, lvl] of Object.entries(skills)) {
    if (!lvl) continue;
    const v = reg.prog.skillEffects[id]?.[key];
    if (typeof v === 'number') n += v * lvl;
    else if (Array.isArray(v)) n += v[Math.min(v.length, lvl) - 1] ?? 0;
  }
  return n;
}
