import { NimmtGame, decideNimmtBot, bullheads } from './engine.js';
import type { BotDifficulty, RoomSettings } from '../../types.js';
import type { GameAction, GameInstance, GameSched, SeatPlayer } from '../types.js';

class NimmtRuntime implements GameInstance {
  readonly gameId = 'nimmt' as const;
  private g: NimmtGame;
  private turnSeconds: number;

  constructor(players: SeatPlayer[], settings: RoomSettings) {
    this.g = new NimmtGame(players, settings);
    this.turnSeconds = settings.turnSeconds;
  }

  get phase() { return this.g.state.phase === 'match_over' ? 'match_over' : this.g.state.phase; }
  get round() { return this.g.state.turn; }
  get scores() { return this.g['scoresMap' as never] as Record<string, number>; }
  get events() { return this.g.state.log; }

  apply(seat: number, a: GameAction) {
    switch (a.type) {
      case 'pick': return this.g.pick(seat, a.card as number);
      case 'choose_row': return this.g.chooseRow(seat, a.row as number);
      default: return { ok: false, error: `未知动作 ${a.type}` };
    }
  }

  decideBot(seat: number, difficulty: BotDifficulty): GameAction | null {
    return decideNimmtBot(this.g, seat, difficulty);
  }

  schedule(): GameSched {
    const s = this.g.state;
    if (s.phase === 'pick') {
      const waiting = s.hands.filter(h => !s.pickedSeats.includes(h.seatIndex)).map(h => h.seatIndex);
      return { deadline: { seat: null, at: s.turnStartedAt + this.turnSeconds * 1000 }, thinkSeats: waiting };
    }
    if (s.phase === 'choose_row' && s.pendingRowChoice) {
      return { deadline: { seat: s.pendingRowChoice.seat, at: s.turnStartedAt + this.turnSeconds * 1000 }, thinkSeats: [s.pendingRowChoice.seat] };
    }
    return { thinkSeats: [] };
  }

  timeout() { this.g.timeoutTurn(); }

  gameView(seatIdx: number) {
    const s = this.g.state;
    const meHand = seatIdx < 0 ? [] : (s.hands.find(h => h.seatIndex === seatIdx)?.cards ?? []);
    const cardCounts: Record<number, number> = {};
    const seatExtras: Record<number, Record<string, unknown>> = {};
    for (const h of s.hands) {
      const i = h.seatIndex;
      cardCounts[i] = h.cards.length;
      seatExtras[i] = {
        picked: s.pickedSeats.includes(i),
        heads: (s.taken[i] ?? []).reduce((a, c) => a + bullheads(c), 0),
      };
    }
    return {
      game: 'nimmt',
      cardCounts,
      seatExtras,
      meHand,
      rows: s.rows,
      pickedSeats: s.pickedSeats,
      pendingRowChoice: s.pendingRowChoice,
      phase: s.phase,
      turn: s.turn,
      maxTurns: s.maxTurns,
      taken: Object.fromEntries(Object.entries(s.taken).map(([k, v]) => [k, v.reduce((a, c) => a + bullheads(c), 0)])),
      turnStartedAt: s.turnStartedAt,
      lastEvent: s.lastEvent,
      current: s.pendingRowChoice?.seat ?? -1,
    };
  }

  startRound() { this.g.startRound(); }
  addScore(key: string, points: number) {
    (this.g as unknown as { scoresMap: Record<string, number> }).scoresMap[key] = points;
  }
}

export function createNimmtGame(players: SeatPlayer[], settings: RoomSettings): GameInstance {
  return new NimmtRuntime(players, settings);
}
