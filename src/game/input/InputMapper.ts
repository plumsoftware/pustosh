/**
 * Ввод → команды игры (ТЗ 4.1). Клавиатура — по event.code (не зависит от раскладки), мышь задаёт
 * направление атаки, телефон — стик и кнопки (их рисует UIScene и передаёт сюда).
 */
export type Command =
  | { type: 'action'; aim?: { x: number; y: number } }
  | { type: 'attack'; aim?: { x: number; y: number } }
  | { type: 'dodge' }
  | { type: 'build' }
  | { type: 'inventory' }
  | { type: 'craft' }
  | { type: 'skills' }
  | { type: 'journal' }
  | { type: 'map' }
  | { type: 'pause' }
  | { type: 'slot'; index: number }
  | { type: 'slotStep'; delta: number }
  | { type: 'zoom'; delta: number };

const MOVE_CODES: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

const ONE_SHOT: Record<string, Command> = {
  Space: { type: 'dodge' },
  KeyE: { type: 'action' },
  KeyB: { type: 'build' },
  Tab: { type: 'inventory' },
  KeyI: { type: 'inventory' },
  KeyC: { type: 'craft' },
  KeyK: { type: 'skills' },
  KeyJ: { type: 'journal' },
  KeyM: { type: 'map' },
  Escape: { type: 'pause' },
  Equal: { type: 'zoom', delta: 1 },
  NumpadAdd: { type: 'zoom', delta: 1 },
  Minus: { type: 'zoom', delta: -1 },
  NumpadSubtract: { type: 'zoom', delta: -1 },
};

/** Клавиши, у которых игра забирает действие браузера (прокрутка, переход фокуса). */
const PREVENT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class InputMapper {
  private down = new Set<string>();
  private queue: Command[] = [];
  private stick = { x: 0, y: 0 };
  /** Последняя точка прицела (мир, px) от мыши. */
  aim: { x: number; y: number } | null = null;
  enabled = true;

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled || isTyping(e)) return;
    if (PREVENT.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    const one = ONE_SHOT[e.code];
    if (one) this.queue.push(one);
    const m = /^Digit([1-6])$/.exec(e.code);
    if (m) this.queue.push({ type: 'slot', index: Number(m[1]) - 1 });
  };
  private readonly onKeyUp = (e: KeyboardEvent) => this.down.delete(e.code);
  private readonly onBlur = () => this.down.clear();

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  /** Направление движения (длина ≤ 1). */
  get move(): { x: number; y: number } {
    let x = this.stick.x;
    let y = this.stick.y;
    for (const code of this.down) {
      const v = MOVE_CODES[code];
      if (v) {
        x += v[0];
        y += v[1];
      }
    }
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  get sprint(): boolean {
    return this.down.has('ShiftLeft') || this.down.has('ShiftRight') || this.stickSprint;
  }

  /** Удержание «Собрать/Открыть» (кнопка действия, E) и «Удар» (кнопка удара, ЛКМ) — раздельно. */
  private holdAction = false;
  private holdAttack = false;
  /** Стик оттянут за кольцо бега (UIScene). */
  private stickSprint = false;

  setActionHold(v: boolean): void {
    this.holdAction = v;
  }

  setAttackHold(v: boolean): void {
    this.holdAttack = v;
  }

  /** Собирать зажато — добыча повторяется ударами. */
  get actionHeld(): boolean {
    return this.enabled && (this.holdAction || this.down.has('KeyE'));
  }

  /** Удар зажат — повтор атаки (автоматическое оружие, огнемёт). */
  get attackHeld(): boolean {
    return this.enabled && this.holdAttack;
  }

  /** Стик телефона: вектор длиной 0…1; sprint — оттянут дальше кольца ходьбы. */
  setStick(x: number, y: number, sprint = false): void {
    this.stick = { x, y };
    this.stickSprint = sprint;
  }

  push(cmd: Command): void {
    if (this.enabled) this.queue.push(cmd);
  }

  /** Забрать накопленные команды (раз в тик логики). */
  take(): Command[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  clear(): void {
    this.queue = [];
    this.down.clear();
    this.holdAction = false;
    this.holdAttack = false;
    this.stickSprint = false;
    this.stick = { x: 0, y: 0 };
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
