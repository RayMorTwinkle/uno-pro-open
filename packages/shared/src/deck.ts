import { COLORS, type Card } from './types.js';

/** 官方 108 张牌组 */
export function buildDeck(): Card[] {
  const deck: Card[] = [];
  let id = 0;
  for (const color of COLORS) {
    deck.push({ id: id++, color, kind: 'number', value: 0 });
    for (let v = 1; v <= 9; v++) {
      deck.push({ id: id++, color, kind: 'number', value: v });
      deck.push({ id: id++, color, kind: 'number', value: v });
    }
    for (const kind of ['skip', 'reverse', 'draw_two'] as const) {
      deck.push({ id: id++, color, kind });
      deck.push({ id: id++, color, kind });
    }
  }
  for (let i = 0; i < 4; i++) deck.push({ id: id++, color: null, kind: 'wild' });
  for (let i = 0; i < 4; i++) deck.push({ id: id++, color: null, kind: 'wild_draw_four' });
  return deck;
}

/** Fisher-Yates，可注入 rng 便于测试 */
export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 计分：赢家获得其他玩家剩余手牌分值 */
export function cardScore(c: Card): number {
  switch (c.kind) {
    case 'number':
      return c.value ?? 0;
    case 'skip':
    case 'reverse':
    case 'draw_two':
      return 20;
    case 'wild':
    case 'wild_draw_four':
      return 50;
  }
}

export function handScore(cards: Card[]): number {
  return cards.reduce((s, c) => s + cardScore(c), 0);
}

/** 完全相同的牌（jump-in 用）：颜色+种类+面值一致 */
export function sameCard(a: Card, b: Card): boolean {
  return a.color === b.color && a.kind === b.kind && a.value === b.value;
}
