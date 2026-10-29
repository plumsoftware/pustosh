/**
 * Проверка баланса урона (TZ 8.5): сколько ударов/выстрелов оружием тира биома нужно на врагов биома
 * (обычных и элиту). Цель: обычный — 3–6, элита — 8–12. Пишет docs/BALANCE_CHECK.md.
 * Запуск: npm run balance-check
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadGameData } from '../src/core/data';
import { enemyMaxHp } from '../src/core/entities/Enemy';
import { weaponStats } from '../src/core/systems/Combat';
import { makeStack } from '../src/core/inventory';
import { readAssetCatalog, readRawData, ROOT } from './readGameFiles';

const reg = loadGameData(readRawData(), readAssetCatalog()).registry!;
// Огнемёт бьёт потоком (урон в секунду), метательное — по площади: в таблицу ударов не входят.
const weapons = reg.items.all.filter(
  (i) => i.category === 'weapon' && i['weaponKind'] !== 'throwable' && i['weaponKind'] !== 'flame',
);
const hits = (dmg: number, hp: number) => Math.ceil(hp / Math.max(0.01, dmg));
const mark = (n: number, lo: number, hi: number) => (n < lo ? `${n} ⬇` : n > hi ? `${n} ⬆` : `${n}`);

const lines: string[] = [
  '# Проверка баланса урона',
  '',
  'Сгенерировано `npm run balance-check` из `items.json`, `enemies.json`, `biomes.json`, `combat.json`.',
  'Цель ТЗ 8.5: врага своего биома обычным оружием тира биома убивать за **3–6** ударов, элиту — за **8–12**.',
  'В клетках — число ударов (выстрелов; у дроби — залпов, все дробины попали). ⬇ — быстрее цели, ⬆ — дольше.',
  'Броня врагов (солдат спереди −50% в ближнем бою, броненосец спереди −80%) и удар в спину не учтены — это тактика.',
  'HP врага — `combat.json → enemyHp`: toughness × byBiome[биом], элита × eliteHpMul (один и тот же враг крепче в дальних биомах).',
  '',
];
let out = 0;
let total = 0;
for (const b of reg.biomes.all) {
  const tier = b.id;
  const ws = weapons.filter((w) => w.tier === tier);
  const enemies = b.enemies.map((id) => reg.enemies.require(id)).filter((e) => e.family !== 'animal');
  if (!ws.length || !enemies.length) continue;
  lines.push(`## Биом ${b.id}. ${b.name_ru} — оружие тира ${tier}`, '');
  lines.push(
    `| Оружие | урон | ${enemies.map((e) => `${e.name_ru} (${enemyMaxHp(reg, e, b.id, false)})`).join(' | ')} |`,
  );
  lines.push(`|---|---|${enemies.map(() => '---').join('|')}|`);
  for (const w of ws) {
    const st = weaponStats(reg, makeStack(reg, w.id, 1));
    const dmg = st.damage * st.pellets;
    const cells = enemies.map((e) => {
      const n = hits(dmg, enemyMaxHp(reg, e, b.id, false));
      const el = hits(dmg, enemyMaxHp(reg, e, b.id, true));
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
lines.push(`Вне цели: ${out} из ${total} пар «оружие — враг».`);
writeFileSync(join(ROOT, 'docs/BALANCE_CHECK.md'), lines.join('\n') + '\n');
console.log(`docs/BALANCE_CHECK.md: вне цели ${out} из ${total}`);
