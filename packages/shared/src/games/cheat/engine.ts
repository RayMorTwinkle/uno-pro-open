import type { SeatPlayer, GameAction, ActionResult, EventLite } from '../types.js';
import type { RoomSettings } from '../../types.js';

// 牌编码：rank 1-13(A-K) × suit 0-3 → id = suit*13 + rank-1
export const rankOf = (id: number) => (id % 13) + 1;
export const suitOf = (id: number) => Math.floor(id / 13);
export const RANK_LABEL = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUIT_LABEL = ['♠', '♥', '♦', '♣'];

export interface CheatState {
  hands: { seatIndex: number; cards: number[] }[];
  pile: number[];
  /** 本回合要求的牌面 1-13，打完一张后 +1（A→2→…→K→A） */
  declared: number;
  /** 当前行动座位（轮转） */
  current: number;
  /** 最后一次出牌：{seat, count, rank, cards(公开后才有), windowUntil} */
  lastPlay: { seat: number; count: number; rank: number; cards?: number[]; windowUntil: number } | null;
  /** 抓包结算待处理（caller 与被叫者定输赢） */
  phase: 'play' | 'round_over' | 'match_over';
  turn: number;
  finished: number[]; // 已出完牌的座位（按顺序）
  lastEvent: CheatEvent | null;
  log: CheatEvent[];
  turnStartedAt: number;
}

export interface CheatEvent extends EventLite {
  type: 'deal' | 'play' | 'call' | 'reveal_honest' | 'reveal_lie' | 'take_pile' | 'out' | 'match_end' | 'turn_timeout';
}

export class CheatGame {
  seats: SeatPlayer[];
  state: CheatState;
  private seq = 0;
  private rng: () => number;
  private scoresMap: Record<string, number> = {};

  constructor(seats: SeatPlayer[], _settings: RoomSettings, rng: () => number = Math.random) {
    this.seats = seats;
    this.rng = rng;
    this.state = {
      hands: [], pile: [], declared: 1, current: 0,
      lastPlay: null, phase: 'play', turn: 0, finished: [],
      lastEvent: null, log: [], turnStartedAt: Date.now(),
    };
    for (const s of seats) this.scoresMap[s.key] = 0;
  }

  private emit(type: CheatEvent['type'], seat: number, detail?: Record<string, unknown>) {
    const ev: CheatEvent = { seq: ++this.seq, t: Date.now(), type, seat, detail };
    this.state.lastEvent = ev;
    this.state.log.push(ev);
  }

  private handOf(seat: number): number[] {
    const h = this.state.hands.find(h => h.seatIndex === seat);
    if (!h) throw new Error('bad seat');
    return h.cards;
  }

  private aliveSeats(): number[] {
    return this.state.hands.filter(h => h.cards.length > 0).map(h => h.seatIndex);
  }

  startRound(): void {
    const deck = Array.from({ length: 52 }, (_, i) => i);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const n = this.seats.length;
    this.state.hands = this.seats.map(s => ({ seatIndex: s.seatIndex, cards: [] as number[] }));
    deck.forEach((c, i) => this.state.hands[i % n].cards.push(c));
    for (const h of this.state.hands) h.cards.sort((a, b) => rankOf(a) - rankOf(b) || suitOf(a) - suitOf(b));
    this.state.pile = [];
    this.state.declared = 1;
    this.state.current = this.seats[0].seatIndex;
    this.state.lastPlay = null;
    this.state.phase = 'play';
    this.state.finished = [];
    this.state.turnStartedAt = Date.now();
    this.emit('deal', this.state.current);
  }

  /** 到谁行动（跳过已出完的） */
  private nextTurn(from: number): void {
    const s = this.state;
    const order = this.seats.map(p => p.seatIndex);
    let i = order.indexOf(from);
    for (let k = 0; k < order.length; k++) {
      i = (i + 1) % order.length;
      const seat = order[i];
      if (this.handOf(seat).length > 0) { s.current = seat; break; }
    }
    s.declared = (s.declared % 13) + 1;
    s.turn += 1;
    s.turnStartedAt = Date.now();
  }

  /** 出 1-4 张牌，声明为当前牌面。窗口期内的出牌 = 放弃质疑并关闭窗口 */
  play(seat: number, cardIds: number[]): ActionResult {
    const s = this.state;
    if (s.phase !== 'play') return { ok: false, error: '当前不能出牌' };
    if (s.lastPlay) {
      const prev = s.lastPlay.seat;
      s.lastPlay = null;
      this.nextTurn(prev); // 推进 declared + current
    }
    if (seat !== s.current) return { ok: false, error: '不是你的回合' };
    if (!cardIds.length || cardIds.length > 4) return { ok: false, error: '一次出 1-4 张' };
    const hand = this.handOf(seat);
    for (const c of cardIds) {
      const i = hand.indexOf(c);
      if (i < 0) return { ok: false, error: '手牌中没有这张牌' };
    }
    for (const c of cardIds) hand.splice(hand.indexOf(c), 1);
    s.pile.push(...cardIds);
    s.lastPlay = { seat, count: cardIds.length, rank: s.declared, cards: cardIds.slice(), windowUntil: Date.now() + 7000 };
    s.current = this.peekNext(seat); // 预告下一家（窗口期内可随时落牌）
    this.emit('play', seat, { count: cardIds.length, rank: s.declared });
    if (hand.length === 0) {
      s.finished.push(seat);
      this.emit('out', seat, { rank: s.finished.length });
      if (this.checkWin()) return { ok: true };
    }
    s.turnStartedAt = Date.now();
    return { ok: true };
  }

  private peekNext(from: number): number {
    const s = this.state;
    const order = this.seats.map(p => p.seatIndex);
    let i = order.indexOf(from);
    for (let k = 0; k < order.length; k++) {
      i = (i + 1) % order.length;
      if (this.handOf(order[i]).length > 0) return order[i];
    }
    return from;
  }

  /** 质疑上一家出牌 */
  call(seat: number): ActionResult {
    const s = this.state;
    const lp = s.lastPlay;
    if (!lp || lp.windowUntil <= Date.now()) return { ok: false, error: '没有可质疑的出牌' };
    if (lp.seat === seat) return { ok: false, error: '不能质疑自己' };
    if (this.handOf(seat).length === 0) return { ok: false, error: '已出完不能质疑' };
    const honest = (lp.cards ?? []).every(c => rankOf(c) === lp.rank);
    const loser = honest ? seat : lp.seat;
    this.emit(honest ? 'reveal_honest' : 'reveal_lie', lp.seat, { cards: lp.cards, rank: lp.rank, caller: seat });
    const pileCards = s.pile.splice(0);
    this.handOf(loser).push(...pileCards);
    this.handOf(loser).sort((a, b) => rankOf(a) - rankOf(b) || suitOf(a) - suitOf(b));
    this.emit('take_pile', loser, { count: pileCards.length, by: seat, honest });
    // 拿回牌堆的人若之前出完了，移出 finished
    const fi = s.finished.indexOf(loser);
    if (fi >= 0) s.finished.splice(fi, 1);
    s.lastPlay = null;
    // 无论成败，轮到出牌者的下一家
    this.nextTurn(lp.seat);
    if (this.checkWin()) return { ok: true };
    return { ok: true };
  }

  /** 窗口过期无人质疑 → 轮下一家 */
  advanceIfIdle(): void {
    const s = this.state;
    if (s.lastPlay && s.lastPlay.windowUntil <= Date.now()) {
      const prev = s.lastPlay.seat;
      s.lastPlay = null;
      this.nextTurn(prev);
      this.checkWin();
    }
  }

  /** 出完且没被质疑 → 正式完赛；所有人出完 → match_over */
  private checkWin(): boolean {
    const s = this.state;
    const alive = this.aliveSeats();
    // 安全阀：极长局按剩余张数直接结算
    if (s.turn > 400) {
      s.phase = 'match_over';
      const order = [...s.finished, ...alive.sort((a, b) => this.handOf(a).length - this.handOf(b).length)];
      this.emit('match_end', -1, { winner: this.seats.find(p => p.seatIndex === order[0])?.key, order, timeout: true });
      return true;
    }
    if (alive.length <= 1 || (s.lastPlay === null && alive.length === 0)) {
      // 只剩 ≤1 人手里有牌 → 结束
      s.phase = 'match_over';
      const order = [...s.finished, ...alive];
      const winner = order[0] ?? this.seats[0].seatIndex;
      this.emit('match_end', -1, { winner: this.seats.find(p => p.seatIndex === winner)?.key, order });
      return true;
    }
    return false;
  }

  /** 超时：当前座位自动出牌（诚实优先） */
  timeoutTurn(): void {
    const s = this.state;
    this.advanceIfIdle();
    if (s.phase !== 'play') return;
    if (s.lastPlay) return; // 窗口开着 → advanceIfIdle 已处理（未到期则不该来这）
    const act = suggestPlay(this, s.current);
    if (act) {
      this.emit('turn_timeout', s.current, { count: act.length });
      this.play(s.current, act);
    }
  }
}

// ---------- bot ----------
export function suggestPlay(g: CheatGame, seat: number): number[] | null {
  const s = g.state;
  const hand = s.hands.find(h => h.seatIndex === seat)?.cards;
  if (!hand?.length) return null;
  const rank = s.declared;
  const owned = hand.filter(c => rankOf(c) === rank);
  if (owned.length) return owned.slice(0, Math.min(4, owned.length));
  // 没得诚实出 → 吹牛：出手牌里价值最低的（优先大单张/稀有牌少的）
  const byRank = new Map<number, number[]>();
  for (const c of hand) {
    const r = rankOf(c);
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r)!.push(c);
  }
  // 选数量最少的 rank 出 1 张（保留成对的牌更危险？实际随便）
  const rarest = [...byRank.entries()].sort((a, b) => a[1].length - b[1].length)[0];
  return [rarest[1][0]];
}

export function decideCheatBot(g: CheatGame, seat: number, diff: string, rng: () => number = Math.random): GameAction | null {
  const s = g.state;
  // 窗口开着 → 考虑质疑
  const myHand = g.state.hands.find(h => h.seatIndex === seat)?.cards ?? [];
  if (s.lastPlay && s.lastPlay.seat !== seat && s.lastPlay.windowUntil > Date.now() && myHand.length > 0) {
    const lp = s.lastPlay;
    const myRank = myHand.filter(c => rankOf(c) === lp.rank).length;
    if (myRank + lp.count > 4) return { type: 'call' }; // 必假
    // 收敛优先：低随机质疑率，牌堆越大越敢赌（统计压力）；4 张声明本就嫌疑大
    let p = diff === 'novice' ? 0.004 : lp.count >= 4 ? 0.08 : lp.count >= 3 ? 0.025 : 0.01;
    if (s.pile.length >= 20) p *= 3;
    if (rng() < p) return { type: 'call' };
    return null;
  }
  if (s.phase === 'play' && s.current === seat && !s.lastPlay) {
    const cards = suggestPlay(g, seat);
    if (cards) return { type: 'play', cardIds: cards };
  }
  // 窗口开着但轮到我出 → 直接出（等于放弃质疑）
  if (s.phase === 'play' && s.current === seat && s.lastPlay && s.lastPlay.seat !== seat) {
    const cards = suggestPlay(g, seat);
    if (cards) return { type: 'play', cardIds: cards };
  }
  return null;
}
