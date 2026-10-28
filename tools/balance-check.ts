/**
 * Проверка баланса урона (TZ 8.5): сколько ударов/выстрелов оружием тира биома нужно на врагов биома
 * (обычных и элиту). Цель: обычный — 3–6, элита — 8–12. Пишет docs/BALANCE_CHECK.md.
 * Запуск: npm run balance-check
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadGameData } from '../src/core/data';
import { weaponStats } from '../src/core/systems/Combat';
import { makeStack } from '../src/core/inventory';
import { readAssetCatalog, readRawData, ROOT } from './readGameFiles';

const reg = loadGameData(readRawData(), readAssetCatalog()).registry!;
const weapons = reg.items.all.filter((i) => i.category === 'weapon' && i['weaponKind'] !== 'throwable');
const hits = (dmg: number, hp: number) => Math.ceil(hp / Math.max(0.01, dmg));
const mark = (n: number, lo: number, hi: number) => (n < lo ? `${n} ⬇` : n > hi ? `${n} ⬆` : `${n}`);

const lines: string[] = [
  '# Проверка баланса урона (шаг 8)',
  '',
  'Сгенерировано `npm run balance-check` из `items.json`, `enemies.json`, `biomes.json`, `combat.json`.',
  'Цель ТЗ 8.5: врага своего биома обычным оружием тира биома убивать за **3–6** ударов, элиту — за **8–12**.',
  'В клетках — число ударов (выстрелов; у дроби — залпов, все дробины попали). ⬇ — быстрее цели, ⬆ — дольше.',
  'Броня врагов (солдат спереди −50% в ближнем бою, броненосец спереди −80%) и удар в спину не учтены — это тактика.',
  '',
];
let out = 0;
let total = 0;
for (const b of reg.biomes.all) {
  const tier = b.id;
  const ws = weapons.filter((w) => w.tier === tier || (tier === 6 && w.tier >= 5));
  const enemies = b.enemies.map((id) => reg.enemies.require(id)).filter((e) => e.family !== 'animal');
  if (!ws.length || !enemies.length) continue;
  lines.push(`## Биом ${b.id}. ${b.name_ru} — оружие тира ${tier}`, '');
  lines.push(`| Оружие | урон | ${enemies.map((e) => `${e.name_ru} (${e.hp})`).join(' | ')} |`);
  lines.push(`|---|---|${enemies.map(() => '---').join('|')}|`);
  for (const w of ws) {
    const st = weaponStats(reg, makeStack(reg, w.id, 1));
    const dmg = st.damage * st.pellets;
    const cells = enemies.map((e) => {
      const n = hits(dmg, e.hp);
      const el = hits(dmg, e.hp * (e.elite?.hpMul ?? 1.5));
      total += 2;
      if (n < 3 || n > 6) out++;
      if (el < 8 || el > 12) out++;
      return `${mark(n, 3, 6)} / эл. ${mark(el, 8, 12)}`;
    });
    lines.push(`| ${w.name_ru} | ${Math.round(dmg)} | ${cells.join(' | ')} |`);
  }
  lines.push('');
}
lines.push('## Итог', '');
lines.push(
  `Вне цели: ${out} из ${total} пар «оружие — враг». Элита ×1.5 HP при цели 8–12 против 3–6 у обычных недостижима одновременно (×1.5 от 3–6 = 5–9): либо поднять elite.hpMul до ~2.2, либо принять 5–9 для элиты. Решение — за владельцем, числа в данных не менялись.`,
);
writeFileSync(join(ROOT, 'docs/BALANCE_CHECK.md'), lines.join('\n') + '\n');
console.log(`docs/BALANCE_CHECK.md: вне цели ${out} из ${total}`);
