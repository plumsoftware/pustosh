import Phaser from 'phaser';
import { log } from '../../core/util/Log';
import { getAssetInfo } from '../assets/AssetIndex';
import { AssetLoader } from '../assets/AssetLoader';
import { spawnSprite } from '../assets/spawnSprite';
import { ctx, registry } from '../GameContext';
import { AnimationPlayer } from '../rig/AnimationPlayer';
import { humanoidAnims, type AnimName } from '../rig/Animations';
import {
  listCharacters,
  resolveCharacter,
  setRigTuning,
  tuningOf,
  type CharacterDef,
  type ResolvedBone,
} from '../rig/RigDef';
import { RigInstance } from '../rig/RigInstance';
import { EMPTY_POSE } from '../rig/Pose';
import { SceneKeys } from '../SceneKeys';
import { UI_FONT_MONO } from '../ui/BitmapFont';
import { COLORS, FONT, TEXT_RES } from '../ui/layout';

/** Увеличение персонажа в редакторе. */
const ZOOM = 4;
const PREVIEWS: (AnimName | 'none')[] = ['none', 'idle', 'walk', 'run', 'attack_slash', 'dodge', 'death'];

type DragMode = 'attach' | 'pivot';

/**
 * Редактор рига (F6): персонаж → кость → перетаскивание сустава (attach) или точки вращения (pivot),
 * колесо — масштаб части, Q/E — поворот покоя (Shift ×5), R — эталон, A — предпросмотр анимации,
 * M — режим, Tab — следующая кость, S — сохранить в data/rigs_tuned/<id>.json.
 * Адрес ?scene=rig&char=<id> открывает редактор сразу.
 */
export class RigEditorScene extends Phaser.Scene {
  private def!: CharacterDef;
  private rig: RigInstance | null = null;
  private ref: Phaser.GameObjects.Image | null = null;
  private showRef = true;
  private sel = 0;
  private mode: DragMode = 'attach';
  private preview = 0;
  private player!: AnimationPlayer;
  private overlay!: Phaser.GameObjects.Graphics;
  private info!: Phaser.GameObjects.BitmapText;
  private ui!: Phaser.GameObjects.Container;
  private rootX = 0;
  private rootY = 0;
  private dragging = false;
  private status = '';

  constructor() {
    super(SceneKeys.RigEditor);
  }

  async create(): Promise<void> {
    const { clock, params } = ctx();
    clock.pause('DIALOG');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => clock.resume('DIALOG'));
    this.cameras.main.setBackgroundColor('#3b4048');
    this.player = new AnimationPlayer(
      humanoidAnims(registry().rigs.humanoid['animations'] as Record<string, { loopSec?: number }>),
    );
    this.overlay = this.add.graphics().setDepth(10);
    this.info = this.add.bitmapText(0, 0, UI_FONT_MONO, '', 14).setDepth(20);
    this.ui = this.add.container(0, 0).setDepth(30);
    this.installInput();
    await this.loadCharacter(params.get('char') ?? 'hero');
  }

  private async loadCharacter(id: string): Promise<void> {
    const reg = registry();
    for (const g of ['hero', 'enemies', 'animals']) await AssetLoader.ensureGroup(this, g);
    if (!this.scene.isActive()) return;
    this.def = resolveCharacter(reg, id);
    this.sel = Math.max(
      0,
      this.def.bones.findIndex((b) => b.part),
    );
    this.rig?.destroy();
    this.ref?.destroy();
    const { width, height } = this.scale;
    this.rootX = width * 0.55;
    this.rootY = height * 0.5 + (this.def.height * ZOOM) / 2;
    this.ref = this.def.ref
      ? spawnSprite(this, this.rootX, this.rootY, this.def.ref, { depth: 5 }).setOrigin(0.5, 1).setAlpha(0.45)
      : null;
    if (this.ref) this.ref.setScale((this.def.height * ZOOM) / this.ref.frame.height);
    this.ref?.setVisible(this.showRef);
    this.rig = new RigInstance(this, this.def, this.rootX, this.rootY);
    this.rig.container.setScale(ZOOM).setDepth(1);
    this.drawPanel();
  }

  // ------------------------------------------------------------------ панель

  private drawPanel(): void {
    this.ui.removeAll(true);
    const chars = listCharacters(registry());
    const style = { fontFamily: FONT, resolution: TEXT_RES, fontSize: '13px', color: COLORS.text };
    let y = 8;
    this.ui.add(this.add.text(8, y, 'Персонаж (клик):', { ...style, color: COLORS.textDim }));
    y += 18;
    for (const c of chars) {
      const t = this.add
        .text(12, y, c.name, { ...style, color: c.id === this.def.id ? '#ffd27a' : COLORS.text })
        .setInteractive({ useHandCursor: true })
        .on('pointerup', () => void this.loadCharacter(c.id));
      this.ui.add(t);
      y += 16;
    }
    y += 10;
    this.ui.add(this.add.text(8, y, 'Кость (клик / Tab):', { ...style, color: COLORS.textDim }));
    y += 18;
    this.def.bones.forEach((b, i) => {
      const t = this.add
        .text(12, y, `${b.id}${b.part ? '' : ' ·'}`, {
          ...style,
          color: i === this.sel ? '#ffd27a' : COLORS.text,
        })
        .setInteractive({ useHandCursor: true })
        .on('pointerup', () => {
          this.sel = i;
          this.drawPanel();
        });
      this.ui.add(t);
      y += 16;
    });
    const bx = this.scale.width - 170;
    const btn = (yy: number, label: string, fn: () => void) =>
      this.ui.add(
        this.add
          .text(bx, yy, label, {
            ...style,
            fontSize: '15px',
            backgroundColor: '#c9772b',
            padding: { x: 10, y: 6 },
            color: '#000',
          })
          .setInteractive({ useHandCursor: true })
          .on('pointerup', fn),
      );
    btn(10, `Режим: ${this.mode === 'attach' ? 'сустав' : 'точка вращ.'} (M)`, () => this.toggleMode());
    btn(46, `Эталон: ${this.showRef ? 'вкл' : 'выкл'} (R)`, () => this.toggleRef());
    btn(82, `Анимация: ${PREVIEWS[this.preview]} (A)`, () => this.nextPreview());
    btn(118, 'Сохранить (S)', () => void this.save());
    btn(154, 'Закрыть (F6)', () => this.scene.stop());
  }

  private toggleMode(): void {
    this.mode = this.mode === 'attach' ? 'pivot' : 'attach';
    this.drawPanel();
  }

  private toggleRef(): void {
    this.showRef = !this.showRef;
    this.ref?.setVisible(this.showRef);
    this.drawPanel();
  }

  private nextPreview(): void {
    this.preview = (this.preview + 1) % PREVIEWS.length;
    const p = PREVIEWS[this.preview]!;
    if (p !== 'none') {
      this.player.stop();
      if (p === 'idle' || p === 'walk' || p === 'run') this.player.setBase(p);
      else this.player.play(p, { hold: p === 'death' });
    }
    this.drawPanel();
  }

  private get bone(): ResolvedBone {
    return this.def.bones[this.sel]!;
  }

  // ------------------------------------------------------------------ ввод

  private installInput(): void {
    const kb = this.input.keyboard!;
    kb.on('keydown', (e: KeyboardEvent) => {
      const b = this.bone;
      const step = e.shiftKey ? 5 : 1;
      switch (e.code) {
        case 'KeyQ':
          b.rest -= step;
          break;
        case 'KeyE':
          b.rest += step;
          break;
        case 'Tab':
          e.preventDefault();
          this.sel = (this.sel + 1) % this.def.bones.length;
          this.drawPanel();
          break;
        case 'KeyM':
          this.toggleMode();
          break;
        case 'KeyR':
          this.toggleRef();
          break;
        case 'KeyA':
          this.nextPreview();
          break;
        case 'KeyS':
          void this.save();
          break;
        case 'Escape':
        case 'F6':
          e.preventDefault();
          this.scene.stop();
          break;
      }
    });
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (!this.bone.part) return;
      this.bone.scale *= dy > 0 ? 1 / 1.02 : 1.02;
    });
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      if (p.x > 200 && p.x < this.scale.width - 180) this.dragging = true;
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, () => (this.dragging = false));
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      if (!this.dragging || !p.isDown || !this.rig) return;
      const dx = p.x - p.prevPosition.x;
      const dy = p.y - p.prevPosition.y;
      this.drag(dx, dy);
    });
  }

  /** Перетаскивание: сустав — сдвиг attach в системе родителя; pivot — сдвиг картинки относительно сустава. */
  private drag(dx: number, dy: number): void {
    const b = this.bone;
    const H = this.def.height * ZOOM;
    if (this.mode === 'attach') {
      const parent = b.parent ? this.rig!.boneWorld(b.parent) : { rot: 0 };
      const r = -(parent?.rot ?? 0);
      const lx = dx * Math.cos(r) - dy * Math.sin(r);
      const ly = dx * Math.sin(r) + dy * Math.cos(r);
      b.attach = [b.attach[0] + lx / H, b.attach[1] + ly / H];
    } else {
      const img = this.rig!.boneImage(b.id);
      if (!img) return;
      const w = this.rig!.boneWorld(b.id)!;
      const r = -w.rot;
      const lx = dx * Math.cos(r) - dy * Math.sin(r);
      const ly = dx * Math.sin(r) + dy * Math.cos(r);
      const sw = img.frame.width * b.scale * ZOOM;
      const sh = img.frame.height * b.scale * ZOOM;
      // Картинка едет за мышью — точка вращения на ней сдвигается в обратную сторону.
      b.pivot = [b.pivot[0] - lx / sw, b.pivot[1] - ly / sh];
      img.setOrigin(b.pivot[0], b.pivot[1]);
    }
  }

  // ------------------------------------------------------------------ кадр

  override update(_t: number, delta: number): void {
    if (!this.rig) return;
    const p = PREVIEWS[this.preview]!;
    const pose = p === 'none' ? EMPTY_POSE : this.player.update(delta / 1000);
    for (const b of this.def.bones) this.rig.boneImage(b.id)?.setOrigin(b.pivot[0], b.pivot[1]);
    this.rig.apply(pose);
    this.drawOverlay();
  }

  private drawOverlay(): void {
    const g = this.overlay;
    g.clear();
    const b = this.bone;
    const w = this.rig!.boneWorld(b.id);
    if (!w) return;
    // Земля
    g.lineStyle(1, 0xffffff, 0.3).lineBetween(220, this.rootY, this.scale.width - 190, this.rootY);
    if (b.parent) {
      const p = this.rig!.boneWorld(b.parent)!;
      g.lineStyle(2, 0x5ad1ff, 0.9).lineBetween(p.x, p.y, w.x, w.y);
    }
    g.lineStyle(2, 0xff3030, 1);
    g.lineBetween(w.x - 8, w.y, w.x + 8, w.y).lineBetween(w.x, w.y - 8, w.x, w.y + 8);
    const img = this.rig!.boneImage(b.id);
    if (img) {
      const bb = img.getBounds();
      g.lineStyle(1, 0xffd27a, 0.8).strokeRect(bb.x, bb.y, bb.width, bb.height);
    }
    this.info
      .setPosition(220, this.scale.height - 110)
      .setText(
        [
          `${this.def.name} (${this.def.id}) · рост ${this.def.height}px · ${this.def.tuned ? 'калиброван' : 'по формуле'}`,
          `кость ${b.id}  часть ${b.part ?? '—'}  z ${b.z}`,
          `pivot  ${b.pivot[0].toFixed(3)}, ${b.pivot[1].toFixed(3)}    attach ${b.attach[0].toFixed(3)}, ${b.attach[1].toFixed(3)}`,
          `масштаб ${b.scale.toFixed(4)}   покой ${b.rest.toFixed(1)}°`,
          'мышь — тащить · колесо — масштаб · Q/E — поворот (Shift ×5) · M режим · R эталон · A анимация · S сохранить',
          this.status,
        ].join('\n'),
      );
  }

  // ------------------------------------------------------------------ сохранение

  private async save(): Promise<void> {
    const reg = registry();
    const data = tuningOf(this.def, reg);
    setRigTuning(data);
    this.def = resolveCharacter(reg, this.def.id);
    this.rig?.rebuild(this.def);
    try {
      const r = await fetch('/__rig/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
      const j = (await r.json()) as { ok: boolean; file?: string };
      if (!j.ok) throw new Error('save failed');
      this.status = `Сохранено: ${j.file}`;
    } catch (e) {
      // Не dev-сервер: отдаём файл для ручного копирования в public/data/rigs_tuned/.
      log.info('rig editor: dev-сервер недоступен, скачиваем файл', e);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
      a.download = `${data.id}.json`;
      a.click();
      this.status = `Скачан ${data.id}.json — положите в public/data/rigs_tuned/ и добавьте в index.json`;
    }
    if (getAssetInfo(this.def.ref ?? '')) this.ref?.setVisible(this.showRef);
  }
}
