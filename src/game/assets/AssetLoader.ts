import Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';
import { log } from '../../core/util/Log';
import { atlasGroups } from './AssetIndex';

const ATLAS_DIR = 'atlases/';
const pending = new Map<string, Promise<void>>();

/** Ставит группу атласа в очередь загрузчика (ключ текстуры = имя группы). */
export function queueGroup(loader: Phaser.Loader.LoaderPlugin, group: string): void {
  const info = atlasGroups().groups[group];
  if (!info) throw new Error(`AssetLoader: нет группы атласа «${group}»`);
  if (loader.textureManager.exists(group)) return;
  if (info.type === 'atlas') loader.atlas(group, ATLAS_DIR + info.images[0], ATLAS_DIR + info.json);
  else loader.multiatlas(group, ATLAS_DIR + info.json, ATLAS_DIR);
}

export const AssetLoader = {
  isLoaded(scene: Phaser.Scene, group: string): boolean {
    return scene.textures.exists(group);
  },

  /** Выгрузить группу из памяти (видеопамять атласа). Объекты с этой текстурой должны быть уже удалены. */
  unloadGroup(scene: Phaser.Scene, group: string): boolean {
    if (pending.has(group) || !scene.textures.exists(group)) return false;
    scene.textures.remove(group);
    bitmaps.get(group)?.close();
    bitmaps.delete(group);
    log.debug(`atlas group unloaded: ${group}`);
    return true;
  },

  isPending(group: string): boolean {
    return pending.has(group);
  },

  /**
   * Ленивая догрузка группы (биомы 2–6, боссы, транспорт) с маленьким индикатором в углу.
   * Повторный вызов не грузит второй раз и возвращает тот же Promise.
   * PNG декодируется вне главного потока (createImageBitmap): загрузка в GPU — единицы мс вместо
   * 65–75 мс на слабом телефоне (декодирование Image в момент texImage2D). Без поддержки — загрузчик Phaser.
   */
  ensureGroup(scene: Phaser.Scene, group: string): Promise<void> {
    if (scene.textures.exists(group)) return Promise.resolve();
    const inFlight = pending.get(group);
    if (inFlight) return inFlight;
    const info = atlasGroups().groups[group];
    if (!info) return Promise.reject(new Error(`AssetLoader: нет группы атласа «${group}»`));

    const label = showLabel(scene, group);
    const viaBitmap = info.type === 'atlas' && typeof createImageBitmap === 'function';
    const p = (
      viaBitmap
        ? loadViaBitmap(scene, group).catch((e: unknown) => {
            log.warn(`atlas ${group}: createImageBitmap не сработал, загрузчик Phaser`, e);
            return loadViaLoader(scene, group);
          })
        : loadViaLoader(scene, group)
    ).finally(() => {
      label?.destroy();
      pending.delete(group);
    });
    pending.set(group, p);
    return p;
  },
};

const bitmaps = new Map<string, ImageBitmap>();

/** Индикатор «Догрузка: …» в верхней активной сцене (у неё камера без зума). */
function showLabel(scene: Phaser.Scene, group: string): Phaser.GameObjects.Text | null {
  const top = scene.game.scene.getScenes(true).at(-1) ?? scene;
  if (!top.sys.displayList) return null;
  return top.add
    .text(top.scale.width - 12, top.scale.height - 12, t('ui.loading_group', { group }), {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '14px',
      color: '#f2e6c9',
      backgroundColor: '#000000aa',
      padding: { x: 6, y: 3 },
    })
    .setOrigin(1, 1)
    .setScrollFactor(0)
    .setDepth(1e9);
}

async function loadViaBitmap(scene: Phaser.Scene, group: string): Promise<void> {
  const info = atlasGroups().groups[group]!;
  const [json, bmp] = await Promise.all([
    fetch(ATLAS_DIR + info.json).then((r) => {
      if (!r.ok) throw new Error(`${info.json}: ${r.status}`);
      return r.json() as Promise<object>;
    }),
    fetch(ATLAS_DIR + info.images[0]).then(async (r) => {
      if (!r.ok) throw new Error(`${info.images[0]}: ${r.status}`);
      // Phaser загружает текстуры с предумноженной альфой — так же готовим bitmap.
      return createImageBitmap(await r.blob(), { premultiplyAlpha: 'premultiply' });
    }),
  ]);
  if (scene.textures.exists(group)) {
    bmp.close();
    return;
  }
  scene.textures.addAtlasJSONHash(group, bmp as unknown as HTMLImageElement, json);
  bitmaps.set(group, bmp);
  log.debug(`atlas group loaded (bitmap): ${group}`);
}

function loadViaLoader(scene: Phaser.Scene, group: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const loader = scene.load;
    const onComplete = () => {
      if (!scene.textures.exists(group) && loader.isLoading()) return; // догружается в следующем проходе
      loader.off(Phaser.Loader.Events.COMPLETE, onComplete);
      if (!scene.textures.exists(group)) reject(new Error(`AssetLoader: не загрузилась группа «${group}»`));
      else {
        log.debug(`atlas group loaded: ${group}`);
        resolve();
      }
    };
    loader.on(Phaser.Loader.Events.COMPLETE, onComplete);
    queueGroup(loader, group);
    if (!loader.isLoading()) loader.start();
  });
}
