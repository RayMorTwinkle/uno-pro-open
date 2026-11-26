import { buildDeck, shuffle, sameCard, handScore } from './deck.js';
import {
  type Card, type Color, type GameState, type GameEvent, type HouseRules,
  type RoomSettings,
} from './types.js';

export interface SeatPlayer {
  seatIndex: number;
  key: string;      // playerId / botId
  name: string;
  isBot: boolean;
  difficulty?: import('./types.js').BotDifficulty;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** 可被出的牌判断（不含 pendingDraw 状态） */
export function cardMatches(card: Card, top: Card, activeColor: Color): boolean {
  if (card.kind === 'wild' || card.kind === 'wild_draw_four') return true;
  if (card.color === activeColor) return true;
  if (top.color === card.color) return true;
  if (card.kind === 'number' && top.kind === 'number' && card.value === top.value) return true;
  if (card.kind !== 'number' && card.kind === top.kind) return true;
  return false;
}

/** +4 是否合法：手中没有与打出前生效颜色相同的牌（数字/功能同色都算；万能牌不算） */
export function wildDrawFourLegal(hand: Card[], prevActiveColor: Color): boolean {
  return !hand.some(c => c.color === prevActiveColor && c.id !== -1);
}

let seqCounter = 0;

export class UnoGame {
  readonly seats: SeatPlayer[];
  readonly settings: RoomSettings;
  readonly rng: () => number;
  state: GameState;
  private eventSeq = 0;

  constructor(seats: SeatPlayer[], settings: RoomSettings, rng: () => number = Math.random) {
    this.seats = seats.slice().sort((a, b) => a.seatIndex - b.seatIndex);
    this.settings = settings;
    this.rng = rng;
    this.state = {
      hands: this.seats.map(s => ({ seatIndex: s.seatIndex, cards: [] })),
      deck: [],
      discard: [],
      current: 0,
      direction: 1,
      activeColor: 'red',
      pendingDraw: null,
      phase: 'play',
      challenge: null,
      unoCalled: [],
      unoVulnerable: {},
      drewThisTurn: null,
      turnStartedAt: Date.now(),
      round: 0,
      eliminated: [],
      finishOrder: [],
      lastEvent: null,
      log: [],
    };
  }

  get rules(): HouseRules {
    return this.settings.houseRules;
  }

  private emit(type: GameEvent['type'], seat: number, cardIds?: number[], detail?: Record<string, unknown>) {
    const ev: GameEvent = { seq: ++this.eventSeq, t: Date.now(), type, seat, cardIds, detail };
    this.state.lastEvent = ev;
    this.state.log.push(ev);
    return ev;
  }

  private handOf(seat: number): Card[] {
    const h = this.state.hands.find(h => h.seatIndex === seat);
    if (!h) throw new Error(`no hand for seat ${seat}`);
    return h.cards;
  }

  private inRound(seat: number): boolean {
    return !this.state.finishOrder.includes(seat) && !this.state.eliminated.includes(seat);
  }

  /** 本轮尚未取得名次、也未淘汰的座位（保留实际座号和桌面顺序）。 */
  activeHands() {
    return this.state.hands.filter(h => this.inRound(h.seatIndex));
  }

  /** from 可以是刚出完牌的座位，仍以它在原桌的位置寻找下家。 */
  nextSeat(from: number): number {
    const order = this.seats;
    const start = order.findIndex(s => s.seatIndex === from);
    for (let distance = 1; distance <= order.length; distance++) {
      const i = (start + distance * this.state.direction + order.length) % order.length;
      if (this.inRound(order[i].seatIndex)) return order[i].seatIndex;
    }
    return from;
  }

  /** 开始新一轮：洗牌发牌翻起始牌 */
  startRound(): void {
    const deck = shuffle(buildDeck(), this.rng);
    this.state.round += 1;
    this.state.hands = this.seats.map(s => ({ seatIndex: s.seatIndex, cards: [] }));
    for (let i = 0; i < 7; i++) {
      for (const s of this.seats) {
        if (this.state.eliminated.includes(s.seatIndex)) continue;
        this.handOf(s.seatIndex).push(deck.pop()!);
      }
    }
    // 翻起始牌；+4 放回重翻
    let top = deck.pop()!;
    let guard = 0;
    while (top.kind === 'wild_draw_four' && guard++ < 10) {
      deck.unshift(top);
      top = deck.pop()!;
    }
    this.state.discard = [top];
    this.state.deck = deck;
    this.state.finishOrder = [];
    this.state.current = this.activeHands()[0].seatIndex;
    this.state.direction = 1;
    this.state.activeColor = top.color ?? 'red';
    this.state.pendingDraw = null;
    this.state.challenge = null;
    this.state.unoCalled = [];
    this.state.unoVulnerable = {};
    this.state.drewThisTurn = null;
    this.state.phase = 'play';
    this.state.turnStartedAt = Date.now();
    this.emit('deal', this.state.current);
    this.emit('flip', this.state.current, [top.id]);

    // 起始功能牌效果
    if (top.kind === 'wild') {
      // 首玩家定色：等其 choose_color
      this.state.phase = 'choose_color';
      return;
    }
    if (top.kind === 'draw_two') {
      this.drawCards(this.state.current, 2, 'draw_penalty');
      this.state.current = this.nextSeat(this.state.current);
    } else if (top.kind === 'skip') {
      this.state.current = this.nextSeat(this.state.current);
    } else if (top.kind === 'reverse') {
      this.state.direction = -1;
      this.emit('direction', this.state.current);
      // 官方：反转后庄家（首座位）先出 —— current 保持本轮首位玩家
    }
    this.state.turnStartedAt = Date.now();
  }

  /** 当前生效颜色：弃牌堆顶为万能时取 activeColor */
  private topCard(): Card {
    return this.state.discard[this.state.discard.length - 1];
  }

  /** 摸 n 张，牌堆不足时重洗弃牌堆（留顶） */
  drawCards(seat: number, n: number, why: GameEvent['type']): Card[] {
    const drawn: Card[] = [];
    for (let i = 0; i < n; i++) {
      if (this.state.deck.length === 0) this.recycleDeck();
      if (this.state.deck.length === 0) break;
      const c = this.state.deck.pop()!;
      this.handOf(seat).push(c);
      drawn.push(c);
    }
    if (drawn.length) this.emit(why, seat, drawn.map(c => c.id));
    this.syncUnoFlag(seat);
    return drawn;
  }

  /** 手牌数不是 1 时撤销 UNO 标记/脆弱窗口；被动变成 1 张时开启脆弱窗口（可被抓） */
  private syncUnoFlag(seat: number) {
    const len = this.handOf(seat).length;
    if (len === 1) {
      if (!this.state.unoCalled.includes(seat) && !(seat in this.state.unoVulnerable)) {
        this.state.unoVulnerable[seat] = Date.now();
      }
      return;
    }
    const i = this.state.unoCalled.indexOf(seat);
    if (i >= 0) this.state.unoCalled.splice(i, 1);
    delete this.state.unoVulnerable[seat];
  }

  private recycleDeck() {
    if (this.state.discard.length <= 1) return;
    const top = this.state.discard.pop()!;
    this.state.deck = shuffle(this.state.discard, this.rng);
    this.state.discard = [top];
  }

  /** 某 seat 的合法动作集合（用于校验和 AI/提示） */
  legalCards(seat: number): Card[] {
    if (this.state.phase !== 'play') return [];
    const hand = this.handOf(seat);
    const top = this.topCard();
    const isCurrent = seat === this.state.current;

    // 有待摸叠加：只能反制（叠加村规开启时）
    if (this.state.pendingDraw && isCurrent) {
      const pd = this.state.pendingDraw;
      return hand.filter(c => {
        if (pd.kind === 'draw_two') {
          if (c.kind === 'draw_two' && this.rules.stackDrawTwo) return true;
          if (c.kind === 'wild_draw_four' && this.rules.crossStack) return true;
        } else {
          if (c.kind === 'wild_draw_four' && this.rules.stackDrawFour) return true;
          if (c.kind === 'draw_two' && this.rules.crossStack) return true;
        }
        return false;
      });
    }

    if (isCurrent) {
      // 摸牌后只能出刚摸的
      if (this.state.drewThisTurn) {
        const d = this.state.drewThisTurn;
        return cardMatches(d, top, this.state.activeColor) ? [d] : [];
      }
      return hand.filter(c => this.canPlayNow(c, hand));
    }

    // 非同牌��出：非当前玩家无合法出牌
    if (this.rules.jumpIn) {
      return hand.filter(c => sameCard(c, top));
    }
    return [];
  }

  /** 当前玩家打出 c 是否合法（含 +4 限制、末牌限制） */
  private canPlayNow(c: Card, hand: Card[]): boolean {
    const top = this.topCard();
    if (!cardMatches(c, top, this.state.activeColor)) return false;
    if (c.kind === 'wild_draw_four' && !this.rules.simpleMode) {
      if (!wildDrawFourLegal(hand.filter(x => x.id !== c.id), this.state.activeColor)) return false;
    }
    // 末牌限制
    if (hand.length === 1) {
      if (this.rules.noActionCardFinish && (c.kind === 'draw_two' || c.kind === 'wild_draw_four')) return false;
      if (this.rules.noWildFinish && (c.kind === 'wild' || c.kind === 'wild_draw_four')) return false;
    }
    return true;
  }

  /** UNO 脆弱窗口：任一后续动作发生后关闭（官方：下家行动前被抓才罚） */
  private clearVulnerability() {
    this.state.unoVulnerable = {};
  }

  /** 出牌。cardIds 支持同数字多牌（multiplePlaySameNumber） */
  play(seat: number, cardIds: number[], wildColor?: Color): ActionResult {
    const isJumpIn = seat !== this.state.current;
    if (this.state.phase !== 'play' && this.state.phase !== 'challenge') return { ok: false, error: '当前不能出牌' };

    const hand = this.handOf(seat);
    const cards = cardIds.map(id => hand.find(c => c.id === id));
    if (cards.some(c => !c)) return { ok: false, error: '手牌中没有这张牌' };
    const list = cards as Card[];
    const top = this.topCard();

    // 质疑窗口内：目标可选择反制（需叠加村规允许）
    if (this.state.phase === 'challenge') {
      const ch = this.state.challenge;
      if (!ch || ch.challengerSeat !== seat || isJumpIn) return { ok: false, error: '等待质疑处理' };
      if (list.length !== 1 || !this.canCounterCard(list[0])) return { ok: false, error: '质疑窗口只能反制或回应' };
      this.state.challenge = null;
      this.state.phase = 'play';
      this.clearVulnerability();
      this.applyPlay(seat, list, wildColor);
      return { ok: true };
    }

    if (isJumpIn) {
      if (!this.rules.jumpIn) return { ok: false, error: '未开启同牌抢出' };
      if (list.length !== 1 || !sameCard(list[0], top)) return { ok: false, error: '只能抢出完全相同的牌' };
      this.clearVulnerability();
      this.applyPlay(seat, list, wildColor, 'jump_in');
      return { ok: true };
    }

    if (this.state.drewThisTurn) {
      const d = this.state.drewThisTurn;
      if (list.length !== 1 || list[0].id !== d.id) return { ok: false, error: '摸牌后只能出刚摸的牌' };
    }

    if (this.state.pendingDraw) {
      // 只允许反制
      if (list.length !== 1 || !this.canCounterCard(list[0])) {
        return { ok: false, error: '被叠加时只能反制或摸牌' };
      }
      this.applyPlay(seat, list, wildColor);
      return { ok: true };
    }

    // 多牌同出
    if (list.length > 1) {
      if (!this.rules.multiplePlaySameNumber) return { ok: false, error: '未开启同数字全出' };
      const v = list[0].value;
      if (list.some(c => c.kind !== 'number' || c.value !== v)) return { ok: false, error: '只能同数字一起出' };
      if (!this.canPlayNow(list[0], hand)) return { ok: false, error: '第一张牌不合法' };
      this.applyPlay(seat, list, wildColor, 'multi_play');
      return { ok: true };
    }

    if (!this.canPlayNow(list[0], hand)) return { ok: false, error: '这张牌不能出' };
    this.clearVulnerability();
    this.applyPlay(seat, list, wildColor);
    return { ok: true };
  }

  private applyPlay(seat: number, cards: Card[], wildColor: Color | undefined, evType: GameEvent['type'] = 'play') {
    const hand = this.handOf(seat);
    const prevColor = this.state.activeColor;
    for (const c of cards) {
      const i = hand.findIndex(x => x.id === c.id);
      hand.splice(i, 1);
      this.state.discard.push(c);
    }
    const card = cards[cards.length - 1];
    this.emit(evType, seat, cards.map(c => c.id), { wildColor });
    this.state.drewThisTurn = null;

    // UNO 脆弱窗口：剩 1 张时标记；打出后不是 1 张则撤销 UNO 标
    this.syncUnoFlag(seat);
    if (hand.length === 1 && (this.rules.autoUno || this.rules.simpleMode)) {
      this.callUno(seat);
    }

    // 颜色
    const isWild = card.kind === 'wild' || card.kind === 'wild_draw_four';
    if (card.color) this.state.activeColor = card.color;

    // 摸牌类效果先计入 pendingDraw，使末张 +2/+4 在结算得分前强制下家摸牌
    if (card.kind === 'draw_two') {
      const add = this.state.pendingDraw?.count ?? 0;
      this.state.pendingDraw = { count: add + 2, kind: 'draw_two' };
    } else if (card.kind === 'wild_draw_four') {
      const add = this.state.pendingDraw?.count ?? 0;
      this.state.pendingDraw = { count: add + 4, kind: 'wild_draw_four' };
    }

    // 先确定名次。整轮结束时立刻结算；仍有人在场时继续处理本张牌的效果。
    if (hand.length === 0) {
      if (isWild) this.state.activeColor = wildColor ?? prevColor;
      const useFinishAll = this.rules.finishAll && this.aliveSeats() >= 3;
      if (!useFinishAll) {
        this.checkRoundEnd(seat);
        return;
      }
      // 决名次：此人出完，记名次；若只剩 1 人有牌则整轮结束
      this.state.finishOrder.push(seat);
      this.emit('player_out', seat, undefined, { rank: this.state.finishOrder.length });
      if (this.activeHands().length <= 1) {
        this.finishRankedRound();
        return;
      }
      // 否则继续：正常结算本张牌的方向/跳过效果（下家跳过已出完者）
    }

    // 其余效果
    const next = this.nextSeat(seat);
    switch (card.kind) {
      case 'skip':
        this.emit('skip', next);
        this.state.current = this.nextSeat(next);
        break;
      case 'reverse': {
        this.state.direction = (this.state.direction * -1) as 1 | -1;
        this.emit('direction', seat);
        if (hand.length > 0 && this.activeHands().length === 2) {
          this.state.current = seat; // 2 人局等效跳过
        } else {
          this.state.current = this.nextSeat(seat);
        }
        break;
      }
      case 'draw_two': {
        this.state.current = next;
        if (!this.canCounter(next)) this.settlePendingDraw();
        break;
      }
      case 'wild': {
        if (wildColor) {
          this.state.activeColor = wildColor;
          this.state.current = next;
        } else {
          this.state.phase = 'choose_color';
          this.state.current = seat;
          return;
        }
        break;
      }
      case 'wild_draw_four': {
        if (!wildColor) {
          this.state.phase = 'choose_color';
          this.state.current = seat;
          return;
        }
        this.state.activeColor = wildColor;
        this.setupDrawFour(seat, next, prevColor);
        return;
      }
      case 'number': {
        if (card.value === 0 && this.rules.zeroRotateHands) {
          this.rotateHands();
        } else if (card.value === 7 && this.rules.sevenSwapHands && hand.length > 0) {
          this.state.phase = 'swap_target';
          this.state.current = seat;
          return;
        }
        this.state.current = next;
        break;
      }
    }
    if (isWild) this.emit('wild', seat, [card.id], { color: this.state.activeColor });
    this.state.turnStartedAt = Date.now();
  }

  /** 非万能牌出完后直接调用；万能牌由 chooseColor 流程驱动 */
  chooseColor(seat: number, color: Color): ActionResult {
    if (this.state.phase !== 'choose_color' || seat !== this.state.current) {
      return { ok: false, error: '现在不能选色' };
    }
    const top = this.topCard();
    const prevColor = this.state.activeColor;
    this.state.activeColor = color;
    this.emit('wild', seat, [top.id], { color });
    const next = this.nextSeat(seat);
    if (top.kind === 'wild_draw_four') {
      this.setupDrawFour(seat, next, prevColor);
      return { ok: true };
    }
    this.state.phase = 'play';
    this.state.current = next;
    this.state.turnStartedAt = Date.now();
    return { ok: true };
  }

  private setupDrawFour(playedBy: number, target: number, prevColor: Color) {
    this.state.phase = 'play';
    this.state.current = target;

    const canStack = this.canCounter(target);
    const challengeOn = !this.rules.noChallenge && !this.rules.simpleMode;

    if (challengeOn) {
      this.state.phase = 'challenge';
      this.state.challenge = {
        challengerSeat: target, playedBySeat: playedBy, prevColor,
        deadline: Date.now() + (canStack ? 30000 : 15000),
      };
      return;
    }
    // 无质疑：直接待摸结算
    if (!canStack) this.settlePendingDraw();
  }

  /** 目标能否反制 pendingDraw */
  private canCounter(seat: number): boolean {
    const pd = this.state.pendingDraw;
    if (!pd) return false;
    return this.handOf(seat).some(c => this.canCounterCard(c));
  }

  /** 单张牌是否能反制当前 pendingDraw */
  private canCounterCard(c: Card): boolean {
    const pd = this.state.pendingDraw;
    if (!pd) return false;
    if (pd.kind === 'draw_two') {
      if (c.kind === 'draw_two' && this.rules.stackDrawTwo) return true;
      if (c.kind === 'wild_draw_four' && this.rules.crossStack) return true;
    } else {
      if (c.kind === 'wild_draw_four' && this.rules.stackDrawFour) return true;
      if (c.kind === 'draw_two' && this.rules.crossStack) return true;
    }
    return false;
  }

  /** 结算 pendingDraw：当前玩家摸牌并跳过 */
  private settlePendingDraw() {
    const pd = this.state.pendingDraw;
    if (!pd) return;
    const seat = this.state.current;
    this.state.pendingDraw = null;
    this.drawCards(seat, pd.count, 'draw_penalty');
    this.state.current = this.nextSeat(seat);
    this.state.phase = 'play';
    this.state.turnStartedAt = Date.now();
  }

  /** 回应质疑（仅 challenge phase） */
  respondChallenge(seat: number, challenge: boolean): ActionResult {
    const ch = this.state.challenge;
    if (this.state.phase !== 'challenge' || !ch || ch.challengerSeat !== seat) {
      return { ok: false, error: '不在质疑窗口' };
    }
    const playedBy = ch.playedBySeat;
    const prevColor = ch.prevColor ?? this.state.activeColor;
    this.state.challenge = null;
    this.state.phase = 'play';

    if (!challenge) {
      this.settlePendingDraw();
      return { ok: true };
    }
    const hand = this.handOf(playedBy);
    if (wildDrawFourLegal(hand, prevColor)) {
      // 合法：质疑者摸 6（4+2 罚）并跳过
      this.state.pendingDraw = null;
      this.drawCards(seat, 6, 'draw_penalty');
      this.emit('challenge_lose', seat);
      this.state.current = this.nextSeat(seat);
    } else {
      // 非法：出牌者摸 4，质疑者继续
      this.state.pendingDraw = null;
      this.drawCards(playedBy, 4, 'draw_penalty');
      this.emit('challenge_win', seat);
      this.state.current = seat;
    }
    this.state.turnStartedAt = Date.now();
    return { ok: true };
  }

  /** 7 换牌目标选择 */
  chooseSwapTarget(seat: number, targetSeat: number): ActionResult {
    if (this.state.phase !== 'swap_target' || seat !== this.state.current) {
      return { ok: false, error: '不能换牌' };
    }
    const target = this.activeHands().find(h => h.seatIndex === targetSeat);
    if (targetSeat === seat || !target) {
      return { ok: false, error: '请选择仍在场的其他玩家' };
    }
    const source = this.state.hands.find(h => h.seatIndex === seat)!;
    [source.cards, target.cards] = [target.cards, source.cards];
    this.syncUnoFlag(seat);
    this.syncUnoFlag(targetSeat);
    this.emit('swap_hands', seat, undefined, { target: targetSeat });
    this.state.phase = 'play';
    this.state.current = this.nextSeat(seat);
    this.state.turnStartedAt = Date.now();
    return { ok: true };
  }

  private rotateHands() {
    const hands = this.activeHands();
    const previous = hands.map(h => h.cards);
    for (let i = 0; i < hands.length; i++) {
      const source = (i - this.state.direction + hands.length) % hands.length;
      hands[i].cards = previous[source];
      this.syncUnoFlag(hands[i].seatIndex);
    }
    this.emit('rotate_hands', this.state.current);
  }

  /** 摸牌（主动）；质疑窗口内摸牌 = 接受 */
  draw(seat: number): ActionResult {
    if (this.state.phase === 'challenge') {
      if (this.state.challenge?.challengerSeat === seat) return this.respondChallenge(seat, false);
      return { ok: false, error: '等待质疑处理' };
    }
    if (this.state.phase !== 'play' || seat !== this.state.current) {
      return { ok: false, error: '不是你的回合' };
    }
    if (this.state.drewThisTurn) return { ok: false, error: '本回合已摸过' };

    if (this.state.pendingDraw) {
      this.clearVulnerability();
      this.settlePendingDraw();
      return { ok: true };
    }

    this.clearVulnerability();
    const limit = this.rules.drawUntilPlayable ? 40 : 1;
    let drawn: Card[] = [];
    let last: Card | null = null;
    do {
      drawn = this.drawCards(seat, 1, 'draw');
      if (!drawn.length) break;
      last = drawn[0];
      if (this.canPlayNow(last, this.handOf(seat))) break;
    } while (this.rules.drawUntilPlayable && drawn.length < limit);

    if (!last) {
      // 无牌可摸：跳过
      this.state.current = this.nextSeat(seat);
      this.state.turnStartedAt = Date.now();
      return { ok: true };
    }

    if (this.canPlayNow(last, this.handOf(seat))) {
      if (this.rules.forcedPlayAfterDraw || this.rules.simpleMode) {
        this.applyPlay(seat, [last], undefined);
        return { ok: true };
      }
      this.state.drewThisTurn = last;
      return { ok: true }; // 可出刚摸的或选择过牌
    }
    this.state.current = this.nextSeat(seat);
    this.state.turnStartedAt = Date.now();
    return { ok: true };
  }

  /** 摸牌后选择过牌（官方规则：摸后只能出摸的，也可放弃） */
  pass(seat: number): ActionResult {
    if (this.state.phase !== 'play' || seat !== this.state.current) return { ok: false, error: '不能过牌' };
    if (!this.state.drewThisTurn) return { ok: false, error: '未摸牌不能过' };
    this.clearVulnerability();
    this.state.drewThisTurn = null;
    this.state.current = this.nextSeat(seat);
    this.state.turnStartedAt = Date.now();
    return { ok: true };
  }

  private callUno(seat: number) {
    if (this.state.unoCalled.includes(seat)) return;
    this.state.unoCalled.push(seat);
    delete this.state.unoVulnerable[seat];
    this.emit('uno', seat);
  }

  uno(seat: number): ActionResult {
    const hand = this.handOf(seat);
    if (this.rules.simpleMode) return { ok: true }; // 静默
    if (this.rules.strictUnoCall && hand.length !== 1) return { ok: false, error: '只能剩1张时喊' };
    this.callUno(seat);
    return { ok: true };
  }

  /** 抓 UNO：target 处于脆弱窗口且未喊 → 罚摸 */
  catchUno(catcher: number, target: number): ActionResult {
    if (this.rules.simpleMode || this.rules.autoUno) return { ok: false, error: 'UNO 已自动' };
    const vul = this.state.unoVulnerable[target];
    if (!vul || this.state.unoCalled.includes(target)) return { ok: false, error: '抓不到' };
    delete this.state.unoVulnerable[target];
    this.drawCards(target, this.rules.unoPenalty, 'draw_penalty');
    this.emit('uno_caught', target, undefined, { by: catcher });
    return { ok: true };
  }

  /** 服务端回合超时调用 */
  timeoutTurn(): void {
    const seat = this.state.current;
    this.emit('turn_timeout', seat);
    if (this.state.phase === 'challenge' && this.state.challenge) {
      this.respondChallenge(seat, false);
      return;
    }
    if (this.state.phase === 'choose_color') {
      // 随机选色
      const hand = this.handOf(seat);
      const color = hand.find(c => c.color)?.color ?? 'red';
      this.chooseColor(seat, color);
      return;
    }
    if (this.state.phase === 'swap_target') {
      const target = this.nextSeat(seat);
      this.chooseSwapTarget(seat, target);
      return;
    }
    if (this.state.pendingDraw) {
      this.settlePendingDraw();
      return;
    }
    // 摸 1 张跳过
    this.drawCards(seat, 1, 'draw');
    this.state.drewThisTurn = null;
    this.state.current = this.nextSeat(seat);
    this.state.turnStartedAt = Date.now();
  }

  private aliveSeats(): number {
    return this.seats.length - this.state.eliminated.length;
  }

  /** finishAll：只剩 1 人有牌时收尾，按 finishOrder 定名次 */
  private finishRankedRound() {
    // 结算未清的叠加摸牌：由最后有牌者吃下
    const [lastSeat] = this.activeHands();
    const pd = this.state.pendingDraw;
    if (pd && lastSeat) {
      this.state.pendingDraw = null;
      this.drawCards(lastSeat.seatIndex, pd.count, 'draw_penalty');
    }
    const points = lastSeat ? handScore(this.handOf(lastSeat.seatIndex)) : 0;
    const winnerSeatIdx = this.state.finishOrder[0];
    const winner = this.seats.find(s => s.seatIndex === winnerSeatIdx)!;
    this.emit('round_end', winnerSeatIdx, undefined, {
      points, winner: winner.key, ranks: [...this.state.finishOrder],
    });
    if (this.rules.elimination && lastSeat) {
      this.state.eliminated.push(lastSeat.seatIndex);
      this.emit('eliminated', lastSeat.seatIndex);
    }
    const reached = this.settings.targetScore > 0 && (this.getScore(winner.key) + points) >= this.settings.targetScore;
    const lastAlive = this.rules.elimination && this.aliveSeats() <= 1;
    this.state.phase = reached || lastAlive || this.settings.targetScore === 0 ? 'match_over' : 'round_over';
    if (this.state.phase === 'match_over') {
      this.emit('match_end', winnerSeatIdx, undefined, { winner: winner.key });
    }
  }

  private checkRoundEnd(seat: number): boolean {
    const hand = this.handOf(seat);
    if (hand.length > 0) {
      // 剩余一张时清除其脆弱窗口之外的状态
      return false;
    }
    // 官方：末牌是 +2/+4 时下家仍须摸牌，计入得分
    const pd = this.state.pendingDraw;
    if (pd) {
      const victim = this.nextSeat(seat);
      this.state.pendingDraw = null;
      this.drawCards(victim, pd.count, 'draw_penalty');
    }

    const points = this.state.hands
      .filter(h => h.seatIndex !== seat)
      .reduce((s, h) => s + handScore(h.cards), 0);

    const winner = this.seats.find(s => s.seatIndex === seat)!;
    this.emit('round_end', seat, undefined, { points, winner: winner.key });

    // 淘汰制：手牌分值最高者淘汰
    if (this.rules.elimination) {
      let worst = -1, worstSeat = -1;
      for (const h of this.state.hands) {
        if (h.seatIndex === seat || this.state.eliminated.includes(h.seatIndex)) continue;
        const sc = handScore(h.cards);
        if (sc > worst) { worst = sc; worstSeat = h.seatIndex; }
      }
      if (worstSeat >= 0) {
        this.state.eliminated.push(worstSeat);
        this.emit('eliminated', worstSeat);
      }
    }

    const reached = this.settings.targetScore > 0 && (this.getScore(winner.key) + points) >= this.settings.targetScore;
    const lastAlive = this.rules.elimination && this.aliveSeats() <= 1;
    this.state.phase = reached || lastAlive || this.settings.targetScore === 0 ? 'match_over' : 'round_over';
    if (this.state.phase === 'match_over') {
      this.emit('match_end', seat, undefined, { winner: winner.key });
    }
    return true;
  }

  /** 本轮赢家应得分（供服务端累计） */
  roundPoints(): { seat: number; points: number } | null {
    const ev = [...this.state.log].reverse().find(e => e.type === 'round_end');
    if (!ev) return null;
    return { seat: ev.seat, points: (ev.detail?.points as number) ?? 0 };
  }

  private scoresMap: Record<string, number> = {};
  private getScore(key: string): number {
    return this.scoresMap[key] ?? 0;
  }
  addScore(key: string, pts: number) {
    this.scoresMap[key] = (this.scoresMap[key] ?? 0) + pts;
  }
  get scores() { return this.scoresMap; }
}
