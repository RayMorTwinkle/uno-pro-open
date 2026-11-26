import { DrawGuessGame } from './engine.js';
import type { BotDifficulty, RoomSettings } from '../../types.js';
import type { GameAction, GameInstance, GameSched, SeatPlayer } from '../types.js';

class DrawGuessRuntime implements GameInstance {
  readonly gameId = 'drawguess' as const;
  private g: DrawGuessGame;

  constructor(players: SeatPlayer[], _settings: RoomSettings) {
    this.g = new DrawGuessGame(players, _settings);
  }

  get phase() { return this.g.state.phase; }
  get round() { return this.g.state.round; }
  get scores() { return (this.g as unknown as { scoresMap: Record<string, number> }).scoresMap; }
  get events() { return this.g.state.log; }

  apply(seat: number, a: GameAction) {
    const s = this.g.state;
    switch (a.type) {
      case 'pick_word': return this.g.pickWord(seat, a.word as string);
      case 'stroke': return this.g.stroke(seat, { pts: a.pts as number[], color: a.color as string, w: a.w as number });
      case 'clear': return this.g.clear(seat);
      case 'guess': return this.g.guess(seat, a.text as string);
      default: return { ok: false, error: `未知动作 ${a.type}` };
    }
  }

  decideBot(): null { return null; } // bot 行为由 botTick 心跳驱动

  schedule(): GameSched {
    const s = this.g.state;
    // 每 600ms 打一次心跳驱动 bot 画/猜与阶段截止
    const next = Math.min(s.deadlineAt, Date.now() + 600);
    return { deadline: { seat: null, at: next }, thinkSeats: [] };
  }

  timeout() { this.g.botTick(); }

  gameView(seatIdx: number) {
    const s = this.g.state;
    const isDrawer = seatIdx === s.drawer;
    const cardCounts: Record<number, number> = {};
    const seatExtras: Record<number, Record<string, unknown>> = {};
    for (const p of this.g.seats) {
      cardCounts[p.seatIndex] = 0;
      seatExtras[p.seatIndex] = {
        drawer: p.seatIndex === s.drawer,
        guessed: s.guessed.includes(p.seatIndex),
        pts: s.scoresLive[p.seatIndex] ?? 0,
      };
    }
    return {
      game: 'drawguess',
      cardCounts, seatExtras,
      meHand: [],
      drawer: s.drawer,
      wordChoices: isDrawer ? s.wordChoices : [],
      word: isDrawer ? s.word : null,           // 词只有画手看得到
      wordLen: s.word?.length ?? 0,
      strokes: s.strokes,
      guesses: s.guesses,
      guessed: s.guessed,
      phase: s.phase,
      round: s.round,
      totalRounds: s.totalRounds,
      deadlineAt: s.deadlineAt,
      revealedWord: s.revealedWord,
      lastEvent: s.lastEvent,
      current: s.drawer,
      isDrawer,
    };
  }

  startRound() { this.g.startRound(); }
  addScore(key: string, points: number) {
    (this.g as unknown as { scoresMap: Record<string, number> }).scoresMap[key] = points;
  }
}

export function createDrawGuessGame(players: SeatPlayer[], settings: RoomSettings): GameInstance {
  return new DrawGuessRuntime(players, settings);
}
