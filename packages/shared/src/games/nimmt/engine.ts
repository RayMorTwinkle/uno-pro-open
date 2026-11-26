import type { SeatPlayer, GameAction, ActionResult, EventLite, GameSched } from '../types.js';
import type { RoomSettings } from '../../types.js';

// ---------- 牛头数（官方规则） ----------
export function bullheads(n: number): number {
  if (n === 55) return 7;
  if (n % 11 === 0) return 5;
  if (n % 10 === 0) return 3;
  if (n % 5 === 0) return 2;
  return 1;
}

export interface NimmtState {
  /** 座位 -> 手牌（服务端全量） */
  hands: { seatIndex: number; cards: number[] }[];
  /** 桌面 4 行，每行按序递增 */
  rows: number[][];
  /** 本回合各座位已扣的牌（隐藏值，结算时才公开） */
  picks: Record<number, number>;
  /** 本回合暗选的座位集合（客户端用来显示“已选”标记） */
  pickedSeats: number[];
  /** 正在结算的暗选队列（升序） */
  settling: { seat: number; card: number }[];
  /** 有人打出比所有行尾都小的牌 → 等其选一行吃掉 */
  pendingRowChoice: { seat: number; card: number } | null;
  phase: 'pick' | 'choose_row' | 'match_over';
  /** 第几回合（暗选回合，1..10） */
  turn: number;
  maxTurns: number;
  /** 各座位罚吃的牛头堆（面值列表，公开信息） */
  taken: Record<number, number[]>;
  turnStartedAt: number;
  lastEvent: NimmtEvent | null;
  log: NimmtEvent[];
}

export interface NimmtEvent extends EventLite {
  type: 'deal' | 'pick' | 'reveal' | 'place' | 'take_row' | 'take_five' | 'turn_end' | 'match_end' | 'turn_timeout';
}

export class NimmtGame {
  seats: SeatPlayer[];
  state: NimmtState;
  private seq = 0;
  private rng: () => number;
  private scoresMap: Record<string, number> = {};

  constructor(seats: SeatPlayer[], _settings: RoomSettings, rng: () => number = Math.random) {
    this.seats = seats;
    this.rng = rng;
    this.state = {
      hands: [],
      rows: [[], [], [], []],
      picks: {},
      pickedSeats: [],
      settling: [],
      pendingRowChoice: null,
      phase: 'pick',
      turn: 0,
      maxTurns: 10,
      taken: {},
      turnStartedAt: Date.now(),
      lastEvent: null,
      log: [],
    };
    for (const s of seats) this.scoresMap[s.key] = 0;
  }

  private emit(type: NimmtEvent['type'], seat: number, detail?: Record<string, unknown>) {
    const ev: NimmtEvent = { seq: ++this.seq, t: Date.now(), type, seat, detail };
    this.state.lastEvent = ev;
    this.state.log.push(ev);
  }

  private handOf(seat: number): number[] {
    const h = this.state.hands.find(h => h.seatIndex === seat);
    if (!h) throw new Error('bad seat');
    return h.cards;
  }

  /** 洗牌发牌：每人 10 张 + 4 行底牌 */
  startRound(): void {
    const deck = Array.from({ length: 104 }, (_, i) => i + 1);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    this.state.hands = this.seats.map(s => ({ seatIndex: s.seatIndex, cards: deck.splice(0, 10).sort((a, b) => a - b) }));
    this.state.rows = [deck.splice(0, 1), deck.splice(0, 1), deck.splice(0, 1), deck.splice(0, 1)];
    this.state.picks = {};
    this.state.pickedSeats = [];
    this.state.settling = [];
    this.state.pendingRowChoice = null;
    this.state.taken = {};
    this.state.phase = 'pick';
    this.state.turn = 1;
    this.state.turnStartedAt = Date.now();
    this.emit('deal', this.seats[0].seatIndex);
  }

  /** 玩家扣一张牌（暗选） */
  pick(seat: number, card: number): ActionResult {
    const s = this.state;
    if (s.phase !== 'pick') return { ok: false, error: '当前不能出牌' };
    if (seat in s.picks) return { ok: false, error: '本回合已选' };
    const hand = this.handOf(seat);
    const i = hand.indexOf(card);
    if (i < 0) return { ok: false, error: '手牌中没有这张牌' };
    hand.splice(i, 1);
    s.picks[seat] = card;
    s.pickedSeats.push(seat);
    this.emit('pick', seat);
    if (s.pickedSeats.length === s.hands.length) this.reveal();
    return { ok: true };
  }

  /** 全员暗选完毕 → 亮牌并按升序结算 */
  private reveal(): void {
    const s = this.state;
    s.settling = Object.entries(s.picks)
      .map(([seat, card]) => ({ seat: +seat, card }))
      .sort((a, b) => a.card - b.card);
    this.emit('reveal', -1, { picks: { ...s.picks } });
    s.picks = {};
    s.pickedSeats = [];
    this.settleNext();
  }

  /** 结算队列中的下一张牌 */
  private settleNext(): void {
    const s = this.state;
    while (s.settling.length > 0) {
      const cur = s.settling[0];
      const row = this.rowFor(cur.card);
      if (row < 0) {
        // 比所有行尾都小 → 等玩家选行
        s.pendingRowChoice = { seat: cur.seat, card: cur.card };
        s.phase = 'choose_row';
        s.turnStartedAt = Date.now();
        return;
      }
      s.settling.shift();
      this.placeInto(cur.seat, cur.card, row);
    }
    if (s.settling.length === 0 && !s.pendingRowChoice) this.endTurn();
  }

  /** 牌应进哪行：行尾最大值且仍小于 card 的行；-1 = 放不下 */
  private rowFor(card: number): number {
    let best = -1, bestTail = 0;
    for (let i = 0; i < 4; i++) {
      const tail = this.state.rows[i][this.state.rows[i].length - 1];
      if (tail < card && tail > bestTail) { best = i; bestTail = tail; }
    }
    return best;
  }

  private placeInto(seat: number, card: number, row: number): void {
    const s = this.state;
    s.rows[row].push(card);
    this.emit('place', seat, { card, row });
    if (s.rows[row].length === 6) {
      // 第六张 → 吃前 5 张
      const eaten = s.rows[row].slice(0, 5);
      this.take(seat, eaten, 'take_five', row);
      s.rows[row] = [card];
    }
  }

  private take(seat: number, cards: number[], kind: 'take_five' | 'take_row', row: number): void {
    const s = this.state;
    s.taken[seat] = [...(s.taken[seat] ?? []), ...cards];
    const heads = cards.reduce((a, c) => a + bullheads(c), 0);
    this.emit(kind, seat, { cards, heads, row });
    this.updateScore(seat);
  }

  /** 玩家选一行吃掉（其牌成为新行首） */
  chooseRow(seat: number, row: number): ActionResult {
    const s = this.state;
    if (s.phase !== 'choose_row' || !s.pendingRowChoice) return { ok: false, error: '当前不能选行' };
    if (s.pendingRowChoice.seat !== seat) return { ok: false, error: '不是你的回合' };
    if (row < 0 || row > 3) return { ok: false, error: '行不存在' };
    const { card } = s.pendingRowChoice;
    s.settling.shift();
    this.take(seat, s.rows[row].slice(), 'take_row', row);
    s.rows[row] = [card];
    this.emit('place', seat, { card, row });
    s.pendingRowChoice = null;
    s.phase = 'pick';
    this.settleNext();
    return { ok: true };
  }

  private endTurn(): void {
    const s = this.state;
    this.emit('turn_end', -1, { turn: s.turn });
    if (s.turn >= s.maxTurns || s.hands.every(h => h.cards.length === 0)) {
      s.phase = 'match_over';
      const headsOf = (seat: number) => (s.taken[seat] ?? []).reduce((a, c) => a + bullheads(c), 0);
      const winner = this.seats.reduce((a, b) => (headsOf(a.seatIndex) <= headsOf(b.seatIndex) ? a : b));
      for (const p of this.seats) this.updateScore(p.seatIndex);
      this.emit('match_end', -1, { winner: winner.key, heads: Object.fromEntries(this.seats.map(p => [p.seatIndex, headsOf(p.seatIndex)])) });
    } else {
      s.turn += 1;
      s.phase = 'pick';
      s.turnStartedAt = Date.now();
    }
  }

  private updateScore(seat: number): void {
    const key = this.seats.find(p => p.seatIndex === seat)?.key;
    if (!key) return;
    const heads = (this.state.taken[seat] ?? []).reduce((a, c) => a + bullheads(c), 0);
    this.scoresMap[key] = -heads;
  }

  /** 兜底：pick 阶段给未选者自动选（用 bot 策略）；choose_row 自动选最小行 */
  timeoutTurn(turnSeconds?: number): void {
    const s = this.state;
    if (s.phase === 'choose_row' && s.pendingRowChoice) {
      this.chooseRow(s.pendingRowChoice.seat, this.bestRowToTake());
      return;
    }
    if (s.phase === 'pick') {
      for (const h of s.hands) {
        if (!(h.seatIndex in s.picks)) {
          const c = suggestCard(this, h.seatIndex) ?? h.cards[0];
          this.emit('turn_timeout', h.seatIndex, { card: c });
          this.pick(h.seatIndex, c);
        }
      }
    }
  }

  private bestRowToTake(): number {
    let best = 0, bestHeads = Infinity;
    for (let i = 0; i < 4; i++) {
      const h = this.state.rows[i].reduce((a, c) => a + bullheads(c), 0);
      if (h < bestHeads) { best = i; bestHeads = h; }
    }
    return best;
  }
}

// ---------- bot ----------
/** 出牌建议：能安全放进某行的最大可放牌；否则出最小牌去挑最少牛头的行 */
export function suggestCard(g: NimmtGame, seat: number): number | null {
  const s = g.state;
  const hand = s.hands.find(h => h.seatIndex === seat)?.cards;
  if (!hand?.length) return null;
  const tails = s.rows.map(r => r[r.length - 1]);
  // 每张牌如果放进对应行会吃几张（行长 5 → 吃 5）
  const cost = (card: number) => {
    let best = -1, tail = 0;
    for (let i = 0; i < 4; i++) if (tails[i] < card && tails[i] > tail) { best = i; tail = tails[i]; }
    if (best < 0) return Math.min(...s.rows.map(r => r.reduce((a, c) => a + bullheads(c), 0)));
    return s.rows[best].length === 5 ? s.rows[best].reduce((a, c) => a + bullheads(c), 0) : 0;
  };
  const belowTail = (c: number) => {
    const below = tails.filter(t => t < c);
    return below.length ? Math.max(...below) : null;
  };
  // 优先：能放置且该行不足 5 张的牌里，选行尾差最小的（别人更容易插队 → 反而危险）
  const safe = hand.filter(c => { const t = belowTail(c); return t !== null && s.rows[tails.indexOf(t)].length < 5; });
  if (safe.length) {
    return safe.reduce((a, b) => ((a - belowTail(a)!) < (b - belowTail(b)!) ? a : b));
  }
  // 都不安全 → 代价最小的一张
  return hand.reduce((a, b) => (cost(b) < cost(a) ? b : a));
}

export function decideNimmtBot(g: NimmtGame, seat: number, _diff: string, rng: () => number = Math.random): GameAction | null {
  const s = g.state;
  if (s.phase === 'choose_row' && s.pendingRowChoice?.seat === seat) {
    // 选牛头最少的行
    let best = 0, bestHeads = Infinity;
    for (let i = 0; i < 4; i++) {
      const h = s.rows[i].reduce((a, c) => a + bullheads(c), 0);
      if (h < bestHeads) { best = i; bestHeads = h; }
    }
    return { type: 'choose_row', row: best };
  }
  if (s.phase === 'pick' && !(seat in s.picks)) {
    // 偶尔装傻出随机牌（低难度）
    const hand = s.hands.find(h => h.seatIndex === seat)?.cards ?? [];
    if (!hand.length) return null;
    const card = _diff === 'novice' && rng() < 0.3 ? hand[Math.floor(rng() * hand.length)] : suggestCard(g, seat)!;
    return { type: 'pick', card };
  }
  return null;
}
