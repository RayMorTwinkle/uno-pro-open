import { sameCard, type Card, type HouseRules } from '@uno-pro/shared';

/** 抢出只接受桌面上完全相同的牌，包含颜色与牌面。 */
export function jumpInCards(hand: Card[], top: Card, enabled: boolean): Card[] {
  return enabled ? hand.filter(c => sameCard(c, top)) : [];
}

/** 首牌决定合法性，后续同数字牌按手牌顺序放置，末牌决定生效颜色。 */
export function numberBundle(first: Card, hand: Card[], enabled: boolean): Card[] {
  if (!enabled || first.kind !== 'number') return [first];
  return [first, ...hand.filter(c => c.id !== first.id && c.kind === 'number' && c.value === first.value)];
}

/** 可在罚摸或质疑窗口打出的反制牌。只展示房主开启的叠加组合。 */
export function counterCards(hand: Card[], top: Card, rules?: HouseRules): Card[] {
  if (!rules || (top.kind !== 'draw_two' && top.kind !== 'wild_draw_four')) return [];
  return hand.filter(c => {
    if (c.kind === 'draw_two') return top.kind === 'draw_two' ? rules.stackDrawTwo : rules.crossStack;
    if (c.kind === 'wild_draw_four') return top.kind === 'wild_draw_four' ? rules.stackDrawFour : rules.crossStack;
    return false;
  });
}
