import { keys, type Pose } from './Pose';

/**
 * Анимации гуманоида по rigs.json → humanoid.animations. Углы в градусах по часовой стрелке (как в Phaser):
 * у висящей вниз конечности отрицательный угол выносит её вперёд (вправо — персонаж смотрит вправо).
 * Длительности — из rigs.json (loopSec / durSec), здесь только форма движения.
 */
export type AnimName =
  | 'idle'
  | 'walk'
  | 'run'
  | 'attack_slash'
  | 'attack_blunt'
  | 'attack_pierce'
  | 'shoot'
  | 'throw'
  | 'gather'
  | 'gather_dig'
  | 'gather_wrench'
  | 'gather_knife'
  | 'dodge'
  | 'hurt'
  | 'death';

export interface AnimSpec {
  /** Длительность цикла/анимации, с. */
  dur: number;
  loop: boolean;
  /** Хит-кадр (доля длительности) — событие в логику. */
  hitAt?: number;
  pose(t: number): Pose;
}

const TAU = Math.PI * 2;

function walkPose(phase: number, amp: number, lean: number): Pose {
  const s = Math.sin(phase * TAU);
  const c = Math.cos(phase * TAU);
  // Голень сгибается назад, когда нога идёт вперёд (занос).
  const shin = (x: number) => Math.max(0, x) * 30 * amp;
  return {
    root: { dy: -0.015 * Math.abs(c) * amp },
    bones: {
      leg_near_upper: { rot: -25 * s * amp },
      leg_far_upper: { rot: 25 * s * amp },
      leg_near_lower: { rot: shin(s) },
      leg_far_lower: { rot: shin(-s) },
      arm_near_upper: { rot: 20 * s * amp },
      arm_far_upper: { rot: -20 * s * amp },
      arm_near_lower: { rot: -10 * amp },
      arm_far_lower: { rot: -10 * amp },
      torso: { rot: lean },
      head: { rot: -lean * 0.5 },
    },
  };
}

/** Удар сверху: замах вперёд-вверх над головой → удар вниз перед собой → возврат (без полного оборота руки). */
function overhead(windup: number, strike: number, torso: number): (t: number) => Pose {
  return (t) => ({
    bones: {
      arm_near_upper: {
        // Замах вперёд-вверх над головой, удар вниз перед собой, возврат (без полного оборота руки).
        rot: keys(t, [
          [0, 0],
          [0.4, -windup],
          [0.55, -strike],
          [1, 0],
        ]),
      },
      arm_near_lower: {
        rot: keys(t, [
          [0, 0],
          [0.4, -40],
          [0.55, -10],
          [1, 0],
        ]),
      },
      arm_far_upper: {
        rot: keys(t, [
          [0, 0],
          [0.4, 15],
          [0.55, -25],
          [1, 0],
        ]),
      },
      torso: {
        rot: keys(t, [
          [0, 0],
          [0.4, -torso],
          [0.55, torso],
          [1, 0],
        ]),
      },
      head: {
        rot: keys(t, [
          [0, 0],
          [0.4, -3],
          [0.55, 4],
          [1, 0],
        ]),
      },
    },
    swaps: { forearm: 'fist' },
  });
}

export function humanoidAnims(
  src: Record<string, { loopSec?: number; durSec?: number }>,
): Record<AnimName, AnimSpec> {
  const d = (n: string, def: number) => src[n]?.loopSec ?? src[n]?.durSec ?? def;
  return {
    idle: {
      dur: d('idle', 2),
      loop: true,
      pose: (t) => {
        const s = Math.sin(t * TAU);
        return {
          bones: {
            torso: { dy: -0.01 * s, sy: 1 + 0.012 * s },
            head: { rot: 2 * Math.sin(t * TAU + 1) },
            arm_near_upper: { rot: 3 * s },
            arm_far_upper: { rot: -3 * s },
          },
        };
      },
    },
    walk: { dur: d('walk', 0.7), loop: true, pose: (t) => walkPose(t, 1, 2) },
    run: { dur: d('run', 0.45), loop: true, pose: (t) => walkPose(t, 1.5, 8) },
    attack_slash: { dur: d('attack_slash', 0.35), loop: false, hitAt: 0.55, pose: overhead(150, 55, 6) },
    attack_blunt: { dur: d('attack_blunt', 0.45), loop: false, hitAt: 0.55, pose: overhead(165, 45, 8) },
    attack_pierce: {
      dur: d('attack_pierce', 0.3),
      loop: false,
      hitAt: 0.55,
      pose: (t) => ({
        bones: {
          arm_near_upper: {
            rot: keys(t, [
              [0, 0],
              [0.35, 20],
              [0.55, -70],
              [1, 0],
            ]),
            dx: keys(t, [
              [0, 0],
              [0.55, 0.08],
              [1, 0],
            ]),
          },
          arm_near_lower: {
            rot: keys(t, [
              [0, 0],
              [0.35, -60],
              [0.55, -5],
              [1, 0],
            ]),
          },
          torso: {
            rot: keys(t, [
              [0, 0],
              [0.55, 6],
              [1, 0],
            ]),
          },
        },
        swaps: { forearm: 'fist' },
      }),
    },
    shoot: {
      dur: d('shoot', 0.15),
      loop: false,
      hitAt: 0.2,
      pose: (t) => ({
        bones: {
          arm_near_upper: { rot: -80 },
          arm_far_upper: { rot: -75 },
          arm_near_lower: { rot: -5 },
          arm_far_lower: { rot: -5 },
          held_item: {
            dx: keys(t, [
              [0, 0],
              [0.2, -0.03],
              [1, 0],
            ]),
          },
        },
        swaps: { forearm: 'fist' },
      }),
    },
    throw: {
      dur: 0.45,
      loop: false,
      hitAt: 0.55,
      pose: (t) => ({
        bones: {
          arm_near_upper: {
            rot:
              keys(t, [
                [0, 0],
                [0.4, 160],
                [0.55, 250],
                [1, 360],
              ]) % 360,
          },
          arm_near_lower: {
            rot: keys(t, [
              [0, 0],
              [0.4, -60],
              [0.6, 0],
              [1, 0],
            ]),
          },
          torso: {
            rot: keys(t, [
              [0, 0],
              [0.4, -8],
              [0.6, 8],
              [1, 0],
            ]),
          },
        },
      }),
    },
    // Добыча по инструменту (ANIMATIONS §1): рубка сверху, копание вниз, ключ — вращение предплечья, нож — короткие удары.
    gather: { dur: d('gather', 0.6), loop: true, hitAt: 0.55, pose: overhead(160, 35, 6) },
    gather_dig: {
      dur: d('gather', 0.6),
      loop: true,
      hitAt: 0.55,
      pose: (t) => ({
        bones: {
          arm_near_upper: {
            rot: keys(t, [
              [0, -20],
              [0.4, -110],
              [0.55, -30],
              [1, -20],
            ]),
          },
          arm_far_upper: {
            rot: keys(t, [
              [0, -15],
              [0.4, -100],
              [0.55, -25],
              [1, -15],
            ]),
          },
          torso: {
            rot: keys(t, [
              [0, 10],
              [0.4, -4],
              [0.55, 18],
              [1, 10],
            ]),
          },
        },
        swaps: { forearm: 'fist' },
      }),
    },
    gather_wrench: {
      dur: d('gather', 0.6),
      loop: true,
      hitAt: 0.5,
      pose: (t) => ({
        bones: {
          arm_near_upper: { rot: -70 },
          arm_near_lower: { rot: 40 * Math.sin(t * TAU) },
          torso: { rot: 6 },
        },
        swaps: { forearm: 'fist' },
      }),
    },
    gather_knife: {
      dur: d('gather', 0.6) / 2,
      loop: true,
      hitAt: 0.5,
      pose: (t) => ({
        bones: {
          arm_near_upper: {
            rot: keys(t, [
              [0, -40],
              [0.5, -75],
              [1, -40],
            ]),
          },
          arm_near_lower: {
            rot: keys(t, [
              [0, -30],
              [0.5, 10],
              [1, -30],
            ]),
          },
          torso: { rot: 10 },
        },
        swaps: { forearm: 'fist' },
      }),
    },
    // Кувырок: корень делает полный оборот вокруг центра тела.
    dodge: {
      dur: d('dodge', 0.35),
      loop: false,
      pose: (t) => ({
        root: { rot: 360 * t, pivotY: -0.45, dy: -0.06 * Math.sin(t * Math.PI) },
        bones: {
          leg_near_upper: { rot: -70 * Math.sin(t * Math.PI) },
          leg_far_upper: { rot: -60 * Math.sin(t * Math.PI) },
          leg_near_lower: { rot: 90 * Math.sin(t * Math.PI) },
          leg_far_lower: { rot: 90 * Math.sin(t * Math.PI) },
          arm_near_upper: { rot: -60 * Math.sin(t * Math.PI) },
          torso: { rot: 25 * Math.sin(t * Math.PI) },
        },
      }),
    },
    hurt: {
      dur: d('hurt', 0.2),
      loop: false,
      pose: (t) => ({
        bones: {
          torso: { rot: -8 * Math.sin(t * Math.PI) },
          head: { rot: -10 * Math.sin(t * Math.PI) },
          arm_near_upper: { rot: 15 * Math.sin(t * Math.PI) },
        },
        swaps: { head: 'hurt' },
      }),
    },
    // Смерть: падение навзничь (поворот корня вокруг стоп до 90°) и опускание на землю.
    death: {
      dur: d('death', 0.6),
      loop: false,
      pose: (t) => {
        const k = keys(t, [
          [0, 0],
          [1, 1],
        ]);
        return {
          root: { rot: -90 * k, dy: 0.04 * k },
          bones: {
            arm_near_upper: { rot: -40 * k },
            arm_far_upper: { rot: -30 * k },
            head: { rot: -15 * k },
            leg_near_lower: { rot: 10 * k },
          },
          swaps: { head: 'hurt' },
        };
      },
    },
  };
}
