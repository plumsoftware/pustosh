import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import { freePoints, skillDef, xpToNext } from '../../core/systems/Progress';
import { getAssetInfo } from '../assets/AssetIndex';
import { spawnSprite } from '../assets/spawnSprite';
import { ctx, registry } from '../GameContext';
import { SceneKeys } from '../SceneKeys';
import { rowFrame } from '../ui/Styled';
import { panel as stylePanel } from '../ui/Styled';
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
    this.root.add(stylePanel(this, px + pw / 2, py + ph / 2, pw, ph));
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
        const bg = rowFrame(this, cx, y, colW - 8 * k, rowH - 4 * k, sel)
          .setOrigin(0)
          .setInteractive({ useHandCursor: true });
        bg.on('pointerup', () => {
          this.selected = sk.id;
          this.build();
        });
        const art = `ui.skills.skill_${sk.id}`;
        const hasArt = !!getAssetInfo(art);
        // Иконка навыка (s25) почти во всю высоту строки; кружок с буквой — меньше.
        const r = hasArt ? rowH * 0.42 : Math.min(rowH * 0.36, 16 * k);
        const ix = cx + 6 * k + r;
        const iy = y + rowH / 2 - 2 * k;
        let icon: Phaser.GameObjects.GameObject & { x: number; y: number };
        let letter: Phaser.GameObjects.GameObject | null = null;
        if (hasArt) {
          // Иконка навыка (s25); не изученный — приглушённый.
          const im = spawnSprite(this, ix, iy, art, { depth: false });
          im.setScale((r * 2) / Math.max(im.frame.width, im.frame.height));
          if (!lvl) im.setTint(0xa0a0a0).setAlpha(0.8);
          icon = im;
        } else {
          icon = this.add.circle(ix, iy, r, color, lvl ? 1 : 0.35).setStrokeStyle(1, 0x000000);
          letter = this.txt(ix, iy, (sk.name_ru as string)[0]!, 12, '#fff', true).setOrigin(0.5);
        }
        // Название — одной строкой в верхней половине (длинное уменьшается по ширине), уровни — ниже.
        const tx = icon.x + r + 6 * k;
        const tw = cx + colW - 8 * k - tx - 12 * k;
        const rowIn = rowH - 4 * k;
        const name = this.txt(
          tx,
          y + rowIn * 0.32,
          sk.name_ru as string,
          13,
          lvl ? COLORS.text : COLORS.textDim,
          true,
        ).setOrigin(0, 0.5);
        // Длинное название — две строки по центру карточки, уровни — справа.
        // Чуть длиннее — немного ужать; намного длиннее — две строки, уровни справа.
        if (name.width > tw && name.width <= tw * 1.18) name.setScale(tw / name.width);
        const long = name.width > tw * 1.18;
        if (long) name.setWordWrapWidth(tw * 0.72).setY(y + rowIn * 0.5);
        const dots = this.txt(
          tx,
          y + rowIn * 0.74,
          '●'.repeat(lvl) + '○'.repeat(Math.max(0, max - lvl)),
          10,
          '#e0c060',
        ).setOrigin(0, 0.5);
        if (long) dots.setOrigin(1, 0.5).setPosition(tx + tw + 4 * k, y + rowIn * 0.5);
        this.root.add([bg, icon, name, dots]);
        if (letter) this.root.add(letter);
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
