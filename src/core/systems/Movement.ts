import type { SurvivalDef } from '../data/schemas';

/** Параметры игрока из balance.json → player. */
export interface PlayerParams {
  stamina: number;
  speedTilesPerSec: number;
  sprintMul: number;
  dodgeIFramesSec: number;
  dodgeStamina: number;
}

export interface MoveInput {
  /** Направление движения, длина 0…1 (стик может быть отклонён не до конца). */
  x: number;
  y: number;
  sprint: boolean;
  /** Нажали перекат в этом тике. */
  dodge: boolean;
}

export interface MoveState {
  stamina: number;
  /** Перекат: сколько осталось и направление. */
  dodge: { left: number; dx: number; dy: number } | null;
  /** Неуязвимость, с. */
  iframes: number;
  /** Сколько прошло с последней траты выносливости, с. */
  sinceStaminaUse: number;
  /** Последнее направление (для переката с места). */
  faceX: number;
  faceY: number;
  /** Бег уже идёт — продолжается, пока выносливость > 0 (порог minStaminaToSprint — только для старта). */
  sprintingHold: boolean;
}

export interface MoveResult {
  dx: number;
  dy: number;
  sprinting: boolean;
  dodging: boolean;
  /** Перекат начался в этом тике. */
  dodgeStarted: boolean;
}

export function createMoveState(p: PlayerParams): MoveState {
  return {
    stamina: p.stamina,
    dodge: null,
    iframes: 0,
    sinceStaminaUse: 99,
    faceX: 1,
    faceY: 0,
    sprintingHold: false,
  };
}

/**
 * Шаг движения героя (в клетках) за dt: бег тратит выносливость, перекат — рывок на dodgeDistance
 * с неуязвимостью, замедления — множителем speedMul (местность, холод, перелом).
 * canSprint=false — например, жажда на нуле.
 */
export function stepMovement(
  st: MoveState,
  input: MoveInput,
  p: PlayerParams,
  m: SurvivalDef['movement'],
  speedMul: number,
  canSprint: boolean,
  dt: number,
): MoveResult {
  st.iframes = Math.max(0, st.iframes - dt);
  st.sinceStaminaUse += dt;
  const len = Math.min(1, Math.hypot(input.x, input.y));
  if (len > 0.05) {
    st.faceX = input.x / Math.hypot(input.x, input.y);
    st.faceY = input.y / Math.hypot(input.x, input.y);
  }

  let dodgeStarted = false;
  if (input.dodge && !st.dodge && st.stamina >= p.dodgeStamina) {
    st.stamina -= p.dodgeStamina;
    st.sinceStaminaUse = 0;
    st.dodge = { left: m.dodgeDurationSec, dx: st.faceX, dy: st.faceY };
    st.iframes = p.dodgeIFramesSec;
    dodgeStarted = true;
  }
  if (st.dodge) {
    const step = Math.min(dt, st.dodge.left);
    const v = m.dodgeDistanceTiles / m.dodgeDurationSec;
    const r: MoveResult = {
      dx: st.dodge.dx * v * step,
      dy: st.dodge.dy * v * step,
      sprinting: false,
      dodging: true,
      dodgeStarted,
    };
    st.dodge.left -= step;
    if (st.dodge.left <= 1e-9) st.dodge = null;
    return r;
  }

  const wantsSprint =
    input.sprint && len > 0.05 && canSprint && st.stamina >= (st.sprintingHold ? 0.01 : m.minStaminaToSprint);
  st.sprintingHold = wantsSprint;
  if (wantsSprint) {
    st.stamina = Math.max(0, st.stamina - m.sprintStaminaPerSec * dt);
    st.sinceStaminaUse = 0;
  } else if (st.sinceStaminaUse >= m.staminaRegenDelaySec) {
    st.stamina = Math.min(p.stamina, st.stamina + m.staminaRegenPerSec * dt);
  }
  const speed = p.speedTilesPerSec * (wantsSprint ? p.sprintMul : 1) * speedMul * len;
  const n = len > 0 ? Math.hypot(input.x, input.y) : 1;
  return {
    dx: (input.x / n) * speed * dt,
    dy: (input.y / n) * speed * dt,
    sprinting: wantsSprint,
    dodging: false,
    dodgeStarted,
  };
}
