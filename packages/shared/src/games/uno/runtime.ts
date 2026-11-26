import { UnoGame } from '../../engine.js';
import { decideBotAction } from '../../bot.js';
import type { BotDifficulty, Color, RoomSettings } from '../../types.js';
import type { GameAction, GameInstance, GameSched, SeatPlayer } from '../types.js';

/** UNO 运行时：把 UnoGame 包成通用 GameInstance */
class UnoRuntime implements GameInstance {
  readonly gameId = 'uno' as const;
  private g: UnoGame;
  private turnSeconds: number;

  constructor(players: SeatPlayer[], settings: RoomSettings) {
    this.g = new UnoGame(players, settings);
    this.turnSeconds = settings.turnSeconds;
  }

  get phase() { return this.g.state.phase; }
  get round() { return this.g.state.round; }
  get scores() { return this.g.scores; }
  get events() { return this.g.state.log; }

  apply(seat: number, a: GameAction) {
    const g = this.g;
    switch (a.type) {
      case 'play': return g.play(seat, a.cardIds as number[], a.wildColor as Color | undefined);
      case 'draw': return g.draw(seat);
      case 'pass': return g.pass(seat);
      case 'uno': return g.uno(seat);
      case 'catch': return g.catchUno(seat, a.targetSeat as number);
      case 'challenge': return g.respondChallenge(seat, !!a.challenge);
      case 'choose_color': return g.chooseColor(seat, a.color as Color);
      case 'swap_target': return g.chooseSwapTarget(seat, a.targetSeat as number);
      default: return { ok: false, error: `未知动作 ${a.type}` };
    }
  }

  decideBot(seat: number, difficulty: BotDifficulty): GameAction | null {
    return decideBotAction(this.g, seat, difficulty) as GameAction | null;
  }

  schedule(): GameSched {
    const s = this.g.state;
    if (s.phase === 'challenge' && s.challenge) {
      return {
        deadline: { seat: s.challenge.challengerSeat, at: s.challenge.deadline + 50 },
        thinkSeats: [s.challenge.challengerSeat],
      };
    }
    if (s.phase === 'play' || s.phase === 'choose_color' || s.phase === 'swap_target') {
      const thinkSeats = [s.current];
      if (s.phase === 'play') {
        // 非当前座位也要给思考机会（抓 UNO / jump-in）
        for (const h of this.g.activeHands()) {
          if (h.seatIndex !== s.current) thinkSeats.push(h.seatIndex);
        }
      }
      return {
        deadline: { seat: s.current, at: s.turnStartedAt + this.turnSeconds * 1000 },
        thinkSeats,
      };
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
        uno: s.unoCalled.includes(i),
        eliminated: s.eliminated.includes(i),
        outRank: s.finishOrder.includes(i) ? s.finishOrder.indexOf(i) + 1 : undefined,
      };
    }
    const event = s.lastEvent;
    const privateDraw = event && event.seat !== seatIdx &&
      (event.type === 'draw' || event.type === 'draw_penalty');
    return {
      game: 'uno',
      cardCounts,
      seatExtras,
      meHand,
      discardTop: s.discard[s.discard.length - 1] ?? null,
      discardPrev: s.discard.slice(-4, -1).reverse(),
      activeColor: s.activeColor,
      current: s.current,
      direction: s.direction,
      pendingDraw: s.pendingDraw?.count ?? 0,
      phase: s.phase,
      drewThisTurn: seatIdx === s.current ? s.drewThisTurn : null,
      turnStartedAt: s.turnStartedAt,
      deckCount: s.deck.length,
      challenge: s.challenge,
      lastEvent: privateDraw ? { ...event, cardIds: undefined } : event,
      unoVulnerable: Object.keys(s.unoVulnerable).map(Number),
      finishOrder: [...s.finishOrder],
    };
  }

  startRound() { this.g.startRound(); }
  addScore(key: string, points: number) { this.g.addScore(key, points); }
}

export function createUnoGame(players: SeatPlayer[], settings: RoomSettings): GameInstance {
  return new UnoRuntime(players, settings);
}
