import type { SeatPlayer, GameAction, ActionResult, EventLite } from '../types.js';
import type { RoomSettings } from '../../types.js';

// 牌：fruit 0-3（香蕉/草莓/青柠/李子），count 1-5
export interface GalliCard { fruit: number; count: number }
const FRUITS = 4;

export function buildDeck(): GalliCard[] {
  const deck: GalliCard[] = [];
  for (let f = 0; f < FRUITS; f++)
    for (const c of [1, 2, 3, 4, 5])
      for (let k = 0; k < 4; k++) deck.push({ fruit: f, count: c }); // 每种面值4张 → 80张
  return deck;
}
export const FRUIT_NAME = ['香蕉', '草莓', '青柠', '李子'];
export const FRUIT_ICON = ['🍌', '🍓', '🍈', '🍇'];

export interface GalliState {
  hands: Record<number, GalliCard[]>;      // 底牌堆（牌堆顶 = index 0）
  open: Record<number, GalliCard[]>;       // 每人面前的明牌堆（index 0 = 最顶）
  current: number;                          // 下一个该翻牌的人
  alive: number[];                          // 还有牌的座位
  phase: 'play' | 'slap_wait' | 'match_over';
  windowUntil: number;                      // 抢拍窗口到期（0=无窗口）
  flipDeadline: number;                     // 当前人翻牌兜底
  turn: number;
  lastFlip: { seat: number; card: GalliCard } | null;
  lastSlap: { seat: number; correct: boolean; fruit: number | null } | null;
  log: GalliEvent[];
  lastEvent: GalliEvent | null;
  botFlipAt: number;                        // bot 当前人预定翻牌时刻
  botSlapAt: Record<number, number>;        // 窗口期 bot 预定拍铃时刻
  /** 结算用：各座位赢得牌堆次数 */
  wins: Record<number, number>;
}
export interface GalliEvent extends EventLite {
  type: 'flip' | 'slap_window' | 'slap_win' | 'slap_wrong' | 'out' | 'match_end' | 'timeout';
}

const FLIP_MS = 3500;        // 每人翻牌节奏上限
const WINDOW_MS = 6000;      // 抢拍窗口（无人拍则继续翻）
const PENALTY_PER = 1;       // 拍错每人罚给几张
const MAX_TURN = 1200;       // 安全阀

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class GalliGame {
  seats: SeatPlayer[];
  state: GalliState;
  private seq = 0;
  private rng: () => number;

  constructor(seats: SeatPlayer[], _s: RoomSettings, rng: () => number = Math.random) {
    this.seats = seats;
    this.rng = rng;
    const hands: Record<number, GalliCard[]> = {};
    const open: Record<number, GalliCard[]> = {};
    const deck = shuffle(buildDeck(), rng);
    seats.forEach((p, i) => { hands[p.seatIndex] = []; open[p.seatIndex] = []; });
    deck.forEach((c, i) => hands[seats[i % seats.length].seatIndex].push(c));
    this.state = {
      hands, open, current: seats[0].seatIndex, alive: seats.map(p => p.seatIndex),
      phase: 'play', windowUntil: 0, flipDeadline: Date.now() + FLIP_MS,
      turn: 0, lastFlip: null, lastSlap: null, log: [], lastEvent: null,
      botFlipAt: 0, botSlapAt: {}, wins: {},
    };
  }

  private emit(t: GalliEvent['type'], seat: number, detail?: Record<string, unknown>) {
    const ev: GalliEvent = { seq: ++this.seq, t: Date.now(), type: t, seat, detail };
    this.state.lastEvent = ev;
    this.state.log.push(ev);
  }
  private isBot(seat: number) { return !!this.seats.find(p => p.seatIndex === seat)?.isBot; }

  /** 当前所有明牌顶的水果计数；返回凑满 5 的水果（-1 = 无） */
  fiveFruit(): number {
    const s = this.state;
    const sum = [0, 0, 0, 0];
    for (const seat of s.alive) {
      const top = s.open[seat]?.[0];
      if (top) sum[top.fruit] += top.count;
    }
    for (let f = 0; f < FRUITS; f++) if (sum[f] === 5) return f;
    return -1;
  }

  private nextSeat(seat: number): number {
    const s = this.state;
    const i = s.alive.indexOf(seat);
    return s.alive[(i + 1) % s.alive.length];
  }

  private armFlip() {
    const s = this.state;
    s.flipDeadline = Date.now() + FLIP_MS;
    s.botFlipAt = this.isBot(s.current) ? Date.now() + 700 + this.rng() * 1800 : 0;
  }

  /** 没牌可翻者出局（明牌移出游戏）；返回是否发生淘汰 */
  private eliminateIfEmpty(seat: number): boolean {
    const s = this.state;
    if ((s.hands[seat]?.length ?? 0) > 0) return false;
    s.open[seat] = [];
    s.alive = s.alive.filter(x => x !== seat);
    this.emit('out', seat);
    if (s.current === seat && s.alive.length) {
      // 下一位：被淘汰者在 alive 中原位置的下一个
      s.current = this.nextSeat(seat);
      if (!s.alive.includes(s.current)) s.current = s.alive[0];
    }
    return true;
  }

  flip(seat: number): ActionResult {
    const s = this.state;
    if (s.phase !== 'play') return { ok: false, error: '现在不能翻' };
    if (seat !== s.current) return { ok: false, error: '没轮到你' };
    if (this.eliminateIfEmpty(seat)) { this.armFlip(); this.checkEnd(); return { ok: false, error: '你没牌了，出局' }; }
    const card = s.hands[seat].shift()!;
    s.open[seat].unshift(card);
    s.lastFlip = { seat, card };
    s.turn += 1;
    this.emit('flip', seat, { fruit: card.fruit, count: card.count });
    const f = this.fiveFruit();
    if (f >= 0) {
      // 凑满 5 → 开抢拍窗口；bot 按反应时差序进场
      s.phase = 'slap_wait';
      s.windowUntil = Date.now() + WINDOW_MS;
      s.botSlapAt = {};
      for (const p of this.seats) {
        if (!p.isBot || !s.alive.includes(p.seatIndex)) continue;
        // 反应时间：高手 280-700ms，普通 500-1400ms
        const fast = (p.difficulty ?? 'normal') === 'hard';
        s.botSlapAt[p.seatIndex] = Date.now() + (fast ? 280 + this.rng() * 420 : 500 + this.rng() * 900);
      }
      this.emit('slap_window', -1, { fruit: f });
    } else {
      s.current = this.nextSeat(seat);
      this.armFlip();
    }
    this.checkEnd();
    return { ok: true };
  }

  slap(seat: number): ActionResult {
    const s = this.state;
    if (s.phase === 'match_over') return { ok: false, error: '已结束' };
    if (!s.alive.includes(seat)) return { ok: false, error: '你已出局' };
    const inWindow = s.phase === 'slap_wait' && Date.now() <= s.windowUntil;
    const f = this.fiveFruit();
    if (inWindow && f >= 0) {
      // 拍对：收走全场明牌
      const taken: GalliCard[] = [];
      for (const st of s.alive) { taken.push(...s.open[st]); s.open[st] = []; }
      for (const c of shuffle(taken, this.rng)) s.hands[seat].push(c);
      s.wins[seat] = (s.wins[seat] ?? 0) + 1;
      s.lastSlap = { seat, correct: true, fruit: f };
      this.emit('slap_win', seat, { fruit: f, taken: taken.length });
      s.phase = 'play';
      s.windowUntil = 0;
      s.botSlapAt = {};
      s.current = this.nextSeat(seat); // 拍中者的下家开翻
      this.armFlip();
    } else {
      // 拍错：给每个存活玩家发 1 张（含 bot），明牌不动
      s.lastSlap = { seat, correct: false, fruit: inWindow ? f : null };
      let gave = 0;
      for (const st of s.alive) {
        if (st === seat) continue;
        const c = s.hands[seat]?.shift();
        if (c) { s.hands[st].push(c); gave++; }
      }
      this.emit('slap_wrong', seat, { gave });
      // 罚完可能没牌 → 移除 alive
      if (!s.hands[seat]?.length) {
        s.alive = s.alive.filter(x => x !== seat);
        this.emit('out', seat);
        if (s.current === seat) s.current = this.nextSeat(s.alive[0] ?? seat);
      }
      if (s.phase === 'slap_wait') {
        // 窗口继续？官方规则拍错窗口关闭继续翻牌
        s.phase = 'play';
        s.windowUntil = 0;
        s.botSlapAt = {};
        if (s.alive.includes(s.current)) this.armFlip();
        else if (s.alive.length) { s.current = this.nextSeat(s.alive[0]); this.armFlip(); }
      }
    }
    this.checkEnd();
    return { ok: true };
  }

  private checkEnd() {
    const s = this.state;
    // 没底牌且没明牌的人出局
    for (const seat of [...s.alive]) {
      if (!s.hands[seat]?.length && !s.open[seat]?.length) {
        s.alive = s.alive.filter(x => x !== seat);
        this.emit('out', seat);
        if (s.current === seat && s.alive.length) s.current = this.nextSeat(seat === s.alive[s.alive.length - 1] ? s.alive[0] : seat);
      }
    }
    if (s.alive.length <= 1 || s.turn > MAX_TURN) {
      s.phase = 'match_over';
      s.windowUntil = 0;
      const order = [...this.seats].sort((a, b) =>
        ((s.hands[b.seatIndex]?.length ?? 0) + (s.open[b.seatIndex]?.length ?? 0)) -
        ((s.hands[a.seatIndex]?.length ?? 0) + (s.open[a.seatIndex]?.length ?? 0)));
      this.emit('match_end', -1, { winner: order[0]?.key, order: order.map(p => p.seatIndex) });
    }
  }

  /** bot 心跳：翻牌/拍铃按各自时刻表执行 */
  botTick() {
    const s = this.state;
    const now = Date.now();
    if (s.phase === 'match_over') return;
    if (s.phase === 'slap_wait') {
      if (now >= s.windowUntil) {
        // 没人拍 → 继续翻牌
        s.phase = 'play';
        s.windowUntil = 0;
        s.botSlapAt = {};
        s.current = this.nextSeat(s.current);
        this.armFlip();
        return;
      }
      const due = Object.entries(s.botSlapAt).filter(([, t]) => now >= t).map(([k]) => +k);
      if (due.length) {
        const seat = due[0];
        delete s.botSlapAt[seat];
        this.slap(seat);
      }
      return;
    }
    if (now >= s.flipDeadline || (s.botFlipAt && now >= s.botFlipAt)) {
      // 当前人没牌 → 自动淘汰并轮转，不空等
      if (!(s.hands[s.current]?.length)) { this.eliminateIfEmpty(s.current); if (s.alive.length) this.armFlip(); this.checkEnd(); return; }
      this.flip(s.current);
      return;
    }
    // bot 误拍彩蛋：极小概率在窗口外手滑（给真人制造笑点，0.2%/tick 可忽略）
  }
}
