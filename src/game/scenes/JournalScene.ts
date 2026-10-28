import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import { getAssetInfo } from '../assets/AssetIndex';
import { spawnSprite } from '../assets/spawnSprite';
import { ctx, registry } from '../GameContext';
import { SceneKeys } from '../SceneKeys';
import { Button } from '../ui/Button';
import { COLORS, FONT, TEXT_RES, uiScale } from '../ui/layout';
import type { WorldScene } from './WorldScene';

/** Журнал (TZ 9.3.3): ежедневные задания (награда, «+1 задание» за рекламу extra_daily) и записки. */
export class JournalScene extends Phaser.Scene {
  private tab: 'quests' | 'notes' = 'quests';
  private note: string | null = null;
  private root!: Phaser.GameObjects.Container;

  constructor() {
    super(SceneKeys.Journal);
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
    this.tweens.add({ targets: this.root, scale: 1, alpha: 1, x: 0, y: 0, duration: 180, ease: 'Quad.Out' });
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyJ') this.scene.stop();
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
      lineSpacing: 3,
    });
  }

  private build(): void {
    this.root.removeAll(true);
    const reg = registry();
    const k = uiScale(this);
    const g = this.world.progress;
    const { width, height } = this.scale;
    const pw = Math.min(width - 20, 1100 * k);
    const ph = height - 20;
    const px = (width - pw) / 2;
    const py = 10;
    const info = getAssetInfo('ui.panel_9slice')!;
    this.root.add(
      this.add.nineslice(px + pw / 2, py + ph / 2, info.group, info.frame, pw, ph, 22, 22, 22, 22),
    );
    const bh = 40 * k;
    (['quests', 'notes'] as const).forEach((tab, i) => {
      const b = new Button(
        this,
        px + 110 * k + i * 210 * k,
        py + 30 * k,
        t(`journal.${tab}`),
        () => {
          this.tab = tab;
          this.note = null;
          this.build();
        },
        200 * k,
        bh,
      );
      if (this.tab !== tab) b.setAlpha(0.6);
      this.root.add(b);
    });
    this.root.add(
      new Button(this, px + pw - 34 * k, py + 30 * k, '✕', () => this.scene.stop(), 44 * k, 44 * k),
    );
    const top = py + 62 * k;
    if (this.tab === 'quests') {
      this.root.add(this.txt(px + 24 * k, top, t('journal.daily'), 15, COLORS.textDim, true));
      g.quests.daily.forEach((task, i) => {
        const y = top + 30 * k + i * (52 * k);
        const done = task.done >= task.n;
        const bg = this.add
          .rectangle(px + 20 * k, y, pw - 40 * k, 46 * k, 0x1d1a16, 0.9)
          .setOrigin(0)
          .setStrokeStyle(1, done ? 0x8fd46a : 0x5a4a35);
        const name = this.txt(
          px + 34 * k,
          y + 6 * k,
          g.taskName(task),
          14,
          done ? '#8fd46a' : COLORS.text,
          true,
        );
        const prog = this.txt(
          px + 34 * k,
          y + 26 * k,
          `${task.done}/${task.n} · ${t('journal.reward')}: ${reg.items.get(task.reward.id)?.name_ru ?? task.reward.id} ×${task.reward.count}`,
          12,
          COLORS.textDim,
        );
        this.root.add([bg, name, prog]);
        const icon = reg.items.get(task.reward.id)?.icon;
        if (icon && getAssetInfo(icon)) {
          const ic = spawnSprite(this, px + pw - 200 * k, y + 23 * k, icon, { depth: false }).setOrigin(0.5);
          ic.setScale((34 * k) / Math.max(ic.frame.width, ic.frame.height));
          this.root.add(ic);
        }
        if (done && !task.claimed) {
          this.root.add(
            new Button(
              this,
              px + pw - 100 * k,
              y + 23 * k,
              t('journal.claim'),
              () => {
                g.claim(task);
                this.build();
              },
              140 * k,
              34 * k,
            ),
          );
        } else if (task.claimed)
          this.root.add(this.txt(px + pw - 140 * k, y + 14 * k, t('journal.claimed'), 12, '#8fd46a'));
      });
      if (!g.quests.extraTaken) {
        const y = top + 30 * k + g.quests.daily.length * 52 * k + 10 * k;
        this.root.add(
          new Button(
            this,
            px + 170 * k,
            y + 18 * k,
            t('journal.extra_ad'),
            () => void g.extraTask().then(() => this.build()),
            300 * k,
            38 * k,
          ),
        );
      }
      return;
    }
    // Записки: список слева, текст справа.
    const read = reg.prog.notes.filter((n) => g.quests.notesRead.includes(n.id));
    if (!read.length) {
      this.root.add(this.txt(px + 24 * k, top, t('journal.no_notes'), 14, COLORS.textDim));
      return;
    }
    const lw = pw * 0.38;
    read.forEach((n, i) => {
      const y = top + i * 30 * k;
      const sel = this.note === n.id;
      const r = this.add
        .rectangle(px + 20 * k, y, lw, 26 * k, sel ? 0x3a3024 : 0x1d1a16, 0.9)
        .setOrigin(0)
        .setInteractive({ useHandCursor: true });
      r.on('pointerup', () => {
        this.note = n.id;
        this.build();
      });
      this.root.add([r, this.txt(px + 28 * k, y + 4 * k, n.title, 12, sel ? '#e0c060' : COLORS.text, sel)]);
    });
    const n = read.find((x) => x.id === this.note) ?? read[read.length - 1]!;
    const tx = px + 40 * k + lw;
    this.root.add(this.txt(tx, top, n.title, 16, '#e0c060', true, pw - lw - 70 * k));
    this.root.add(this.txt(tx, top + 30 * k, n.text, 14, COLORS.text, false, pw - lw - 70 * k));
  }
}
