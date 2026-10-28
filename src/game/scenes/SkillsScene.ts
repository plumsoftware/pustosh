import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import { freePoints, skillDef, xpToNext } from '../../core/systems/Progress';
import { getAssetInfo } from '../assets/AssetIndex';
import { ctx, registry } from '../GameContext';
import { SceneKeys } from '../SceneKeys';
import { Button } from '../ui/Button';
import { COLORS, FONT, TEXT_RES, uiScale } from '../ui/layout';
import type { WorldScene } from './WorldScene';

const BRANCH_COLORS: Record<string, number> = {
  fighter: 0xc04030,
  gatherer: 0x6a9a30,
  engineer: 0xc08a30,
  survivor: 0x3a7ab0,
};
const PANEL_MS = 180;

/**
 * Навыки (TZ 9.1.2): 4 ветки × 6 навыков × 3 уровня. Иконка — круг цвета ветки с первой буквой
 * (иконок навыков в ассетах нет — ASSET_REQUESTS.md). Тап — описание, «Изучить» — вложить очко.
 */
export class SkillsScene extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private selected: string | null = null;

  constructor() {
    super(SceneKeys.Skills);
  }

  private get world(): WorldScene {
    return this.scene.get(SceneKeys.World) as WorldScene;
  }

  create(): void {
    ctx().clock.pause('DIALOG');
    this.world.controls.enabled = false;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      ctx().clock.resume('DIALOG');
      this.world.controls.clear();
      this.world.controls.enabled = true;
    });
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x000000, 0.6).setOrigin(0).setInteractive();
    this.root = this.add.container(0, 0);
    this.build();
    this.root
      .setScale(0.9)
      .setAlpha(0)
      .setPosition(width * 0.05, height * 0.05);
    this.tweens.add({
      targets: this.root,
      scale: 1,
      alpha: 1,
      x: 0,
      y: 0,
      duration: PANEL_MS,
      ease: 'Quad.Out',
    });
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyK') this.scene.stop();
    });
  }

  private txt(
    x: number,
    y: number,
    s: string,
    size: number,
    color = COLORS.text,
    bold = false,
    wrap?: number,
  ) {
    const k = uiScale(this);
    return this.add.text(x, y, s, {
      fontFamily: FONT,
      resolution: TEXT_RES,
      fontSize: `${Math.round(size * k + 2)}px`,
      color,
      fontStyle: bold ? '700' : '400',
      wordWrap: wrap ? { width: wrap } : undefined,
    });
  }

  private build(): void {
    this.root.removeAll(true);
    const reg = registry();
    const k = uiScale(this);
    const g = this.world.progress;
    const { width, height } = this.scale;
    const pw = Math.min(width - 20, 1180 * k);
    const ph = height - 20;
    const px = (width - pw) / 2;
    const py = 10;
    const info = getAssetInfo('ui.panel_9slice')!;
    this.root.add(
      this.add.nineslice(px + pw / 2, py + ph / 2, info.group, info.frame, pw, ph, 22, 22, 22, 22),
    );
    const lv = g.lv;
    const pts = freePoints(reg, lv);
    this.root.add(
      this.txt(
        px + 20 * k,
        py + 14 * k,
        t('skills.title', { lvl: lv.level, xp: lv.xp, next: xpToNext(lv.level), pts }),
        17,
        COLORS.text,
        true,
      ),
    );
    const close = new Button(
      this,
      px + pw - 34 * k,
      py + 30 * k,
      '✕',
      () => this.scene.stop(),
      44 * k,
      44 * k,
    );
    this.root.add(close);
    const top = py + 52 * k;
    const footer = 64 * k;
    const colW = (pw - 30 * k) / reg.skills.branches.length;
    const rowH = (ph - (top - py) - footer - 20 * k) / 7;
    reg.skills.branches.forEach((b, bi) => {
      const cx = px + 15 * k + bi * colW;
      const color = BRANCH_COLORS[b.id] ?? 0x888888;
      this.root.add(
        this.txt(cx + 6 * k, top, b.name_ru as string, 14, '#' + color.toString(16).padStart(6, '0'), true),
      );
      b.skills.forEach((sk, si) => {
        const y = top + (si + 1) * rowH;
        const lvl = lv.skills[sk.id] ?? 0;
        const max = sk.levels as number;
        const sel = this.selected === sk.id;
        const bg = this.add
          .rectangle(cx, y, colW - 8 * k, rowH - 4 * k, sel ? 0x3a3024 : 0x1d1a16, 0.9)
          .setOrigin(0)
          .setStrokeStyle(sel ? 2 : 1, sel ? 0xe0a040 : 0x5a4a35)
          .setInteractive({ useHandCursor: true });
        bg.on('pointerup', () => {
          this.selected = sk.id;
          this.build();
        });
        const r = Math.min(rowH * 0.36, 16 * k);
        const icon = this.add
          .circle(cx + 6 * k + r, y + rowH / 2 - 2 * k, r, color, lvl ? 1 : 0.35)
          .setStrokeStyle(1, 0x000000);
        const letter = this.txt(icon.x, icon.y, (sk.name_ru as string)[0]!, 12, '#fff', true).setOrigin(0.5);
        const name = this.txt(
          icon.x + r + 6 * k,
          y + 3 * k,
          sk.name_ru as string,
          11,
          lvl ? COLORS.text : COLORS.textDim,
          true,
          colW - r * 2 - 22 * k,
        );
        const dots = this.txt(
          icon.x + r + 6 * k,
          y + rowH - 18 * k,
          '●'.repeat(lvl) + '○'.repeat(Math.max(0, max - lvl)),
          10,
          '#e0c060',
        );
        this.root.add([bg, icon, letter, name, dots]);
      });
    });
    // Подвал: описание выбранного навыка и «Изучить».
    const fy = py + ph - footer - 6 * k;
    const d = this.selected ? skillDef(reg, this.selected) : null;
    if (d) {
      const lvl = lv.skills[d.id] ?? 0;
      this.root.add(
        this.txt(
          px + 20 * k,
          fy + 6 * k,
          `${d.name_ru} (${lvl}/${d.levels}): ${d.perLevel}`,
          13,
          COLORS.text,
          false,
          pw - 300 * k,
        ),
      );
      const can = pts > 0 && lvl < d.levels;
      const b = new Button(
        this,
        px + pw - 140 * k,
        fy + footer / 2,
        t('skills.learn'),
        () => {
          if (g.learn(d.id)) this.build();
        },
        220 * k,
        44 * k,
      );
      if (!can) b.setAlpha(0.45).disableInteractive();
      this.root.add(b);
    } else this.root.add(this.txt(px + 20 * k, fy + 10 * k, t('skills.hint'), 13, COLORS.textDim));
  }
}
