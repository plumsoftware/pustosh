import Phaser from 'phaser';
import { formatIssue, loadGameData, prefabIdsOf, DATA_FILE_NAMES } from '../../core/data';
import { t } from '../../core/i18n/i18n';
import { SaveManager } from '../../core/save';
import { log } from '../../core/util/Log';
import { atlasGroups, setAssetIndex, type AssetInfo, type AtlasGroups } from '../assets/AssetIndex';
import { queueGroup } from '../assets/AssetLoader';
import { ctx } from '../GameContext';
import { SceneKeys } from '../SceneKeys';
import { setRigTuning, type RigTuning } from '../rig/RigDef';
import { COLORS, FONT, TEXT_RES, TITLE_FONT } from '../ui/layout';
import { LOADING_ART } from './BootScene';

const INDEX_KEY = 'asset_index';
const GROUPS_KEY = 'atlas_groups';
const dataKey = (name: string) => `data.${name}`;
const prefabKey = (id: string) => `prefab.${id}`;
const rigKey = (id: string) => `rig.${id}`;
const RIGS_INDEX_KEY = 'rigs_tuned.index';

/**
 * Загрузка: asset_index.json и atlas_groups.json → группы «при старте» и все data/*.json,
 * полоска прогресса, проверка данных и сборка Registry.
 */
export class PreloadScene extends Phaser.Scene {
  private bar!: Phaser.GameObjects.Graphics;
  private label!: Phaser.GameObjects.Text;
  private barX = 0;
  private barY = 0;
  private barW = 0;

  constructor() {
    super(SceneKeys.Preload);
  }

  preload(): void {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#000000');
    // Картина «ночная стоянка» целиком слева, за ней — она же, размытая на весь экран; логотип справа.
    let tx = width / 2;
    let ty = height * 0.2;
    let ts = Math.min(110, width / 7);
    if (this.textures.exists(LOADING_ART)) {
      const bg = this.add.image(width / 2, height / 2, LOADING_ART).setAlpha(0.4);
      bg.setScale(Math.max(width / bg.width, height / bg.height) * 1.05);
      bg.preFX?.addBlur(1, 2, 2, 1.4);
      const wide = width / height > 1.3;
      const fg = this.add.image(wide ? 0 : width / 2, height / 2, LOADING_ART).setOrigin(wide ? 0 : 0.5, 0.5);
      fg.setScale(Math.min(height / fg.height, (wide ? width * 0.55 : width) / fg.width));
      if (wide) {
        tx = fg.displayWidth + (width - fg.displayWidth) / 2;
        ty = height * 0.36;
        ts = Math.min(96, (width - fg.displayWidth) / 6.5);
      }
    }
    this.add
      .text(tx, ty, t('game.title'), {
        fontFamily: TITLE_FONT,
        resolution: TEXT_RES,
        fontSize: `${Math.round(ts)}px`,
        color: '#f0d9a8',
        stroke: '#140e08',
        strokeThickness: Math.round(ts / 9),
      })
      .setOrigin(0.5)
      .setShadow(0, 5, '#000', 12, true, true);
    // Полоса и подпись — под логотипом.
    this.barX = tx;
    this.barY = ty + ts * 0.9;
    this.barW = Math.min(520, (tx === width / 2 ? width : (width - tx) * 2) * 0.7);
    this.bar = this.add.graphics();
    this.label = this.add
      .text(this.barX, this.barY + 34, t('ui.loading', { percent: 0 }), {
        fontFamily: FONT,
        resolution: TEXT_RES,
        fontSize: '18px',
        color: COLORS.textDim,
      })
      .setOrigin(0.5);
    this.drawBar(0);

    // Первый проход — маленькие индексы; дальше create() ставит в очередь атласы и данные.
    this.load.json(INDEX_KEY, 'atlases/asset_index.json');
    this.load.json(GROUPS_KEY, 'atlases/atlas_groups.json');
  }

  create(): void {
    setAssetIndex(
      this.cache.json.get(INDEX_KEY) as Record<string, AssetInfo>,
      this.cache.json.get(GROUPS_KEY) as AtlasGroups,
    );
    for (const [group, info] of Object.entries(atlasGroups().groups)) {
      if (info.load === 'start') queueGroup(this.load, group);
    }
    for (const name of DATA_FILE_NAMES) this.load.json(dataKey(name), `data/${name}.json`);

    this.load.on(Phaser.Loader.Events.PROGRESS, (v: number) => this.drawBar(v));
    this.load.once(Phaser.Loader.Events.COMPLETE, () => this.loadPrefabs());
    this.load.start();
  }

  /** Третий проход: префабы мира, список которых — в worldgen.json. */
  private loadPrefabs(): void {
    const ids = prefabIdsOf(this.cache.json.get(dataKey('worldgen')));
    for (const id of ids) this.load.json(prefabKey(id), `data/world/prefabs/${id}.json`);
    this.load.json(RIGS_INDEX_KEY, 'data/rigs_tuned/index.json');
    this.load.once(Phaser.Loader.Events.COMPLETE, () => this.loadTunedRigs(ids));
    this.load.start();
  }

  /** Четвёртый проход: калибровки ригов из редактора (data/rigs_tuned/<id>.json). */
  private loadTunedRigs(prefabIds: string[]): void {
    const index = this.cache.json.get(RIGS_INDEX_KEY) as { rigs?: unknown } | undefined;
    const ids = Array.isArray(index?.rigs)
      ? index.rigs.filter((x): x is string => typeof x === 'string')
      : [];
    if (ids.length === 0) {
      this.onLoaded(prefabIds);
      return;
    }
    for (const id of ids) this.load.json(rigKey(id), `data/rigs_tuned/${id}.json`);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      for (const id of ids) {
        const t = this.cache.json.get(rigKey(id)) as RigTuning | undefined;
        if (t && t.id === id && t.bones && typeof t.bones === 'object') setRigTuning(t);
        else log.warn(`rigs_tuned/${id}.json: не загружен или повреждён`);
      }
      this.onLoaded(prefabIds);
    });
    this.load.start();
  }

  private onLoaded(prefabIds: string[]): void {
    const raw: Record<string, unknown> = {};
    for (const name of DATA_FILE_NAMES) raw[name] = this.cache.json.get(dataKey(name));
    raw['prefabs'] = Object.fromEntries(prefabIds.map((id) => [id, this.cache.json.get(prefabKey(id))]));
    const index = this.cache.json.get(INDEX_KEY) as Record<string, unknown>;
    const res = loadGameData(raw, { ids: new Set(Object.keys(index)) });
    for (const w of res.warnings) log.warn(formatIssue(w));
    if (res.errors.length > 0 || !res.registry) {
      for (const e of res.errors) log.error(formatIssue(e));
      this.label.setText(t('error.data', { count: res.errors.length })).setColor('#ff6b5a');
      return;
    }
    const c = ctx();
    c.registry = res.registry;
    const pers = res.registry.worldgen.persistence;
    c.saves = new SaveManager(c.platform.saves, {
      maxSlots: pers.maxSaveSlots,
      nameMaxLength: pers.saveNameMaxLength,
      fullDaySec: res.registry.balance.dayNight.fullDaySec,
    });
    c.platform.onLoadingFinished();

    const scene = c.params.get('scene');
    if (c.params.has('gallery')) {
      this.scene.start(SceneKeys.MainMenu);
      this.scene.launch(SceneKeys.Gallery);
    } else if (scene === 'stress') this.scene.start(SceneKeys.Stress);
    else if (scene === 'world') this.scene.start(SceneKeys.World);
    else if (scene === 'rig') {
      this.scene.start(SceneKeys.MainMenu);
      this.scene.launch(SceneKeys.RigEditor);
    } else this.scene.start(SceneKeys.MainMenu);
  }

  private drawBar(v: number): void {
    const w = this.barW;
    const x = this.barX - w / 2;
    const y = this.barY;
    this.bar.clear();
    this.bar.fillStyle(0x2a2520, 1).fillRoundedRect(x, y, w, 14, 7);
    this.bar.fillStyle(COLORS.accent, 1).fillRoundedRect(x, y, Math.max(14, w * v), 14, 7);
    this.label?.setText(t('ui.loading', { percent: Math.round(v * 100) }));
  }
}
