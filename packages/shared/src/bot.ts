import { UnoGame } from './engine.js';
import type { BotDifficulty, Card, Color } from './types.js';

export interface BotAction {
  type: 'play' | 'draw' | 'pass' | 'challenge' | 'choose_color' | 'swap_target' | 'uno' | 'catch';
  cardIds?: number[];
  wildColor?: Color;
  challenge?: boolean;
  color?: Color;
  targetSeat?: number;
}

const COLORS: Color[] = ['red', 'yellow', 'green', 'blue'];

function bestColor(hand: Card[]): Color {
  const count = { red: 0, yellow: 0, green: 0, blue: 0 };
  for (const c of hand) if (c.color) count[c.color] += c.kind === 'number' ? 1 : 2;
  return COLORS.reduce((a, b) => (count[b] > count[a] ? b : a));
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** 返回 bot 当前应执行的动作；null = 无事可做 */
export function decideBotAction(game: UnoGame, seat: number, difficulty: BotDifficulty, rng: () => number = Math.random): BotAction | null {
  const s = game.state;
  const hand = s.hands.find(h => h.seatIndex === seat)?.cards ?? [];

  // 质疑窗口
  if (s.phase === 'challenge' && s.challenge?.challengerSeat === seat) {
    if (difficulty === 'novice') {
      return { type: 'challenge', challenge: rng() < 0.3 };
    }
    // easy+: 基于概率——若出牌人手牌剩很少更倾向质疑；hard 结合已知信息
    const p = difficulty === 'easy' ? 0.35 : difficulty === 'normal' ? 0.5 : 0.62;
    return { type: 'challenge', challenge: rng() < p };
  }

  // 选色
  if (s.phase === 'choose_color' && s.current === seat) {
    return { type: 'choose_color', color: difficulty === 'novice' ? pick(rng, COLORS) : bestColor(hand) };
  }

  // 换牌
  if (s.phase === 'swap_target' && s.current === seat) {
    const others = game.activeHands().filter(h => h.seatIndex !== seat);
    const target = difficulty === 'novice'
      ? pick(rng, others).seatIndex
      : others.reduce((a, b) => (a.cards.length < b.cards.length ? a : b)).seatIndex;
    return { type: 'swap_target', targetSeat: target };
  }

  if (s.phase !== 'play') return null;

  // 抓 UNO（hard 必抓；normal 80%；easy 50%；novice 不抓）
  const catchP = difficulty === 'hard' ? 1 : difficulty === 'normal' ? 0.8 : difficulty === 'easy' ? 0.5 : 0;
  for (const seatStr of Object.keys(s.unoVulnerable)) {
    const target = Number(seatStr);
    if (target !== seat && rng() < catchP) return { type: 'catch', targetSeat: target };
  }

  const legal = game.legalCards(seat);
  const isMyTurn = s.current === seat;

  if (legal.length === 0) {
    // 无牌可出
    if (!isMyTurn) return null;
    if (s.pendingDraw) return { type: 'draw' };
    if (s.drewThisTurn) return { type: 'pass' };
    return { type: 'draw' };
  }

  if (!isMyTurn) {
    // jump-in 抢出（有一定思考延迟由服务端控制）
    const p = difficulty === 'hard' ? 0.95 : difficulty === 'normal' ? 0.8 : difficulty === 'easy' ? 0.6 : 0.35;
    if (rng() < p) return { type: 'play', cardIds: [legal[0].id] };
    return null;
  }

  // 选择要出的牌
  let choice: Card;
  if (difficulty === 'novice') {
    choice = pick(rng, legal);
  } else {
    choice = chooseCard(game, seat, legal, difficulty);
  }

  const wildColor = (choice.kind === 'wild' || choice.kind === 'wild_draw_four') ? bestColor(hand) : undefined;

  // 出到剩1张时喊 UNO（非 autoUno 时）
  if (hand.length === 2 && !s.unoCalled.includes(seat)) {
    const callP = difficulty === 'hard' ? 0.98 : difficulty === 'normal' ? 0.9 : difficulty === 'easy' ? 0.75 : 0.5;
    if (rng() < callP) {
      // 先喊再出（返回 uno 动作，服务端会在下一轮调度出牌）
      return { type: 'uno' };
    }
  }

  return { type: 'play', cardIds: [choice.id], wildColor };
}

function chooseCard(game: UnoGame, seat: number, legal: Card[], difficulty: BotDifficulty): Card {
  const s = game.state;
  const hand = s.hands.find(h => h.seatIndex === seat)!.cards;

  const nonWild = legal.filter(c => c.color !== null);
  const wilds = legal.filter(c => c.color === null);
  const numbers = nonWild.filter(c => c.kind === 'number');
  const actions = nonWild.filter(c => c.kind !== 'number');

  // 下家牌数（用于决策进攻性）
  const next = game.nextSeat(seat);
  const nextHand = s.hands.find(h => h.seatIndex === next);
  const nextLow = nextHand && nextHand.cards.length <= 2;

  if (difficulty === 'easy') {
    // 优先数字牌，保留功能/万能
    const pool = numbers.length ? numbers : nonWild.length ? nonWild : wilds;
    return pool.reduce((a, b) => (cardVal(b) < cardVal(a) ? b : a));
  }

  // normal/hard：
  // 1) 下家牌少 → 优先 +2/+4/skip 压制
  if (nextLow) {
    const attack = legal.filter(c => c.kind === 'draw_two' || c.kind === 'wild_draw_four' || c.kind === 'skip');
    if (attack.length) return attack.reduce((a, b) => (cardVal(b) > cardVal(a) ? b : a));
  }
  // 2) 自己牌多 → 优先高分牌卸货；normal 也留一张万能保命
  if (nonWild.length) {
    const scored = nonWild.map(c => ({ c, v: cardVal(c) + (hand.filter(h => h.color === c.color).length) }));
    scored.sort((a, b) => b.v - a.v);
    return scored[0].c;
  }
  // 3) 只能出万能：hard 在万不得已才打 +4（先打普通 wild）
  const plainWild = wilds.find(c => c.kind === 'wild');
  if (difficulty === 'hard' && plainWild && wilds.length > 1) return plainWild;
  return wilds[0];
}

function cardVal(c: Card): number {
  if (c.kind === 'number') return c.value!;
  if (c.kind === 'wild' || c.kind === 'wild_draw_four') return 50;
  return 20;
}
