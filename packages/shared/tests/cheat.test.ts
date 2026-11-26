import { describe, it, expect, vi } from 'vitest';
import { CheatGame, rankOf, decideCheatBot, suggestPlay, RANK_LABEL } from '../src/games/cheat/engine.js';
import { createGame } from '../src/games/registry.js';
import { DEFAULT_ROOM_SETTINGS } from '../src/types.js';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ seatIndex: i, key: `p${i}`, name: `P${i}`, isBot: i > 0 }));
const rng = () => 0.42;

function newGame(n = 4) {
  const g = new CheatGame(players(n), { ...DEFAULT_ROOM_SETTINGS, gameId: 'cheat' }, rng);
  g.startRound();
  return g;
}
const cardsOf = (g: CheatGame, seat: number) => g.state.hands.find(h => h.seatIndex === seat)!.cards;

describe('cheat deal & play', () => {
  it('deals all 52 cards, declared starts at A', () => {
    const g = newGame(4);
    const all = g.state.hands.flatMap(h => h.cards);
    expect(all.length).toBe(52);
    expect(new Set(all).size).toBe(52);
    expect(g.state.declared).toBe(1);
    expect(g.state.current).toBe(0);
  });

  it('play removes cards to pile and sets challenge window', () => {
    const g = newGame(3);
    const c = cardsOf(g, 0).filter(x => rankOf(x) === 1);
    if (c.length < 2) { cardsOf(g, 0).push(13, 26); }
    const r = g.play(0, cardsOf(g, 0).filter(x => rankOf(x) === 1).slice(0, 2));
    expect(r.ok).toBe(true);
    expect(g.state.pile.length).toBe(2);
    expect(g.state.lastPlay).toMatchObject({ seat: 0, rank: 1 });
    expect(g.state.lastPlay!.windowUntil).toBeGreaterThan(Date.now());
  });

  it('rejects wrong seat / bad count / missing cards', () => {
    const g = newGame(3);
    expect(g.play(1, [0]).ok).toBe(false);
    expect(g.play(0, []).ok).toBe(false);
    expect(g.play(0, [0, 1, 2, 3, 4]).ok).toBe(false);
    expect(g.play(0, [999]).ok).toBe(false);
  });

  it('next player playing during window closes it and advances rank', () => {
    const g = newGame(3);
    g.play(0, cardsOf(g, 0).slice(0, 1));
    g.play(1, cardsOf(g, 1).slice(0, 1));
    expect(g.state.declared).toBe(2);
    expect(g.state.current).toBe(2);
    expect(g.state.lastPlay!.seat).toBe(1);
  });
});

describe('cheat call & reveal', () => {
  it('call on honest play → caller takes the pile', () => {
    const g = newGame(3);
    if (!cardsOf(g, 0).some(x => rankOf(x) === 1)) cardsOf(g, 0).push(0); // 保底给一张 A
    const c = cardsOf(g, 0).filter(x => rankOf(x) === 1);
    g.play(0, c.slice(0, 1));
    const pileBefore = g.state.pile.length;
    const callerBefore = cardsOf(g, 1).length;
    const r = g.call(1);
    expect(r.ok).toBe(true);
    expect(cardsOf(g, 1).length).toBe(callerBefore + pileBefore);
    expect(g.state.pile.length).toBe(0);
    expect(g.state.log.some(e => e.type === 'reveal_honest')).toBe(true);
  });

  it('call on a lie → liar takes the pile back', () => {
    const g = newGame(3);
    const liarCard = cardsOf(g, 0).find(x => rankOf(x) !== 1)!;
    g.play(0, [liarCard]);
    const pileBefore = g.state.pile.length;
    const liarBefore = cardsOf(g, 0).length;
    g.call(2);
    expect(g.state.log.some(e => e.type === 'reveal_lie')).toBe(true);
    expect(cardsOf(g, 0).length).toBe(liarBefore + pileBefore);
  });

  it('cannot call own play or expired window', () => {
    const g = newGame(3);
    g.play(0, cardsOf(g, 0).slice(0, 1));
    expect(g.call(0).ok).toBe(false);
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 8000);
    expect(g.call(1).ok).toBe(false);
    vi.useRealTimers();
  });

  it('expired window auto-advances on next action check', () => {
    const g = newGame(3);
    g.play(0, cardsOf(g, 0).slice(0, 1));
    g.state.lastPlay!.windowUntil = Date.now() - 1;
    g.advanceIfIdle();
    expect(g.state.declared).toBe(2);
    expect(g.state.current).toBe(1);
  });
});

describe('cheat match flow', () => {
  it('empty hand marks finish; match_over when one remains', () => {
    const g = newGame(2);
    g.state.hands[0].cards = [rankOf(cardsOf(g, 0)[0]) === 1 ? cardsOf(g, 0)[0] : 0]; // 保留1张
    g.state.hands[1].cards = [5];
    g.state.pile = [];
    g.state.declared = rankOf(g.state.hands[0].cards[0]);
    const r = g.play(0, [g.state.hands[0].cards[0]]);
    expect(r.ok).toBe(true);
    expect(g.state.phase).toBe('match_over');
    expect(g.state.finished).toEqual([0]);
  });

  it('full bot match completes', () => {
    const g = newGame(4);
    let guard = 0;
    while (g.state.phase !== 'match_over' && guard++ < 4000) {
      let acted = false;
      for (const p of players(4)) {
        const a = decideCheatBot(g, p.seatIndex, 'normal');
        if (!a) continue;
        if (a.type === 'play') { const r = g.play(p.seatIndex, a.cardIds as number[]); acted = acted || r.ok; }
        else if (a.type === 'call') { const r = g.call(p.seatIndex); acted = acted || r.ok; }
      }
      if (!acted) {
        g.state.lastPlay && (g.state.lastPlay.windowUntil = 0);
        g.timeoutTurn();
        if (guard > 3500) break;
      }
    }
    expect(g.state.phase).toBe('match_over');
    const end = g.state.log.find(e => e.type === 'match_end');
    expect(end?.detail?.winner).toBeTruthy();
  });

  it('timeoutTurn auto-plays current seat', () => {
    const g = newGame(3);
    g.timeoutTurn();
    expect(g.state.pile.length).toBeGreaterThan(0);
    expect(g.state.log.some(e => e.type === 'turn_timeout')).toBe(true);
  });
});

describe('bot & registry', () => {
  it('suggestPlay prefers honest rank cards', () => {
    const g = newGame(2);
    g.state.hands[0].cards = [0, 13, 5, 20]; // 0,13 是 A
    g.state.declared = 1;
    expect(suggestPlay(g, 0)).toEqual([0, 13]);
    g.state.declared = 3;
    const bluff = suggestPlay(g, 0)!;
    expect(bluff.length).toBe(1);
  });

  it('registry creates cheat and schedules correctly', () => {
    const inst = createGame('cheat', players(3), { ...DEFAULT_ROOM_SETTINGS, gameId: 'cheat' });
    inst.startRound();
    const sched = inst.schedule();
    expect(sched.deadline).toBeTruthy();
    const gv = inst.gameView(0) as Record<string, unknown>;
    expect(gv.pileCount).toBe(0);
    expect(gv.declared).toBe(1);
    expect((gv.meHand as number[]).length).toBe(18);
    expect(RANK_LABEL[0]).toBe('A');
  });
});
