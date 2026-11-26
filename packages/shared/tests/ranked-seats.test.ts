import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_SETTINGS, UnoGame, decideBotAction } from '../src/index.js';
import type { Card, HouseRules } from '../src/index.js';

const number = (id: number, value: number): Card => ({ id, value, kind: 'number', color: 'red' });
const reverse: Card = { id: 30, kind: 'reverse', color: 'red' };

function table(rules: Partial<HouseRules> = {}) {
  const seats = [1, 3, 6].map(seatIndex => ({ seatIndex, key: String(seatIndex), name: String(seatIndex), isBot: true }));
  const g = new UnoGame(seats, {
    ...DEFAULT_ROOM_SETTINGS,
    houseRules: { ...DEFAULT_ROOM_SETTINGS.houseRules, ...rules },
  }, () => 0.4);
  const s = g.state;
  s.hands[0].cards = [number(1, 2), number(2, 3)];
  s.hands[1].cards = [number(11, 4), number(12, 5)];
  s.hands[2].cards = [number(21, 6), number(22, 8)];
  s.discard = [number(0, 1)];
  s.current = 1;
  return g;
}

describe('排名赛的在场座位', () => {
  it('三人桌末张反转，逆序交给仍在场的人', () => {
    const g = table();
    g.state.hands[0].cards = [reverse];
    expect(g.play(1, [30]).ok).toBe(true);
    expect(g.state.finishOrder).toEqual([1]);
    expect(g.state.direction).toBe(-1);
    expect(g.state.current).toBe(6);
  });

  it('已有人出完，留下的两人打反转依旧可再行动', () => {
    const g = table();
    g.state.hands[0].cards = [];
    g.state.finishOrder = [1];
    g.state.current = 3;
    g.state.hands[1].cards.push(reverse);
    expect(g.play(3, [30]).ok).toBe(true);
    expect(g.state.current).toBe(3);
  });

  it.each([1, -1] as const)('按方向 %i 轮转时，已出完的人保持空手', direction => {
    const g = table({ zeroRotateHands: true });
    g.state.direction = direction;
    g.state.finishOrder = [1];
    g.state.hands[0].cards = [];
    g.state.current = 3;
    g.state.hands[1].cards.push(number(31, 0));
    expect(g.play(3, [31]).ok).toBe(true);
    expect(g.state.hands.map(h => h.cards.map(c => c.id))).toEqual([[], [21, 22], [11, 12]]);
    expect(g.state.current).toBe(6);
  });

  it('末张 7 先取得名次，下一位继续出牌', () => {
    const g = table({ sevenSwapHands: true });
    g.state.hands[0].cards = [number(31, 7)];
    expect(g.play(1, [31]).ok).toBe(true);
    expect(g.state.finishOrder).toEqual([1]);
    expect([g.state.phase, g.state.current]).toEqual(['play', 3]);
  });

  it('末张万能牌仍可分两步选色，交棒前保留上一张万能指定的颜色', () => {
    const g = table();
    g.state.activeColor = 'green';
    g.state.discard.push({ id: 45, kind: 'wild', color: null });
    g.state.hands[0].cards = [{ id: 46, kind: 'wild', color: null }];
    expect(g.play(1, [46]).ok).toBe(true);
    expect([g.state.phase, g.state.current, g.state.activeColor]).toEqual(['choose_color', 1, 'green']);
    expect(g.chooseColor(1, 'yellow').ok).toBe(true);
    expect([g.state.phase, g.state.current, g.state.activeColor]).toEqual(['play', 3, 'yellow']);
  });

  it('末张 +4 选色后把质疑权交给下家', () => {
    const g = table();
    g.state.hands[0].cards = [{ id: 46, kind: 'wild_draw_four', color: null }];
    expect(g.play(1, [46]).ok).toBe(true);
    expect(g.chooseColor(1, 'green').ok).toBe(true);
    expect([g.state.phase, g.state.current]).toEqual(['challenge', 3]);
    expect(g.state.pendingDraw?.count).toBe(4);
  });

  it('上张万能从红改绿，合法 +4 分步选色后的质疑仍按绿判罚', () => {
    const g = table();
    g.state.activeColor = 'green';
    g.state.discard.push({ id: 45, kind: 'wild', color: null });
    g.state.hands[0].cards.push({ id: 46, kind: 'wild_draw_four', color: null });
    g.state.deck = Array.from({ length: 6 }, (_, i) => number(60 + i, 9));
    expect(g.play(1, [46]).ok).toBe(true);
    expect(g.chooseColor(1, 'blue').ok).toBe(true);
    expect(g.respondChallenge(3, true).ok).toBe(true);
    expect(g.state.lastEvent?.type).toBe('challenge_lose');
    expect(g.state.hands.map(h => h.cards.length)).toEqual([2, 8, 2]);
  });

  it.each(['self', 'ranked', 'eliminated'] as const)('换手拒绝 %s 目标且保留选择窗口', target => {
    const g = table({ sevenSwapHands: true });
    g.state.hands[1].cards = [];
    if (target === 'eliminated') g.state.eliminated = [3];
    else g.state.finishOrder = [3];
    g.state.hands[0].cards.push(number(31, 7));
    g.play(1, [31]);
    const before = structuredClone(g.state);
    expect(g.chooseSwapTarget(1, target === 'self' ? 1 : 3).ok).toBe(false);
    expect(g.state).toEqual(before);
    expect(g.chooseSwapTarget(1, 6).ok).toBe(true);
    expect(g.state.hands[0].cards.map(c => c.id)).toEqual([21, 22]);
  });

  it.each(['novice', 'easy', 'normal', 'hard'] as const)('%s 只从仍在场的其他玩家中选择换手对象', difficulty => {
    const g = table({ sevenSwapHands: true });
    g.state.finishOrder = [3];
    g.state.hands[1].cards = [];
    g.state.hands[0].cards.push(number(31, 7));
    g.play(1, [31]);
    expect(decideBotAction(g, 1, difficulty, () => 0)).toEqual({ type: 'swap_target', targetSeat: 6 });
  });

  it('新一轮从仍在场的首位玩家开始，清除上一轮名次', () => {
    const g = table({ elimination: true });
    g.state.eliminated = [1];
    g.state.finishOrder = [3];
    g.startRound();
    expect(g.state.discard[0].kind).toBe('number');
    expect(g.state.current).toBe(3);
    expect(g.state.hands.map(h => h.cards.length)).toEqual([0, 7, 7]);
    expect(g.state.finishOrder).toEqual([]);
  });
});
