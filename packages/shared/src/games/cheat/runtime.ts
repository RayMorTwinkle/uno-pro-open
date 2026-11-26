import { CheatGame, decideCheatBot } from './engine.js';
import type { BotDifficulty, RoomSettings } from '../../types.js';
import type { GameAction, GameInstance, GameSched, SeatPlayer } from '../types.js';

class CheatRuntime implements GameInstance {
  readonly gameId = 'cheat' as const;
  private g: CheatGame;
  private turnSeconds: number;

  constructor(players: SeatPlayer[], settings: RoomSettings) {
    this.g = new CheatGame(players, settings);
    this.turnSeconds = settings.turnSeconds;
  }

  get phase() { return this.g.state.phase; }
  get round() { return this.g.state.turn; }
  get scores() { return (this.g as unknown as { scoresMap: Record<string, number> }).scoresMap; }
  get events() { return this.g.state.log; }

  apply(seat: number, a: GameAction) {
    switch (a.type) {
      case 'play': return this.g.play(seat, (a.cardIds as number[]) ?? []);
      case 'call': return this.g.call(seat);
      default: return { ok: false, error: `未知动作 ${a.type}` };
    }
  }

  decideBot(seat: number, difficulty: BotDifficulty): GameAction | null {
    return decideCheatBot(this.g, seat, difficulty);
  }

  schedule(): GameSched {
    const s = this.g.state;
    if (s.phase !== 'play') return { thinkSeats: [] };
    if (s.lastPlay && s.lastPlay.windowUntil > Date.now()) {
      // 质疑窗口：所有人都能想（抓包或继续出牌）
      const thinkers = this.g.state.hands.filter(h => h.cards.length > 0).map(h => h.seatIndex);
      return { deadline: { seat: null, at: s.lastPlay.windowUntil }, thinkSeats: thinkers };
    }
    return { deadline: { seat: s.current, at: s.turnStartedAt + this.turnSeconds * 1000 }, thinkSeats: [s.current] };
  }

  timeout() { this.g.timeoutTurn(); }

  gameView(seatIdx: number) {
    const s = this.g.state;
    const meHand = seatIdx < 0 ? [] : (s.hands.find(h => h.seatIndex === seatIdx)?.cards ?? []);
    const cardCounts: Record<number, number> = {};
    const seatExtras: Record<number, Record<string, unknown>> = {};
    for (const h of s.hands) {
      cardCounts[h.seatIndex] = h.cards.length;
      seatExtras[h.seatIndex] = {
        finished: s.finished.includes(h.seatIndex),
        outRank: s.finished.indexOf(h.seatIndex) + 1 || undefined,
      };
    }
    return {
      game: 'cheat',
      cardCounts,
      seatExtras,
      meHand,
      pileCount: s.pile.length,
      declared: s.declared,
      current: s.current,
      // 注意：不发 cards——暗牌是秘密信息，reveal 通过事件流公开
      lastPlay: s.lastPlay ? { seat: s.lastPlay.seat, count: s.lastPlay.count, rank: s.lastPlay.rank, windowUntil: s.lastPlay.windowUntil } : null,
      phase: s.phase,
      finished: s.finished,
      turnStartedAt: s.turnStartedAt,
      lastEvent: s.lastEvent,
      // 已出完按完赛顺序，未出完按剩余张数
      scoresLive: Object.fromEntries(s.hands.map(h => [h.seatIndex, -h.cards.length])),
    };
  }

  startRound() { this.g.startRound(); }
  addScore(key: string, points: number) {
    (this.g as unknown as { scoresMap: Record<string, number> }).scoresMap[key] = points;
  }
}

export function createCheatGame(players: SeatPlayer[], settings: RoomSettings): GameInstance {
  return new CheatRuntime(players, settings);
}
