import Phaser from 'phaser';
import { log } from '../../core/util/Log';

export type Bus = 'music' | 'sfx' | 'ui';

/** Звуки игры (public/audio, CC0 — LICENSES.md): ключ → число вариантов (step_1…4) или 0 — один файл. */
export const SOUNDS: Record<string, number> = {
  step: 4,
  hit_wood: 2,
  hit_stone: 2,
  hit_metal: 2,
  hit_flesh: 2,
  swing: 2,
  shot: 2,
  explosion: 2,
  growl: 4,
  ui_click: 0,
  ui_open: 0,
  ui_close: 0,
  ui_error: 0,
  ui_confirm: 0,
  ui_drop: 0,
  pickup: 0,
  craft: 0,
  build: 0,
  door: 0,
  chest: 0,
  level_up: 0,
  campfire_loop: 0,
  wind_loop: 0,
  music_menu: 0,
  music_night: 0,
};
const GROWL_FILES = [1, 3, 5, 7];

/** Файлы для загрузчика: OGG (Opus) + MP3 (Safari/iOS) — Phaser выберет поддерживаемый. */
export function soundFiles(): { key: string; urls: string[] }[] {
  const out: { key: string; urls: string[] }[] = [];
  for (const [k, n] of Object.entries(SOUNDS)) {
    const names =
      n === 0
        ? [k]
        : k === 'growl'
          ? GROWL_FILES.map((i) => `${k}_${i}`)
          : Array.from({ length: n }, (_, i) => `${k}_${i + 1}`);
    for (const name of names)
      out.push({ key: `snd_${name}`, urls: [`audio/${name}.ogg`, `audio/${name}.mp3`] });
  }
  return out;
}

const SETTINGS_KEY = 'pustosh.audio';

let current: AudioBus | null = null;

/** Звук игры (создаётся в installLifecycle). */
export function audio(): AudioBus | null {
  return current;
}

/** Создать звук игры (один на приложение). */
export function createAudio(sound: Phaser.Sound.BaseSoundManager): AudioBus {
  current = new AudioBus(sound);
  return current;
}

/**
 * Звук (TZ 9.8): шины громкости «музыка / эффекты / интерфейс» (настройки — localStorage, удобство одного
 * зрителя), варианты эффектов, петли (костёр, ветер), музыка. Любая пауза глушит всё (setPausedMute).
 * Звук стартует после первого касания — разблокировку делает Phaser на первом вводе.
 */
export class AudioBus {
  private muted = false;
  volume: Record<Bus, number> = { music: 0.5, sfx: 0.8, ui: 0.7 };
  private music: Phaser.Sound.BaseSound | null = null;
  private musicKey = '';
  private loops = new Map<string, Phaser.Sound.BaseSound>();
  private last = new Map<string, number>();

  constructor(private readonly sound: Phaser.Sound.BaseSoundManager) {
    try {
      const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Record<Bus, number> | null;
      if (v) this.volume = { ...this.volume, ...v };
    } catch {
      /* настройки звука — необязательны */
    }
  }

  private loading = false;

  /**
   * Звуки грузятся в фоне после старта (не блокируют загрузку игры; на Android WebView десятки
   * параллельных запросов к локальному серверу стопорили загрузку данных). Музыка включится, когда
   * загрузится. Не больше 4 файлов одновременно.
   */
  loadInBackground(scene: Phaser.Scene, onMusic?: () => void): void {
    if (this.loading) return;
    const files = soundFiles().filter((f) => !this.has(f.key));
    if (!files.length) return;
    this.loading = true;
    // Сцена закрылась до конца загрузки — следующая сцена догрузит оставшееся.
    const done = () => (this.loading = false);
    scene.load.once(Phaser.Loader.Events.COMPLETE, done);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, done);
    const l = scene.load;
    l.maxParallelDownloads = 4;
    // Музыку меню — первой.
    files.sort((a, b) => Number(b.key === 'snd_music_menu') - Number(a.key === 'snd_music_menu'));
    for (const f of files) l.audio(f.key, f.urls);
    l.on(Phaser.Loader.Events.FILE_COMPLETE, (key: string) => {
      if (key === 'snd_music_menu') onMusic?.();
    });
    l.start();
  }

  setPausedMute(muted: boolean): void {
    this.muted = muted;
    this.sound.mute = muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setVolume(bus: Bus, v: number): void {
    this.volume[bus] = Math.max(0, Math.min(1, v));
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.volume));
    } catch {
      /* без сохранения */
    }
    if (bus === 'music' && this.music)
      (this.music as Phaser.Sound.WebAudioSound).setVolume?.(this.volume.music);
    for (const [k, s] of this.loops) (s as Phaser.Sound.WebAudioSound).setVolume?.(this.loopVol(k));
  }

  private has(key: string): boolean {
    return this.sound.game.cache.audio.exists(key);
  }

  /** Эффект: случайный вариант, не чаще раза в 40 мс на ключ (толпа врагов не забивает микшер). */
  play(name: string, bus: Bus = 'sfx', vol = 1, rate = 1): void {
    const n = SOUNDS[name];
    if (n === undefined) return;
    const now = performance.now();
    if ((this.last.get(name) ?? 0) + 40 > now) return;
    this.last.set(name, now);
    const variant =
      n === 0
        ? name
        : name === 'growl'
          ? `${name}_${GROWL_FILES[Math.floor(Math.random() * GROWL_FILES.length)]}`
          : `${name}_${1 + Math.floor(Math.random() * n)}`;
    const key = `snd_${variant}`;
    if (!this.has(key)) return;
    try {
      this.sound.play(key, { volume: this.volume[bus] * vol, rate: rate * (0.94 + Math.random() * 0.12) });
    } catch (e) {
      log.debug('audio: play', e);
    }
  }

  /** Музыка: меню / ночь; null — тишина. Плавная смена. */
  playMusic(name: string | null): void {
    if (name === this.musicKey && (this.music || !name)) return;
    this.musicKey = name ?? '';
    const old = this.music;
    if (old) {
      old.stop();
      old.destroy();
    }
    this.music = null;
    if (!name || !this.has(`snd_${name}`)) return;
    this.music = this.sound.add(`snd_${name}`, { loop: true, volume: this.volume.music });
    this.music.play();
  }

  private loopVol(k: string): number {
    return this.volume.sfx * (this.loopLevel.get(k) ?? 0);
  }

  private loopLevel = new Map<string, number>();

  /** Петля с громкостью 0…1 (костёр рядом, ветер): 0 — остановить. */
  loop(name: string, level: number): void {
    const key = `snd_${name}`;
    let s = this.loops.get(name);
    this.loopLevel.set(name, level);
    if (level <= 0.01) {
      if (s) {
        s.stop();
        s.destroy();
        this.loops.delete(name);
      }
      return;
    }
    if (!s) {
      if (!this.has(key)) return;
      s = this.sound.add(key, { loop: true, volume: 0 });
      s.play();
      this.loops.set(name, s);
    }
    (s as Phaser.Sound.WebAudioSound).setVolume?.(this.loopVol(name));
  }

  stopLoops(): void {
    for (const s of this.loops.values()) {
      s.stop();
      s.destroy();
    }
    this.loops.clear();
  }
}
