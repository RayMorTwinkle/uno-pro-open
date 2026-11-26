import { GalliGame, FRUIT_NAME, FRUIT_ICON } from './engine.js';
import type { RoomSettings } from '../../types.js';
import type { GameAction, GameInstance, GameSched, SeatPlayer } from '../types.js';

class GalliRuntime implements GameInstance {
  readonly gameId = 'galli' as const;
  private g: GalliGame;

  constructor(players: SeatPlayer[], settings: RoomSettings) {
    this.g = new GalliGame(players, settings);
  }

  get phase() { return this.g.state.phase; }
  get round() { return this.g.state.turn; }
  get scores() { return (this.g as unknown as { scoresMap: Record<string, number> }).scoresMap ?? {}; }
  get events() { return this.g.state.log; }

  apply(seat: number, a: GameAction) {
    switch (a.type) {
      case 'flip': return this.g.flip(seat);
      case 'slap': return this.g.slap(seat);
      default: return { ok: false, error: `未知动作 ${a.type}` };
    }
  }

  decideBot(): null { return null; } // bot 全部由 botTick 心跳驱动

  schedule(): GameSched {
    const s = this.g.state;
    if (s.phase === 'match_over') return { thinkSeats: [] };
    const now = Date.now();
    let at: number;
    if (s.phase === 'slap_wait') {
      const earliest = Math.min(s.windowUntil, ...Object.values(s.botSlapAt).filter(t => t > now));
      at = Number.isFinite(earliest) ? earliest : s.windowUntil;
    } else {
      at = Math.min(s.flipDeadline, s.botFlipAt || s.flipDeadline);
    }
    return { deadline: { seat: null, at }, thinkSeats: [] };
  }

  timeout() { this.g.botTick(); }

  gameView(seatIdx: number) {
    const s = this.g.state;
    const cardCounts: Record<number, number> = {};
    const seatExtras: Record<number, Record<string, unknown>> = {};
    const openTop: Record<number, { fruit: number; count: number } | null> = {};
    const openCount: Record<number, number> = {};
    for (const p of this.g.seats) {
      const i = p.seatIndex;
      cardCounts[i] = s.hands[i]?.length ?? 0;
      openTop[i] = s.open[i]?.[0] ?? null;
      openCount[i] = s.open[i]?.length ?? 0;
      seatExtras[i] = {
        out: !s.alive.includes(i),
        wins: s.wins[i] ?? 0,
      };
    }
    return {
      game: 'galli',
      cardCounts, seatExtras,
      meHand: [],
      openTop, openCount,
      alive: s.alive,
      current: s.current,
      phase: s.phase,
      windowUntil: s.windowUntil,
      flipDeadline: s.flipDeadline,
      turn: s.turn,
      lastFlip: s.lastFlip,
      lastSlap: s.lastSlap,
      fiveFruit: s.phase === 'slap_wait' ? this.g.fiveFruit() : -1,
      fruitName: FRUIT_NAME, fruitIcon: FRUIT_ICON,
      lastEvent: s.lastEvent,
      scoresLive: Object.fromEntries(s.alive.map(i => [i, s.hands[i].length])),
    };
  }

  startRound() { /* 构造时已发牌 */ }
  addScore(key: string, points: number) {
    const m = (this.g as unknown as { scoresMap: Record<string, number> }).scoresMap;
    if (m) m[key] = points;
  }
}

export function createGalliGame(players: SeatPlayer[], settings: RoomSettings): GameInstance {
  return new GalliRuntime(players, settings);
}
