import { CardFace, CardBack } from '../components/Card';
import type { Card, Color } from '@uno-pro/shared';

/** 开发用牌面画廊：/ ?cards 访问 */
export default function CardGallery() {
  const colors: Color[] = ['red', 'yellow', 'green', 'blue'];
  let id = 1;
  const numCards = colors.flatMap(c =>
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(v => ({ id: id++, kind: 'number', color: c, value: v }) as Card));
  const actCards = colors.flatMap(c =>
    (['skip', 'reverse', 'draw_two'] as const).map(k => ({ id: id++, kind: k, color: c }) as Card));
  const wilds: Card[] = [
    { id: id++, kind: 'wild' } as Card,
    { id: id++, kind: 'wild_draw_four' } as Card,
  ];
  const Row = ({ cards }: { cards: Card[] }) => (
    <div className="flex flex-wrap gap-2 mb-3">
      {cards.map(c => <CardFace key={c.id} card={c} w={64} />)}
    </div>
  );
  return (
    <div className="felt h-full overflow-y-auto p-4">
      <div className="text-white font-bold mb-3">数字牌</div>
      <Row cards={numCards.slice(0, 10)} /><Row cards={numCards.slice(10, 20)} />
      <Row cards={numCards.slice(20, 30)} /><Row cards={numCards.slice(30)} />
      <div className="text-white font-bold mb-3">功能牌</div>
      <Row cards={actCards.slice(0, 4)} /><Row cards={actCards.slice(4, 8)} /><Row cards={actCards.slice(8)} />
      <div className="text-white font-bold mb-3">万能牌 / 牌背</div>
      <div className="flex gap-2"><Row cards={wilds} /><CardBack w={64} /></div>
    </div>
  );
}
