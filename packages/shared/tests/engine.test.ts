import { describe, it, expect } from 'vitest';
import { UnoGame, cardMatches, wildDrawFourLegal } from '../src/index.js';
import { DEFAULT_ROOM_SETTINGS, type Card, type HouseRules, type RoomSettings } from '../src/index.js';

function seats(n: number) {
  return Array.from({ length: n }, (_, i) => ({ seatIndex: i, key: `p${i}`, name: `P${i}`, isBot: false }));
}

function settings(patch: Partial<RoomSettings> = {}, rules: Partial<HouseRules> = {}): RoomSettings {
  return { ...DEFAULT_ROOM_SETTINGS, ...patch, houseRules: { ...DEFAULT_ROOM_SETTINGS.houseRules, ...rules } };
}

/** 固定 rng 的可控游戏：手动构造牌面 */
function makeGame(n = 3, s = settings()) {
  const g = new UnoGame(seats(n), s, () => 0.42);
  return g;
}

const num = (id: number, color: Card['color'], value: number): Card => ({ id, color, kind: 'number', value });
const act = (id: number, color: Card['color'], kind: Card['kind']): Card => ({ id, color, kind });

describe('cardMatches', () => {
  const top = num(1, 'red', 7);
  it('matches color', () => {
    expect(cardMatches(num(2, 'red', 3), top, 'red')).toBe(true);
    expect(cardMatches(num(3, 'blue', 3), top, 'red')).toBe(false);
  });
  it('matches number/symbol', () => {
    expect(cardMatches(num(4, 'blue', 7), top, 'red')).toBe(true);
    expect(cardMatches(act(5, 'blue', 'skip'), act(6, 'red', 'skip'), 'red')).toBe(true);
  });
  it('wild always matches', () => {
    expect(cardMatches(act(7, null, 'wild'), top, 'red')).toBe(true);
    expect(cardMatches(act(8, null, 'wild_draw_four'), top, 'red')).toBe(true);
  });
});

describe('wildDrawFourLegal', () => {
  it('illegal when holding same-color card', () => {
    const hand = [num(1, 'red', 5), act(2, null, 'wild_draw_four')];
    expect(wildDrawFourLegal(hand.filter(c => c.kind !== 'wild_draw_four'), 'red')).toBe(false);
  });
  it('legal when only matching number of other color', () => {
    const hand = [num(1, 'blue', 5), act(3, null, 'wild')];
    expect(wildDrawFourLegal(hand, 'red')).toBe(true);
  });
});

describe('startRound', () => {
  it('deals 7 cards each and flips a non-+4 top', () => {
    const g = makeGame(3);
    g.startRound();
    expect(g.state.hands.every(h => h.cards.length === 7)).toBe(true);
    expect(g.state.discard.length).toBe(1);
    expect(g.state.discard[0].kind).not.toBe('wild_draw_four');
    expect(g.state.deck.length + g.state.discard.length + g.state.hands.flatMap(h => h.cards).length).toBe(108);
  });
});

describe('play/draw/uno flow', () => {
  function riggedGame(rules: Partial<HouseRules> = {}) {
    const g = makeGame(3, settings({}, rules));
    g.startRound();
    // 直接操纵状态以构造局面
    const s = g.state;
    s.hands[0].cards = [num(1, 'red', 5), num(2, 'blue', 3)];
    s.hands[1].cards = [num(3, 'red', 7), num(4, 'green', 1), num(5, 'yellow', 9)];
    s.hands[2].cards = [num(6, 'green', 5), act(7, 'blue', 'skip')];
    s.discard = [num(0, 'red', 2)];
    s.activeColor = 'red';
    s.current = 0;
    s.phase = 'play';
    s.deck = [num(100, 'yellow', 1), num(101, 'red', 1), num(102, 'green', 9)];
    return g;
  }

  it('plays a matching card and advances', () => {
    const g = riggedGame();
    expect(g.play(0, [1]).ok).toBe(true);
    expect(g.state.current).toBe(1);
    expect(g.state.discard.at(-1)!.id).toBe(1);
  });

  it('rejects non-matching card', () => {
    const g = riggedGame();
    expect(g.play(0, [2]).ok).toBe(false); // blue 3 vs red 2
  });

  it('draw gives only the drawn card as playable', () => {
    const g = riggedGame();
    expect(g.draw(0).ok).toBe(true);
    // deck.pop() = green 9 — 不匹配 red 2 → 回合直接过
    expect(g.state.current).toBe(1);
  });

  it('draw then can play drawn card only', () => {
    const g = riggedGame();
    g.state.deck = [num(102, 'red', 9)]; // 摸 red 9 — 可出
    expect(g.draw(0).ok).toBe(true);
    expect(g.state.drewThisTurn?.id).toBe(102);
    expect(g.play(0, [1]).ok).toBe(false); // 不能出原来的
    expect(g.play(0, [102]).ok).toBe(true);
  });

  it('skip card skips next player', () => {
    const g = riggedGame();
    g.state.hands[0].cards = [act(10, 'red', 'skip'), num(8, 'blue', 2)];
    expect(g.play(0, [10]).ok).toBe(true);
    expect(g.state.current).toBe(2);
  });

  it('reverse flips direction; 2-player acts as skip', () => {
    const g = makeGame(2, settings());
    g.startRound();
    const s = g.state;
    s.hands[0].cards = [act(10, 'red', 'reverse'), num(1, 'red', 1)];
    s.hands[1].cards = [num(2, 'blue', 3)];
    s.discard = [num(0, 'red', 2)];
    s.activeColor = 'red';
    s.current = 0;
    s.phase = 'play';
    expect(g.play(0, [10]).ok).toBe(true);
    expect(g.state.direction).toBe(-1);
    expect(g.state.current).toBe(0); // 2人局反转=再来一次
  });

  it('draw_two makes next draw 2 and skip', () => {
    const g = riggedGame();
    g.state.hands[0].cards = [act(11, 'red', 'draw_two'), num(8, 'blue', 2)];
    expect(g.play(0, [11]).ok).toBe(true);
    // 无叠加村规 → 立即结算
    expect(g.state.hands[1].cards.length).toBe(3 + 2);
    expect(g.state.current).toBe(2);
  });

  it('stacking: target can counter +2', () => {
    const g = riggedGame({ stackDrawTwo: true });
    g.state.hands[0].cards = [act(11, 'red', 'draw_two'), num(8, 'blue', 2)];
    g.state.hands[1].cards = [act(12, 'green', 'draw_two'), num(4, 'green', 1)];
    expect(g.play(0, [11]).ok).toBe(true);
    expect(g.state.current).toBe(1);
    expect(g.state.pendingDraw?.count).toBe(2);
    expect(g.play(1, [12]).ok).toBe(true);
    // seat2 不能反制 → 立即结算摸4跳过
    expect(g.state.hands[2].cards.length).toBe(2 + 4);
    expect(g.state.current).toBe(0);
  });
});

describe('wild + draw four', () => {
  it('wild chooses color', () => {
    const g = makeGame(3, settings());
    g.startRound();
    const s = g.state;
    s.hands[0].cards = [act(20, null, 'wild'), num(1, 'blue', 3)];
    s.discard = [num(0, 'red', 2)];
    s.activeColor = 'red';
    s.current = 0;
    s.phase = 'play';
    expect(g.play(0, [20], 'green').ok).toBe(true);
    expect(g.state.activeColor).toBe('green');
  });

  it('+4 illegal when holding same color → rejected outright', () => {
    const g = makeGame(3, settings());
    g.startRound();
    const s = g.state;
    s.hands[0].cards = [act(21, null, 'wild_draw_four'), num(1, 'red', 3)]; // 有 red → 非法
    s.discard = [num(0, 'red', 2)];
    s.activeColor = 'red';
    s.current = 0;
    s.phase = 'play';
    expect(g.play(0, [21], 'blue').ok).toBe(false);
  });

  it('+4 challenge: legal play, challenger draws 6', () => {
    const g = makeGame(3, settings());
    g.startRound();
    const s = g.state;
    s.hands[0].cards = [act(21, null, 'wild_draw_four'), num(1, 'blue', 3)]; // 无 red → 合法
    s.hands[1].cards = [num(2, 'green', 1), num(3, 'yellow', 2)];
    s.discard = [num(0, 'red', 2)];
    s.activeColor = 'red';
    s.current = 0;
    s.phase = 'play';
    expect(g.play(0, [21], 'blue').ok).toBe(true);
    expect(g.state.phase).toBe('challenge');
    expect(g.respondChallenge(1, true).ok).toBe(true);
    expect(g.state.hands[1].cards.length).toBe(2 + 6);
    expect(g.state.current).toBe(2); // 质疑者跳过
  });

  it('+4 challenge: illegal play caught, player draws 4', () => {
    const g = makeGame(3, settings());
    g.startRound();
    const s = g.state;
    // 手动绕过 play 校验，模拟已打出的非法 +4（比如服务端老版本允许的情况）
    s.hands[0].cards = [num(1, 'red', 3)]; // 打出后剩 red → 非法
    s.hands[1].cards = [num(2, 'green', 1), num(3, 'yellow', 2)];
    s.discard = [num(0, 'red', 2), act(21, null, 'wild_draw_four')];
    s.activeColor = 'blue';
    s.current = 1;
    s.phase = 'challenge';
    s.challenge = { challengerSeat: 1, playedBySeat: 0, deadline: Date.now() + 9999 } as any;
    (s.challenge as any).prevColor = 'red';
    s.pendingDraw = { count: 4, kind: 'wild_draw_four' };
    expect(g.respondChallenge(1, true).ok).toBe(true);
    expect(g.state.hands[0].cards.length).toBe(1 + 4);
    expect(g.state.current).toBe(1); // 质疑者拿回回合
  });

  it('noChallenge: +4 draws 4 immediately', () => {
    const g = makeGame(3, settings({}, { noChallenge: true }));
    g.startRound();
    const s = g.state;
    s.hands[0].cards = [act(21, null, 'wild_draw_four'), num(1, 'blue', 3)];
    s.hands[1].cards = [num(2, 'green', 1)];
    s.discard = [num(0, 'red', 2)];
    s.activeColor = 'red';
    s.current = 0;
    s.phase = 'play';
    expect(g.play(0, [21], 'blue').ok).toBe(true);
    expect(g.state.hands[1].cards.length).toBe(1 + 4);
    expect(g.state.current).toBe(2);
  });
});

describe('uno call & penalty', () => {
  it('marks vulnerable at 1 card, catch penalizes', () => {
    const g = makeGame(3, settings());
    g.startRound();
    const s = g.state;
    s.hands[0].cards = [num(1, 'red', 5), num(2, 'red', 6)];
    s.hands[1].cards = [num(3, 'green', 1), num(4, 'yellow', 2)];
    s.discard = [num(0, 'red', 2)];
    s.activeColor = 'red';
    s.current = 0;
    s.phase = 'play';
    expect(g.play(0, [1]).ok).toBe(true);
    expect(s.unoVulnerable[0]).toBeTruthy();
    const before = s.hands[0].cards.length;
    expect(g.catchUno(1, 0).ok).toBe(true);
    expect(s.hands[0].cards.length).toBe(before + 2);
  });

  it('calling uno prevents catch', () => {
    const g = makeGame(3, settings());
    g.startRound();
    const s = g.state;
    s.hands[0].cards = [num(1, 'red', 5), num(2, 'red', 6)];
    s.discard = [num(0, 'red', 2)];
    s.activeColor = 'red';
    s.current = 0;
    s.phase = 'play';
    g.play(0, [1]);
    g.uno(0);
    expect(g.catchUno(1, 0).ok).toBe(false);
  });
});

describe('house rules', () => {
  it('0 rotates hands', () => {
    const g = makeGame(3, settings({}, { zeroRotateHands: true }));
    g.startRound();
    const s = g.state;
    s.hands[0].cards = [num(1, 'red', 0), num(9, 'blue', 1)];
    s.hands[1].cards = [num(3, 'green', 1)];
    s.hands[2].cards = [num(4, 'yellow', 2), num(5, 'yellow', 3)];
    s.discard = [num(0, 'red', 2)];
    s.activeColor = 'red';
    s.current = 0;
    s.phase = 'play';
    g.play(0, [1]);
    expect(s.hands[1].cards.map(c => c.id)).toContain(9); // seat0 手牌顺时针传给 seat1
    expect(s.hands[2].cards.map(c => c.id)).toContain(3); // seat1 传给 seat2
    expect(s.hands[0].cards.map(c => c.id)).toEqual([4, 5]); // seat2 传给 seat0
  });

  it('7 swaps hands with target', () => {
    const g = makeGame(3, settings({}, { sevenSwapHands: true }));
    g.startRound();
    const s = g.state;
    s.hands[0].cards = [num(1, 'red', 7), num(9, 'blue', 1)];
    s.hands[2].cards = [num(4, 'yellow', 2), num(5, 'yellow', 3), num(6, 'green', 4)];
    s.discard = [num(0, 'red', 2)];
    s.activeColor = 'red';
    s.current = 0;
    s.phase = 'play';
    g.play(0, [1]);
    expect(s.phase).toBe('swap_target');
    g.chooseSwapTarget(0, 2);
    expect(s.hands[0].cards.length).toBe(3);
    expect(s.hands[2].cards.map(c => c.id)).toEqual([9]);
  });

  it('jump-in plays out of turn', () => {
    const g = makeGame(3, settings({}, { jumpIn: true }));
    g.startRound();
    const s = g.state;
    s.hands[0].cards = [num(3, 'green', 1)];
    s.hands[2].cards = [num(1, 'red', 5), num(4, 'yellow', 2)];
    s.discard = [num(0, 'red', 5)];
    s.activeColor = 'red';
    s.current = 0;
    s.phase = 'play';
    expect(g.play(2, [1]).ok).toBe(true); // 抢出相同 red5
    expect(g.state.current).toBe(0); // 轮到抢出者的下家=0
  });

  it('drawUntilPlayable keeps drawing', () => {
    const g = makeGame(3, settings({}, { drawUntilPlayable: true }));
    g.startRound();
    const s = g.state;
    s.hands[0].cards = [num(2, 'blue', 3)];
    s.discard = [num(0, 'red', 2)];
    s.activeColor = 'red';
    s.current = 0;
    s.phase = 'play';
    s.deck = [num(50, 'red', 1), num(51, 'green', 3), num(52, 'green', 8)]; // pop: green8, green3, red1 → 第三张可出
    g.draw(0);
    expect(s.hands[0].cards.length).toBe(1 + 3);
    expect(s.drewThisTurn?.id).toBe(50);
  });
});

describe('round end & scoring', () => {
  it('ends round and computes points', () => {
    const g = makeGame(3, settings({ targetScore: 0 }, { finishAll: false }));
    g.startRound();
    const s = g.state;
    s.hands[0].cards = [num(1, 'red', 5)];
    s.hands[1].cards = [num(3, 'green', 9), act(4, 'blue', 'skip')];
    s.hands[2].cards = [act(5, null, 'wild')];
    s.discard = [num(0, 'red', 2)];
    s.activeColor = 'red';
    s.current = 0;
    s.phase = 'play';
    g.play(0, [1]);
    expect(s.phase).toBe('match_over'); // targetScore=0 → 单轮
    const rp = g.roundPoints();
    expect(rp!.points).toBe(9 + 20 + 50);
  });

  it('last card +4 still draws before scoring', () => {
    const g = makeGame(3, settings({ targetScore: 0 }, { noChallenge: true, finishAll: false }));
    g.startRound();
    const s = g.state;
    s.hands[0].cards = [act(21, null, 'wild_draw_four')];
    s.hands[1].cards = [num(3, 'green', 9)];
    s.discard = [num(0, 'red', 2)];
    s.activeColor = 'red';
    s.current = 0;
    s.phase = 'play';
    g.play(0, [21], 'blue');
    expect(s.hands[1].cards.length).toBe(1 + 4);
    const rp = g.roundPoints();
    expect(rp!.seat).toBe(0);
    expect(rp!.points).toBeGreaterThan(9);
  });

  it('finishAll: 3人局出完继续直到只剩一人', () => {
    const g = makeGame(3, settings({ targetScore: 0 }, { noChallenge: true }));
    g.startRound();
    const s = g.state;
    s.hands[0].cards = [num(1, 'red', 5)];
    s.hands[1].cards = [num(3, 'red', 9)];
    s.hands[2].cards = [act(5, null, 'wild'), num(6, 'red', 2), num(7, 'green', 1)];
    s.discard = [num(0, 'red', 2)];
    s.activeColor = 'red';
    s.current = 0;
    s.phase = 'play';
    g.play(0, [1]);
    // 第一人出完 → 游戏继续，记名次
    expect(s.phase).toBe('play');
    expect(s.finishOrder).toEqual([0]);
    // 当前轮到下一位存活玩家
    expect(s.current).toBe(1);
    // 让座位 2 出完（先轮到他，把他的回合放进来）
    s.current = 2;
    s.discard = [act(9, null, 'wild')];
    s.activeColor = 'green';
    s.hands[2].cards = [num(6, 'green', 2)];
    s.hands[1].cards = [num(3, 'red', 9), num(8, 'blue', 4)];
    g.play(2, [6]);
    // 只剩座位 1 → 整轮结束，赢家是第一个出完的
    expect(s.phase).toBe('match_over');
    expect(s.finishOrder).toEqual([0, 2]);
    const rp = g.roundPoints();
    expect(rp!.seat).toBe(0);
    expect(rp!.points).toBe(9 + 4);
  });
});
