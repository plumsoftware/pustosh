import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import { ctx, registry } from '../GameContext';
import { SceneKeys } from '../SceneKeys';
import { COLORS, uiScale } from '../ui/layout';
import { iconButton, panel, titleText, uiText } from '../ui/Styled';
import type { WorldScene } from './WorldScene';

/** Причины смерти в порядке вывода (stats.death_<причина>). */
const DEATH_CAUSES = ['enemy', 'boss', 'hunger', 'cold', 'heat', 'radiation', 'poison', 'bleeding'];

/**
 * Статистика игры (как «журнал выжившего» в Don't Starve / 7 Days to Die): выживание, бой, добыча,
 * стройка, путешествия, причины смертей. Числа — progress.stats в сохранении. Открывается из паузы.
 */
export class StatsScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Stats);
  }

  private get world(): WorldScene {
    return this.scene.get(SceneKeys.World) as WorldScene;
  }

  create(): void {
    ctx().clock.pause('DIALOG');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => ctx().clock.resume('DIALOG'));
    const k = uiScale(this);
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x000000, 0.6).setOrigin(0).setInteractive();
    const pw = Math.min(width - 16, 1180 * k);
    const ph = height - 16;
    const px = (width - pw) / 2;
    const py = 8;
    panel(this, px + pw / 2, py + ph / 2, pw, ph);
    titleText(this, px + pw / 2, py + 10, t('stats.title'), Math.max(22, 26 * k)).setOrigin(0.5, 0);
    iconButton(this, px + pw - 26, py + 26, 'ui.btn_close', Math.max(36, 40 * k), () => this.scene.stop());
    this.input.keyboard?.on('keydown-ESC', () => this.scene.stop());

    const g = this.world.progress;
    const s = g.stats;
    const n = (key: string) => Math.floor(s[key] ?? 0);
    const fmt = (v: number) => v.toLocaleString('ru-RU');
    const day = registry().balance.dayNight.fullDaySec;
    const hours = n('playSec') / 3600;
    const time =
      hours >= 1
        ? t('stats.hm', { h: Math.floor(hours), m: Math.floor((hours % 1) * 60) })
        : t('stats.m', { m: Math.floor(n('playSec') / 60) });
    const w = this.world.world;
    const explored = Math.round((100 * g.map.visited.length) / (w.chunksPerSide * w.chunksPerSide));
    const days = (v: number) => t('stats.days', { n: (Math.round(v * 10) / 10).toLocaleString('ru-RU') });
    const sections: [string, [string, string][]][] = [
      [
        'stats.sec.survival',
        [
          ['stats.day', String(Math.max(n('maxDay'), this.world.dayState.day))],
          ['stats.life', days((this.world.dayNight.seconds - (s['lifeStartSec'] ?? 0)) / day)],
          [
            'stats.best_life',
            days(
              Math.max(
                s['bestLifeDays'] ?? 0,
                (this.world.dayNight.seconds - (s['lifeStartSec'] ?? 0)) / day,
              ),
            ),
          ],
          ['stats.deaths', fmt(n('deaths'))],
          ['stats.blood_nights', fmt(n('bloodNights'))],
          ['stats.time', time],
        ],
      ],
      [
        'stats.sec.combat',
        [
          ['stats.kills', fmt(n('kills'))],
          ['stats.kills_infected', fmt(n('kills_infected'))],
          ['stats.kills_beasts', fmt(n('kills_mutant') + n('kills_reptile'))],
          ['stats.kills_animal', fmt(n('kills_animal'))],
          ['stats.kills_elite', fmt(n('kills_elite'))],
          ['stats.kills_night', fmt(n('kills_night'))],
          ['stats.bosses', `${g.bosses.size} / ${registry().bosses.all.length}`],
          ['stats.dmg_dealt', fmt(n('damageDealt'))],
          ['stats.dmg_taken', fmt(n('damageTaken'))],
        ],
      ],
      [
        'stats.sec.gather',
        [
          ['stats.gathered', fmt(n('gathered'))],
          ['stats.trees', fmt(n('trees'))],
          ['stats.rocks', fmt(n('rocks'))],
          ['stats.fish', fmt(n('fish'))],
          ['stats.containers', fmt(n('containers'))],
          ['stats.crafted', fmt(n('crafted'))],
          ['stats.built', fmt(n('built') + n('placed'))],
        ],
      ],
      [
        'stats.sec.travel',
        [
          [
            'stats.walked',
            t('stats.km', { n: (n('walked') / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) }),
          ],
          [
            'stats.driven',
            t('stats.km', { n: (n('driven') / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) }),
          ],
          ['stats.explored', `${explored}%`],
          ['stats.places', fmt(g.poiSet.size)],
          ['stats.pins', fmt(g.pins.length)],
        ],
      ],
    ];
    // Причины смертей — если умирали.
    const causes = DEATH_CAUSES.filter((c) => n(`death_${c}`) > 0).map(
      (c) => [`stats.death.${c}`, fmt(n(`death_${c}`))] as [string, string],
    );
    if (causes.length) sections.push(['stats.sec.deaths', causes]);

    // Три колонки: выживание + путешествия | бой | добыча + причины смертей.
    const cols: [string, [string, string][]][][] = [
      [sections[0]!, sections[3]!],
      [sections[1]!],
      [sections[2]!, ...(sections[4] ? [sections[4]] : [])],
    ];
    const top = py + Math.max(48, 54 * k);
    const cw = (pw - 40) / 3;
    const rows = Math.max(...cols.map((c) => c.reduce((a, [, r]) => a + r.length + 1.4, 0)));
    const rh = Math.min(26, (py + ph - 14 - top) / rows);
    const fs = Math.max(13, Math.min(16, rh * 0.62));
    cols.forEach((col, ci) => {
      const x = px + 20 + ci * cw;
      let y = top;
      for (const [head, list] of col) {
        uiText(this, x, y, t(head), fs + 2, { color: '#f0c070' });
        y += rh * 1.3;
        for (const [label, value] of list) {
          uiText(this, x + 6, y, t(label), fs, { color: COLORS.textDim });
          uiText(this, x + cw - 18, y, value, fs, { color: COLORS.text }).setOrigin(1, 0);
          y += rh;
        }
        y += rh * 0.3;
      }
    });
  }
}
