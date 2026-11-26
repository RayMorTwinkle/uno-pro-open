import { describe, it, expect } from 'vitest';
import { NimmtGame, bullheads, decideNimmtBot, suggestCard } from '../src/games/nimmt/engine.js';
import { createGame } from '../src/games/registry.js';
import { DEFAULT_ROOM_SETTINGS } from '../src/types.js';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ seatIndex: i, key: `p${i}`, name: `P${i}`, isBot: i > 0 }));
const rng = () => 0.42;

function newGame(n = 4) {
  const g = new NimmtGame(players(n), { ...DEFAULT_ROOM_SETTINGS, gameId: 'nimmt' }, rng);
  g.startRound();
  return g;
}

describe('bullheads', () => {
  it('official values', () => {
    expect(bullheads(1)).toBe(1);
    expect(bullheads(5)).toBe(2);
    expect(bullheads(10)).toBe(3);
    expect(bullheads(11)).toBe(5);
    expect(bullheads(55)).toBe(7);
    expect(bullheads(22)).toBe(5);
    expect(bullheads(33)).toBe(5);
    expect(bullheads(104)).toBe(1);
  });
});

describe('nimmt deal & pick', () => {
  it('deals 10 cards each + 4 row starters, no dupes', () => {
    const g = newGame(4);
    expect(g.state.hands.every(h => h.cards.length === 10)).toBe(true);
    expect(g.state.rows.every(r => r.length === 1)).toBe(true);
    const all = [...g.state.hands.flatMap(h => h.cards), ...g.state.rows.flat()];
    expect(new Set(all).size).toBe(44);
    expect(all.every(c => c >= 1 && c <= 104)).toBe(true);
  });

  it('pick removes from hand; double pick rejected; reveals when all picked', () => {
    const g = newGame(2);
    const c0 = g.state.hands[0].cards[3];
    const c1 = g.state.hands[1].cards[0];
    expect(g.pick(0, c0).ok).toBe(true);
    expect(g.state.hands[0].cards.length).toBe(9);
    expect(g.pick(0, g.state.hands[0].cards[0]).ok).toBe(false);
    expect(g.state.pickedSeats).toEqual([0]);
    expect(g.pick(1, c1).ok).toBe(true);
    // 全部选完 → 已结算
    expect(g.state.picks).toEqual({});
    expect(g.state.log.some(e => e.type === 'reveal')).toBe(true);
  });

  it('rejects card not in hand / wrong phase', () => {
    const g = newGame(2);
    expect(g.pick(0, 999).ok).toBe(false);
  });
});

describe('placement rules', () => {
  it('card goes to row with highest tail below it', () => {
    const g = newGame(2);
    g.state.rows = [[10], [20], [30], [40]];
    g.state.hands[0].cards = [25];
    g.state.hands[1].cards = [99];
    g.pick(0, 25); g.pick(1, 99);
    expect(g.state.rows[1]).toEqual([20, 25]); // 25 跟在行尾 20 后面
    expect(g.state.rows[3]).toEqual([40, 99]);
  });

  it('6th card eats the previous 5', () => {
    const g = newGame(2);
    g.state.rows = [[1, 2, 3, 4, 5], [10], [60], [90]];
    g.state.hands[0].cards = [6];
    g.state.hands[1].cards = [50];
    g.pick(0, 6); g.pick(1, 50);
    expect(g.state.rows[0]).toEqual([6]);
    expect(g.state.taken[0]).toEqual([1, 2, 3, 4, 5]);
    expect(g.state.log.some(e => e.type === 'take_five')).toBe(true);
    // 行2: [10,50]
    expect(g.state.rows[1]).toEqual([10, 50]);
  });

  it('lowest card below all tails → choose_row phase, takes selected row', () => {
    const g = newGame(2);
    g.state.rows = [[50], [60], [70], [80]];
    g.state.hands[0].cards = [5, 100];
    g.state.hands[1].cards = [90, 101];
    g.pick(0, 5); g.pick(1, 90);
    expect(g.state.phase).toBe('choose_row');
    expect(g.state.pendingRowChoice).toEqual({ seat: 0, card: 5 });
    // 90 还没结算（队列被 choose_row 打断）
    const r = g.chooseRow(0, 2);
    expect(r.ok).toBe(true);
    expect(g.state.taken[0]).toEqual([70]);
    expect(g.state.rows[2]).toEqual([5]);
    expect(g.state.rows[3]).toEqual([80, 90]); // 90 继续结算
    expect(g.state.phase).toBe('pick');
  });
});

describe('match end & timeout', () => {
  it('runs a full bot match to match_over with a winner', () => {
    const g = newGame(4);
    let guard = 0;
    while (g.state.phase !== 'match_over' && guard++ < 500) {
      let acted = false;
      for (const p of players(4)) {
        const a = decideNimmtBot(g, p.seatIndex, 'normal');
        if (a) {
          if (a.type === 'pick') g.pick(p.seatIndex, a.card as number);
          else if (a.type === 'choose_row') g.chooseRow(p.seatIndex, a.row as number);
          acted = true;
        }
      }
      if (!acted) g.timeoutTurn();
    }
    expect(g.state.phase).toBe('match_over');
    const end = g.state.log.find(e => e.type === 'match_end');
    expect(end?.detail?.winner).toBeTruthy();
    expect(g.state.hands.every(h => h.cards.length === 0)).toBe(true);
    expect(g.state.turn).toBe(10);
  });

  it('timeoutTurn auto-picks missing seats', () => {
    const g = newGame(2);
    g.pick(0, g.state.hands[0].cards[0]);
    g.timeoutTurn(30);
    expect(g.state.pickedSeats).toEqual([]);
    expect(g.state.hands[1].cards.length).toBe(9);
    expect(g.state.log.some(e => e.type === 'turn_timeout')).toBe(true);
  });

  it('timeoutTurn auto-chooses row in choose_row', () => {
    const g = newGame(2);
    g.state.rows = [[50], [60], [70], [80]];
    g.state.hands[0].cards = [5, 100];
    g.state.hands[1].cards = [90, 101];
    g.pick(0, 5); g.pick(1, 90);
    expect(g.state.phase).toBe('choose_row');
    g.timeoutTurn(30);
    expect(g.state.phase).toBe('pick');
    expect(g.state.taken[0]).toBeTruthy();
  });
});

describe('bot quality', () => {
  it('suggestCard avoids taking a 5-card row when possible', () => {
    const g = newGame(2);
    g.state.rows = [[1, 2, 3, 4, 5], [10], [60], [90]];
    g.state.hands[0].cards = [6, 95];
    const c = suggestCard(g, 0);
    expect(c).toBe(95); // 95 → 行4 (90)，安全
  });

  it('registry creates a working nimmt instance', () => {
    const inst = createGame('nimmt', players(3), { ...DEFAULT_ROOM_SETTINGS, gameId: 'nimmt' });
    inst.startRound();
    expect(inst.gameId).toBe('nimmt');
    const sched = inst.schedule();
    expect(sched.thinkSeats.length).toBe(3);
    expect(sched.deadline).toBeTruthy();
    const gv = inst.gameView(0);
    expect(gv.rows).toHaveLength(4);
    expect((gv.meHand as number[]).length).toBe(10);
  });
});
