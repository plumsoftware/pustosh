import type { Registry } from '../data/Registry';

/** Обучение (GDD §15): 8 шагов, шаг засчитывается по событию; можно пропустить. */
export interface TutorialState {
  step: number;
  count: number;
  done: boolean;
}

export type TutorialEvent =
  | { type: 'moved'; tiles: number }
  | { type: 'gather'; item: string; n: number }
  | { type: 'craft'; item: string }
  | { type: 'place'; item: string }
  | { type: 'build'; item: string }
  | { type: 'kill' }
  | { type: 'morning' }
  | { type: 'note' };

export function newTutorial(): TutorialState {
  return { step: 0, count: 0, done: false };
}

export function currentStep(
  reg: Registry,
  t: TutorialState,
): { id: string; event: string; n: number; items?: string[] } | null {
  if (t.done) return null;
  return reg.prog.tutorial.steps[t.step] ?? null;
}

/** Событие → прогресс шага. true — шаг пройден (перешли к следующему или к концу). */
export function tutorialEvent(reg: Registry, t: TutorialState, ev: TutorialEvent): boolean {
  const s = currentStep(reg, t);
  if (!s) return false;
  // Постройка тотема в шаге «build» приходит событием place — считаем его как build.
  const type = ev.type === 'place' && s.event === 'build' ? 'build' : ev.type;
  if (type !== s.event) return false;
  const item = 'item' in ev ? ev.item : undefined;
  if (s.items && item && !s.items.includes(item)) return false;
  if (s.items && !item) return false;
  t.count += ev.type === 'moved' ? ev.tiles : ev.type === 'gather' ? ev.n : 1;
  if (t.count < s.n) return false;
  t.step++;
  t.count = 0;
  if (t.step >= reg.prog.tutorial.steps.length) t.done = true;
  return true;
}

export function skipTutorial(t: TutorialState): void {
  t.done = true;
}
