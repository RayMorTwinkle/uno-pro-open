import { describe, it, expect } from 'vitest';
import { DrawGuessGame, WORDS } from '../src/games/drawguess/engine.js';
import { createGame } from '../src/games/registry.js';
import { DEFAULT_ROOM_SETTINGS } from '../src/types.js';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ seatIndex: i, key: `p${i}`, name: `P${i}`, isBot: i > 0 }));

describe('drawguess', () => {
  it('starts in pick_word with 3 choices for drawer', () => {
    const g = new DrawGuessGame(players(3), { ...DEFAULT_ROOM_SETTINGS, gameId: 'drawguess' });
    g.startRound();
    expect(g.state.phase).toBe('pick_word');
    expect(g.state.wordChoices.length).toBe(3);
    expect(g.state.wordChoices.every(w => WORDS.includes(w))).toBe(true);
    expect(g.state.drawer).toBe(0);
  });

  it('pick → draw; only drawer strokes; guesses score', () => {
    const g = new DrawGuessGame(players(3), { ...DEFAULT_ROOM_SETTINGS, gameId: 'drawguess' });
    g.startRound();
    expect(g.stroke(1, { pts: [1, 1, 2, 2], color: '#fff', w: 3 }).ok).toBe(false); // 非画手不能画
    expect(g.pickWord(0, g.state.wordChoices[0]).ok).toBe(true);
    expect(g.state.phase).toBe('draw');
    expect(g.stroke(0, { pts: [1, 1, 2, 2], color: '#fff', w: 3 }).ok).toBe(true);
    expect(g.guess(0, 'x').ok).toBe(false); // 画手不能猜
    expect(g.guess(1, g.state.word!).ok).toBe(true);
    expect(g.state.guessed).toEqual([1]);
    expect(g.guess(1, g.state.word!).ok).toBe(false); // 不能重复猜
    expect((g as any).scoresMap.p1).toBeGreaterThan(0);
    expect((g as any).scoresMap.p0).toBeGreaterThan(0); // 画手也得分
  });

  it('all guessed → reveal → next drawer; last → match_over', () => {
    const g = new DrawGuessGame(players(3), { ...DEFAULT_ROOM_SETTINGS, gameId: 'drawguess' });
    g.startRound();
    for (let r = 0; r < 3; r++) {
      const word = g.state.wordChoices[0];
      g.pickWord(g.state.drawer, word);
      for (const seat of [0, 1, 2]) {
        if (seat === g.state.drawer) continue;
        g.guess(seat, g.state.word!);
      }
      expect(g.state.phase).toBe('reveal');
      if (r < 2) { g['nextRound'](); expect(g.state.phase).toBe('pick_word'); }
      else g['nextRound']();
    }
    expect(g.state.phase).toBe('match_over');
    const end = g.state.log.find(e => e.type === 'match_end');
    expect(end?.detail?.winner).toBeTruthy();
  });

  it('timeout: auto-picks word; draw deadline reveals; bot ticks draw+guess', () => {
    const g = new DrawGuessGame(players(3), { ...DEFAULT_ROOM_SETTINGS, gameId: 'drawguess' });
    g.startRound();
    g.timeout(); // 自动选词
    expect(g.state.phase).toBe('draw');
    // bot 画手（座位0非bot…换成bot画手场景）
    const g2 = new DrawGuessGame(players(3), { ...DEFAULT_ROOM_SETTINGS, gameId: 'drawguess' });
    g2.startRound();
    g2.state.drawer = 1; // 强制 bot 画手
    g2.timeout();
    const word = g2.state.word!;
    expect(g2.state.phase).toBe('draw');
    // 时间快进到 bot 猜中时刻后
    g2.state.drawStartedAt = Date.now() - 70000;
    g2.state.deadlineAt = Date.now() + 10000;
    g2.botTick();
    // bot 应已放出笔迹或猜中
    expect(g2.state.strokes.length + g2.state.guessed.length).toBeGreaterThan(0);
    // 到期 → reveal
    g2.state.deadlineAt = Date.now() - 1;
    g2.botTick();
    expect(g2.state.phase).toBe('reveal');
    expect(g2.state.revealedWord).toBe(word);
  });

  it('registry creates instance; view hides word from non-drawer', () => {
    const inst = createGame('drawguess', players(3), { ...DEFAULT_ROOM_SETTINGS, gameId: 'drawguess' });
    inst.startRound();
    const drawer = (inst.gameView(-1) as Record<string, unknown>).drawer as number;
    const gvDrawer = inst.gameView(drawer) as Record<string, unknown>;
    const gvOther = inst.gameView((drawer + 1) % 3) as Record<string, unknown>;
    expect((gvDrawer.wordChoices as string[]).length).toBe(3);
    expect(gvOther.word).toBeNull();
    expect((gvOther.wordChoices as string[]).length).toBe(0);
    const sched = inst.schedule();
    expect(sched.deadline).toBeTruthy();
  });
});
