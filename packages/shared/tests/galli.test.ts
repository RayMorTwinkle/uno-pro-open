import { describe, it, expect } from 'vitest';
import { GalliGame, buildDeck, FRUIT_ICON } from '../src/games/galli/engine.js';
import { createGame } from '../src/games/registry.js';
import { DEFAULT_ROOM_SETTINGS } from '../src/types.js';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ seatIndex: i, key: `p${i}`, name: `P${i}`, isBot: i > 0 }));
const mk = (n = 3) => new GalliGame(players(n), { ...DEFAULT_ROOM_SETTINGS, gameId: 'galli' });

describe('galli', () => {
  it('deck: 80 cards, 4 fruits × 5 counts × 4', () => {
    const d = buildDeck();
    expect(d.length).toBe(80);
    const sum = [0, 0, 0, 0];
    for (const c of d) sum[c.fruit] += c.count;
    expect(sum).toEqual([60, 60, 60, 60]);
    expect(FRUIT_ICON.length).toBe(4);
  });

  it('deals all cards evenly; flip only on own turn', () => {
    const g = mk(3);
    const total = Object.values(g.state.hands).reduce((a, h) => a + h.length, 0);
    expect(total).toBe(80);
    g.state.hands[0][0] = { fruit: 0, count: 2 }; // 避免首翻凑5开窗口的随机性
    expect(g.flip(1).ok).toBe(false);
    expect(g.flip(0).ok).toBe(true);
    expect(g.state.open[0].length).toBe(1);
    expect(g.state.current).toBe(1);
  });

  it('five-fruit opens slap window; correct slap takes all open cards', () => {
    const g = mk(2);
    // 摆牌：seat0 翻开 count5 香蕉 → 必开窗口
    g.state.hands[0] = [{ fruit: 0, count: 5 }, { fruit: 1, count: 2 }];
    g.state.hands[1] = [{ fruit: 1, count: 1 }, { fruit: 2, count: 2 }];
    g.state.current = 0;
    g.flip(0);
    expect(g.state.phase).toBe('slap_wait');
    expect(g.fiveFruit()).toBe(0);
    const r = g.slap(1);
    expect(r.ok).toBe(true);
    expect(g.state.open[0].length).toBe(0); // 明牌被收
    expect(g.state.hands[1].some(c => c.fruit === 0 && c.count === 5)).toBe(true);
    expect(g.state.phase).toBe('play');
    expect(g.state.lastSlap?.correct).toBe(true);
  });

  it('wrong slap pays 1 card to each alive player', () => {
    const g = mk(3);
    g.state.hands[0] = [{ fruit: 0, count: 1 }];
    g.state.hands[1] = [{ fruit: 1, count: 1 }, { fruit: 1, count: 1 }, { fruit: 1, count: 1 }];
    g.state.hands[2] = [{ fruit: 2, count: 2 }, { fruit: 2, count: 2 }];
    g.state.current = 0;
    g.flip(0); // 翻开 1 香蕉 → 无 5
    expect(g.state.phase).toBe('play');
    const before1 = g.state.hands[1].length, before2 = g.state.hands[2].length;
    g.slap(2); // seat2 没窗口乱拍
    expect(g.state.lastSlap?.correct).toBe(false);
    expect(g.state.hands[1].length).toBe(before1 + 1);
    // seat2 给 seat0+seat1 各 1 张 → 自己 -2 出光出局
    expect(g.state.hands[2].length).toBe(before2 - 2);
  });

  it('empty-hand player eliminated on their flip turn; match ends at ≤1 alive', () => {
    const g = mk(2);
    g.state.hands[0] = [{ fruit: 0, count: 1 }];
    g.state.hands[1] = [];
    g.state.open[1] = [];
    g.state.alive = [0, 1];
    g.state.current = 0;
    g.flip(0); // 翻完 checkEnd：seat1 无手牌无明牌 → 直接淘汰 → match_over
    expect(g.state.phase).toBe('match_over');
    const end = g.state.log.find(e => e.type === 'match_end');
    expect(end?.detail?.winner).toBe('p0');
  });

  it('botTick: window bots slap at scheduled times; full bot match converges', () => {
    const g = new GalliGame(players(4).map(p => ({ ...p, isBot: true })), { ...DEFAULT_ROOM_SETTINGS, gameId: 'galli' });
    let guard = 0;
    while (g.state.phase !== 'match_over' && guard++ < 5000) {
      g.botTick();
      // 时间快进：把所有预定时间拉到过去
      if (g.state.phase === 'slap_wait') for (const k of Object.keys(g.state.botSlapAt)) g.state.botSlapAt[+k] = Date.now() - 1;
      else g.state.flipDeadline = Date.now() - 1;
      if (guard % 500 === 0) g.state.windowUntil = Date.now() - 1;
    }
    expect(g.state.phase).toBe('match_over');
    const end = g.state.log.find(e => e.type === 'match_end');
    expect(end?.detail?.winner).toBeTruthy();
  });

  it('registry creates galli; view exposes openTop', () => {
    const inst = createGame('galli', players(3), { ...DEFAULT_ROOM_SETTINGS, gameId: 'galli' });
    const gv = inst.gameView(0) as Record<string, unknown>;
    expect(gv.game).toBe('galli');
    expect(gv.openTop).toBeTruthy();
    expect((inst.schedule().deadline?.at ?? 0) > 0).toBe(true);
  });
});
