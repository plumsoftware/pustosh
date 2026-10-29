import type { NewGameState } from '../../core/save/SaveManager';
import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import { log } from '../../core/util/Log';
import { SaveError, SaveUserError, type SlotMeta } from '../../core/save';
import { AdsController } from '../AdsController';
import { ctx, registry } from '../GameContext';
import { SceneKeys } from '../SceneKeys';
import { rowFrame } from '../ui/Styled';
import { Button } from '../ui/Button';
import { confirmDialog, promptText } from '../ui/Dialogs';
import { COLORS, FONT, TEXT_RES, uiScale, TITLE_FONT } from '../ui/layout';

/**
 * Экран сохранений: список игр (название, день, биом, уровень, время игры), новая игра с названием,
 * продолжить, переименовать, удалить. У каждого сохранения — свой мир и прогресс.
 */
export class SavesScene extends Phaser.Scene {
  private list!: Phaser.GameObjects.Container;
  private slots: SlotMeta[] = [];
  private scrollY = 0;
  private listTop = 0;
  private listH = 0;
  private busy = false;
  private status!: Phaser.GameObjects.Text;

  constructor() {
    super(SceneKeys.Saves);
  }

  create(): void {
    this.busy = false;
    this.scrollY = 0;
    this.cameras.main.setBackgroundColor('#14110e');
    this.input.keyboard?.on('keydown-ESC', () => this.back());
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, (_p: unknown, _o: unknown, _dx: number, dy: number) =>
      this.scrollBy(dy),
    );
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      if (p.isDown && p.y > this.listTop) this.scrollBy(-(p.y - p.prevPosition.y));
    });
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this),
    );
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    this.slots = await ctx().saves!.list();
    if (this.scene.isActive()) this.layout();
  }

  private layout(): void {
    this.children.removeAll(true);
    const { width, height } = this.scale;
    const k = uiScale(this);
    const max = registry().worldgen.persistence.maxSaveSlots;
    const pad = Math.round(16 * k + 8);

    this.add
      .text(pad, pad, t('saves.title'), {
        fontFamily: TITLE_FONT,
        resolution: TEXT_RES,
        fontSize: `${Math.round(40 * k)}px`,
        color: COLORS.text,
        fontStyle: '700',
      })
      .setOrigin(0, 0);
    this.add
      .text(pad, pad + 48 * k, t('saves.count', { n: this.slots.length, max }), {
        fontFamily: FONT,
        resolution: TEXT_RES,
        fontSize: `${Math.round(18 * k)}px`,
        color: COLORS.textDim,
      })
      .setOrigin(0, 0);
    const bh = 56 * k;
    new Button(
      this,
      width - pad - 130 * k,
      pad + bh / 2,
      t('saves.new'),
      () => void this.newGame(),
      260 * k,
      bh,
    );
    new Button(
      this,
      width - pad - 260 * k - 12 * k - 70 * k,
      pad + bh / 2,
      t('ui.back'),
      () => this.back(),
      140 * k,
      bh,
    );
    this.status = this.add
      .text(width / 2, height - 10, '', {
        fontFamily: FONT,
        resolution: TEXT_RES,
        fontSize: `${Math.round(16 * k + 2)}px`,
        color: '#ff7a66',
      })
      .setOrigin(0.5, 1)
      .setDepth(10);

    this.listTop = pad + bh + 24 * k;
    this.list = this.add.container(0, this.listTop);
    const mask = this.make.graphics({}, false).fillRect(0, this.listTop, width, height - this.listTop);
    this.list.setMask(mask.createGeometryMask());

    if (this.slots.length === 0) {
      this.list.add(
        this.add
          .text(width / 2, 60 * k, t('saves.empty'), {
            fontFamily: FONT,
            resolution: TEXT_RES,
            fontSize: `${Math.round(20 * k + 2)}px`,
            color: COLORS.textDim,
          })
          .setOrigin(0.5),
      );
    }
    const rowH = 96 * k;
    const rowW = width - pad * 2;
    this.slots.forEach((s, i) => this.addRow(s, pad, i * (rowH + 10 * k), rowW, rowH, k));
    this.listH = this.slots.length * (rowH + 10 * k);
    this.scrollBy(0);
  }

  private addRow(s: SlotMeta, x: number, y: number, w: number, h: number, k: number): void {
    const bg = rowFrame(this, x, y, w, h).setOrigin(0);
    bg.setInteractive({ useHandCursor: true }).on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.getDistance() < 10) void this.play(s.id);
    });
    const name = this.add.text(x + 16 * k, y + 14 * k, s.name, {
      fontFamily: FONT,
      resolution: TEXT_RES,
      fontSize: `${Math.round(24 * k + 2)}px`,
      color: COLORS.text,
      fontStyle: '700',
    });
    const info = this.add.text(
      x + 16 * k,
      y + 50 * k,
      `${this.infoLine(s)}\n${t('saves.updated', { date: formatDate(s.updatedAt) })}`,
      {
        fontFamily: FONT,
        resolution: TEXT_RES,
        fontSize: `${Math.round(14 * k + 2)}px`,
        color: COLORS.textDim,
      },
    );
    const bh = 48 * k;
    const cy = y + h / 2;
    const play = new Button(
      this,
      x + w - 16 * k - 70 * k,
      cy,
      t('saves.play'),
      () => void this.play(s.id),
      140 * k,
      bh,
    );
    const ren = new Button(
      this,
      x + w - 16 * k - 140 * k - 12 * k - 55 * k,
      cy,
      t('saves.rename'),
      () => void this.rename(s),
      110 * k,
      bh,
    );
    const del = new Button(
      this,
      x + w - 16 * k - 140 * k - 12 * k - 110 * k - 12 * k - 65 * k,
      cy,
      t('saves.delete'),
      () => void this.remove(s),
      130 * k,
      bh,
    );
    this.list.add([bg, name, info, play, ren, del]);
  }

  private infoLine(s: SlotMeta): string {
    const biome = registry().biomes.get(s.maxBiome)?.name_ru ?? '';
    const min = Math.floor(s.playTimeSec / 60);
    const time =
      min >= 60
        ? t('saves.played_h', { h: Math.floor(min / 60), m: min % 60 })
        : t('saves.played_m', { m: min });
    return t('saves.info', { day: s.day, biome, level: s.level, time });
  }

  private scrollBy(dy: number): void {
    const viewH = this.scale.height - this.listTop - 30;
    this.scrollY = Phaser.Math.Clamp(this.scrollY + dy, 0, Math.max(0, this.listH - viewH));
    if (this.list) this.list.y = this.listTop - this.scrollY;
  }

  private back(): void {
    if (this.busy) return;
    this.scene.start(SceneKeys.MainMenu);
  }

  private errorText(e: unknown): string {
    if (e instanceof SaveUserError)
      return t(`saves.err.${e.code}`, { max: registry().worldgen.persistence.maxSaveSlots });
    if (e instanceof SaveError) return t('saves.err.corrupt', { msg: e.message });
    log.error('saves', e);
    return t('saves.err.write_failed');
  }

  private async newGame(): Promise<void> {
    if (this.busy) return;
    const saves = ctx().saves!;
    const max = registry().worldgen.persistence.maxSaveSlots;
    if (this.slots.length >= max) {
      this.status.setText(t('saves.err.slots_full', { max }));
      return;
    }
    let n = this.slots.length + 1;
    while (this.slots.some((s) => s.name === t('saves.default_name', { n }))) n++;
    this.busy = true;
    const name = await promptText(this.game, {
      title: t('saves.name_prompt'),
      value: t('saves.default_name', { n }),
      maxLength: registry().worldgen.persistence.saveNameMaxLength,
      validate: async (v) => {
        try {
          const save = await saves.create(v, newGameState(), Date.now());
          ctx().currentSave = save;
          return null;
        } catch (e) {
          return this.errorText(e);
        }
      },
    });
    this.busy = false;
    if (name !== null) await this.startWorld();
  }

  private async play(id: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.status.setColor(COLORS.textDim).setText(t('saves.loading'));
    try {
      ctx().currentSave = await ctx().saves!.load(id);
    } catch (e) {
      this.busy = false;
      this.status.setColor('#ff7a66').setText(this.errorText(e));
      return;
    }
    await this.startWorld();
  }

  private async startWorld(): Promise<void> {
    this.busy = true;
    await AdsController.interstitial('menu_to_game');
    this.scene.start(SceneKeys.World);
  }

  private async rename(s: SlotMeta): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const saves = ctx().saves!;
    await promptText(this.game, {
      title: t('saves.rename_prompt'),
      value: s.name,
      maxLength: registry().worldgen.persistence.saveNameMaxLength,
      validate: async (v) => {
        try {
          await saves.rename(s.id, v, Date.now());
          return null;
        } catch (e) {
          return this.errorText(e);
        }
      },
    });
    this.busy = false;
    await this.refresh();
  }

  private async remove(s: SlotMeta): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const ok = await confirmDialog(this.game, {
      text: t('saves.delete_confirm', { name: s.name }),
      okLabel: t('saves.delete'),
      danger: true,
    });
    if (ok) {
      try {
        await ctx().saves!.remove(s.id);
      } catch (e) {
        this.status.setText(this.errorText(e));
      }
    }
    this.busy = false;
    await this.refresh();
  }
}

/** Новая игра: мир по сиду, герой у бункера, утро первого дня. */
function newGameState(): NewGameState {
  const reg = registry();
  const g = reg.worldgen;
  const a = (g.start.angleDeg * Math.PI) / 180;
  const c = reg.balance.world.sizeTiles[0] / 2;
  return {
    seed: reg.balance.world.seed,
    hero: {
      x: Math.floor(c + Math.cos(a) * g.start.radiusTiles) + 0.5,
      y: Math.floor(c + Math.sin(a) * g.start.radiusTiles) + 0.5,
    },
    worldSec: g.dayNight.transitionSec + 30,
    size: reg.balance.world.sizeTiles[0],
  };
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
