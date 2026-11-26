// Run with the workspace's tsx. The argument selects an extracted or working source tree.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HouseRules } from '../../../packages/shared/src/types.js';

const tree = resolve(process.argv[2] ?? '.');
const source = (path: string) => pathToFileURL(resolve(tree, 'packages/shared/src', path)).href;
const { createUnoGame } = await import(source('games/uno/runtime.ts'));
const { DEFAULT_ROOM_SETTINGS } = await import(source('types.ts'));

const profiles: Record<string, Partial<HouseRules>> = {
  firstOut: { finishAll: false },
  ranked: { finishAll: true },
  ranked07: { finishAll: true, zeroRotateHands: true, sevenSwapHands: true },
};
const difficulties = ['novice', 'easy', 'normal', 'hard'];
const seats = difficulties.map((_, i) => ({ seatIndex: i * 2, key: String(i), name: String(i), isBot: true }));
const maxActions = 2000;
const now = Date.now;
const random = Math.random;

function replay(seed: number, rules: Partial<HouseRules>) {
  let step = 0;
  let state = seed;
  Math.random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  Date.now = () => 1750000000000 + step * 100;
  const game = createUnoGame(seats, {
    ...DEFAULT_ROOM_SETTINGS,
    houseRules: { ...DEFAULT_ROOM_SETTINGS.houseRules, ...rules },
  });
  game.startRound();
  let lastAction = null;
  for (; step <= maxActions; step++) {
    const view = game.gameView(-1);
    const ranks: number[] = view.finishOrder;
    const fail = (reason: string) => ({ seed, step, ok: false, reason, current: view.current, phase: view.phase, ranks: [...ranks], counts: view.cardCounts, lastAction, lastEvent: view.lastEvent?.type });
    if (new Set(ranks).size !== ranks.length) return fail('duplicate_rank');
    if (ranks.some(i => view.cardCounts[i] !== 0)) return fail('ranked_seat_has_cards');
    if (view.phase === 'match_over') {
      if (rules.finishAll && ranks.length !== seats.length - 1) return fail('incomplete_ranking');
      return { seed, step, ok: true };
    }
    // An outgoing wild may still need its owner to choose a color.
    if (view.phase !== 'choose_color' && ranks.includes(view.current)) return fail('ranked_seat_owns_turn');
    if (step === maxActions) return fail('step_limit');
    const seat = game.schedule().thinkSeats[0];
    const difficulty = difficulties[(seats.findIndex(p => p.seatIndex === seat) + seed) % difficulties.length];
    const action = game.decideBot(seat, difficulty);
    if (!action) return fail('missing_action');
    lastAction = { seat, action };
    const result = game.apply(seat, action);
    if (!result.ok) return fail('rejected_' + action.type);
  }
}

const suites = [];
try {
  for (const [profile, rules] of Object.entries(profiles)) {
    const runs = Array.from({ length: 64 }, (_, i) => replay(i + 1, rules)!);
    suites.push({ profile, rules, completed: runs.filter(run => run.ok).length, total: runs.length, runs });
  }
} finally {
  Date.now = now;
  Math.random = random;
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, maxActions, seats: seats.map(p => p.seatIndex), difficulties, suites }, null, 2));
if (suites.some(suite => suite.completed < suite.total)) process.exitCode = 1;
