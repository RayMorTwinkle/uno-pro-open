import { memo } from 'react';
import type { Card, Color } from '@uno-pro/shared';

export const COLOR_HEX: Record<Color, string> = {
  red: '#ee3b3b', yellow: '#f7b500', green: '#38b54a', blue: '#2f80ed',
};
export const COLOR_DARK: Record<Color, string> = {
  red: '#a5121e', yellow: '#b87700', green: '#147434', blue: '#1450b4',
};
const COLOR_LIGHT: Record<Color, string> = {
  red: '#ff6b5e', yellow: '#ffd154', green: '#5fd97a', blue: '#63a9ff',
};
export const COLORBLIND_SYMBOL: Record<Color, string> = {
  red: '●', yellow: '◆', green: '▼', blue: '■',
};

const NUM_FONT = "'Baloo 2','Arial Rounded MT Bold','Arial Black',Arial,sans-serif";

function cornerText(card: Card): string {
  if (card.kind === 'number') return String(card.value);
  if (card.kind === 'draw_two') return '+2';
  if (card.kind === 'wild_draw_four') return '+4';
  return '';
}

/** 角标小图标：skip / reverse / wild 不用 unicode，直接画 */
function CornerIcon({ card }: { card: Card }) {
  if (card.kind === 'skip') {
    return (
      <g fill="none" stroke="#fff" strokeWidth="4">
        <circle r="10" /><line x1="-7" y1="-7" x2="7" y2="7" />
      </g>
    );
  }
  if (card.kind === 'reverse') {
    return (
      <g fill="#fff" transform="scale(.3) rotate(45)">
        <path d="M-32 -24 H8 V-32 L32 -17 L8 -2 V-10 H-32 Z" />
        <path d="M32 24 H-8 V32 L-32 17 L-8 2 V10 H32 Z" />
      </g>
    );
  }
  // wild：四色小椭圆
  return <g transform="scale(.38)"><QuadOval /></g>;
}

/** 万能牌象限图标（四色椭圆） */
function QuadOval({ size = 1 }: { size?: number }) {
  const r = 24 * size;
  return (
    <g>
      <path d={`M 0 ${-r} A ${r} ${r * 1.15} 0 0 1 ${r * 0.92} 0 L 0 0 Z`} fill={COLOR_HEX.red} />
      <path d={`M ${r * 0.92} 0 A ${r} ${r * 1.15} 0 0 1 0 ${r * 1.15} L 0 0 Z`} fill={COLOR_HEX.yellow} />
      <path d={`M 0 ${r * 1.15} A ${r} ${r * 1.15} 0 0 1 ${-r * 0.92} 0 L 0 0 Z`} fill={COLOR_HEX.green} />
      <path d={`M ${-r * 0.92} 0 A ${r} ${r * 1.15} 0 0 1 0 ${-r} L 0 0 Z`} fill={COLOR_HEX.blue} />
      <ellipse rx={r} ry={r * 1.15} fill="none" stroke="#fff" strokeWidth={2.5 * size} />
    </g>
  );
}

/** 迷你小牌（+2/+4 图案用）：白边 + 彩面 + 小椭圆，像真牌的缩小版 */
function MiniCard({ x, y, rot, fill }: { x: number; y: number; rot: number; fill: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}
      style={{ filter: 'drop-shadow(0 1.5px 1px rgba(0,0,0,.25))' }}>
      <rect x="-11" y="-16" width="22" height="32" rx="4" fill="#fff" />
      <rect x="-8.6" y="-13.6" width="17.2" height="27.2" rx="3" fill={fill} />
      <ellipse rx="4.6" ry="7" fill="#fff" opacity=".95" transform="rotate(-24)" />
    </g>
  );
}

/** 椭圆内的主图案（白底上，用牌色绘制） */
function FaceSymbol({ card }: { card: Card }) {
  const c = card.color ? COLOR_HEX[card.color] : '#141828';
  const cd = card.color ? COLOR_DARK[card.color] : '#000';
  if (card.kind === 'number') {
    return (
      <g>
        <text x="50" y="92" textAnchor="middle" fontSize="62" fontWeight="900"
          fontFamily={NUM_FONT} fill={c} stroke={cd} strokeWidth="2.2"
          paintOrder="stroke" style={{ filter: 'drop-shadow(0 2px 1px rgba(0,0,0,.18))' }}>
          {card.value}
        </text>
        {(card.value === 6 || card.value === 9) &&
          <rect x="38" y="102" width="24" height="5" rx="2.5" fill={c} />}
      </g>
    );
  }
  if (card.kind === 'skip') {
    return (
      <g transform="translate(50 75)">
        <circle r="25" fill="none" stroke={c} strokeWidth="11" />
        <line x1="-17" y1="17" x2="17" y2="-17" stroke={c} strokeWidth="11" strokeLinecap="round" />
      </g>
    );
  }
  if (card.kind === 'reverse') {
    return (
      <g transform="translate(50 76) rotate(-26)" fill={c}>
        <path d="M-32 -24 H8 V-32 L32 -17 L8 -2 V-10 H-32 Z"
          style={{ filter: 'drop-shadow(0 2px 1px rgba(0,0,0,.15))' }} />
        <path d="M32 24 H-8 V32 L-32 17 L-8 2 V10 H32 Z"
          style={{ filter: 'drop-shadow(0 2px 1px rgba(0,0,0,.15))' }} />
      </g>
    );
  }
  if (card.kind === 'draw_two') {
    return (
      <g transform="translate(50 75)">
        <MiniCard x={-11} y={5} rot={-13} fill={COLOR_LIGHT[card.color as Color] ?? c} />
        <MiniCard x={11} y={-5} rot={11} fill={c} />
      </g>
    );
  }
  if (card.kind === 'wild') {
    return <g transform="translate(50 75)"><QuadOval /></g>;
  }
  // wild_draw_four
  return (
    <g transform="translate(50 75)">
      <MiniCard x={-21} y={0} rot={-16} fill={COLOR_HEX.blue} />
      <MiniCard x={-7} y={-7} rot={-5} fill={COLOR_HEX.green} />
      <MiniCard x={7} y={-7} rot={5} fill={COLOR_HEX.yellow} />
      <MiniCard x={21} y={0} rot={16} fill={COLOR_HEX.red} />
      <text x="0" y="36" fontSize="19" fontWeight="900" fontFamily={NUM_FONT}
        fill="#141828" textAnchor="middle" paintOrder="stroke" stroke="#fff" strokeWidth="4">+4</text>
    </g>
  );
}

export const CardFace = memo(function CardFace({
  card, w = 72, selected = false, playable = false, dimmed = false, colorblind = false,
}: {
  card: Card; w?: number; selected?: boolean; playable?: boolean; dimmed?: boolean; colorblind?: boolean;
}) {
  const h = w * 1.5;
  const isWild = !card.color;
  const bg = card.color ? COLOR_HEX[card.color] : '#262640';
  const bgLight = card.color ? COLOR_LIGHT[card.color] : '#3a3a5e';
  const bgDark = card.color ? COLOR_DARK[card.color] : '#0e0e1a';
  const corner = cornerText(card);
  const sym = card.color && colorblind ? COLORBLIND_SYMBOL[card.color] : '';
  const gid = `g${card.id}`;
  return (
    <div
      className="relative shrink-0 transition-all duration-150 ease-out"
      data-card-id={card.id} data-kind={card.kind} data-color={card.color ?? ''}
      data-playable={playable ? 'true' : undefined} data-dimmed={dimmed ? 'true' : undefined}
      style={{
        width: w, height: h,
        transform: selected ? 'translateY(-18px) scale(1.07)' : playable ? 'translateY(-8px)' : undefined,
        filter: dimmed ? 'brightness(.78) saturate(.75)' : undefined,
      }}
    >
      <svg viewBox="0 0 100 150" width={w} height={h} className="card-shadow" style={{ borderRadius: w * 0.13 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0%" stopColor={bgLight} />
            <stop offset="45%" stopColor={bg} />
            <stop offset="100%" stopColor={bgDark} />
          </linearGradient>
          <clipPath id={`clip${card.id}`}><rect x="4" y="4" width="92" height="142" rx="10" /></clipPath>
        </defs>
        {/* 白边框 */}
        <rect x="1" y="1" width="98" height="148" rx="13" fill="#fff" />
        {/* 彩面 */}
        <rect x="4" y="4" width="92" height="142" rx="10" fill={`url(#${gid})`} />
        {/* 顶部高光扫过 */}
        <ellipse cx="26" cy="14" rx="52" ry="30" fill="#fff" opacity=".13" clipPath={`url(#clip${card.id})`} />
        {/* 白色椭圆主体 */}
        <ellipse cx="50" cy="76" rx="38" ry="55" fill="#fff"
          transform="rotate(-24 50 76)" clipPath={`url(#clip${card.id})`}
          style={{ filter: 'drop-shadow(0 3px 4px rgba(0,0,0,.22))' }} />
        <FaceSymbol card={card} />
        {/* 角标：文字或图标 */}
        {corner ? (
          <text x="13" y="26" fontSize="20" fontWeight="900" fontFamily={NUM_FONT}
            fill="#fff" textAnchor="middle" stroke={isWild ? '#000' : bgDark}
            strokeWidth="1.5" paintOrder="stroke">{corner}</text>
        ) : (
          <g transform="translate(13 17)"><CornerIcon card={card} /></g>
        )}
        {(card.kind === 'number' && (card.value === 6 || card.value === 9)) &&
          <rect x="6.5" y="30" width="13" height="2.8" rx="1.4" fill="#fff" />}
        {corner ? (
          <text x="87" y="140" fontSize="20" fontWeight="900" fontFamily={NUM_FONT}
            fill="#fff" textAnchor="middle" stroke={isWild ? '#000' : bgDark}
            strokeWidth="1.5" paintOrder="stroke" transform="rotate(180 87 131)">{corner}</text>
        ) : (
          <g transform="translate(87 133) rotate(180)"><CornerIcon card={card} /></g>
        )}
        {(card.kind === 'number' && (card.value === 6 || card.value === 9)) &&
          <rect x="80.5" y="122" width="13" height="2.8" rx="1.4" fill="#fff" transform="rotate(180 87 131)" />}
        {sym && <text x="86" y="24" fontSize="14" fill="#fff" textAnchor="middle">{sym}</text>}
      </svg>
      {playable && (
        <div className="absolute -inset-[3px] pointer-events-none"
          style={{ borderRadius: w * 0.13 + 3, boxShadow: '0 0 0 2.5px rgba(255,220,90,.95), 0 0 18px 4px rgba(255,200,60,.5)' }} />
      )}
    </div>
  );
});

export function CardBack({ w = 72 }: { w?: number }) {
  const h = w * 1.5;
  return (
    <svg viewBox="0 0 100 150" width={w} height={h} className="card-shadow" style={{ borderRadius: w * 0.13 }}>
      <defs>
        <linearGradient id="uno-back-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3b3f7a" /><stop offset="55%" stopColor="#242659" /><stop offset="100%" stopColor="#14163c" />
        </linearGradient>
        <pattern id="uno-back-dots" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <circle cx="3" cy="3" r="1.4" fill="#fff" opacity=".10" />
        </pattern>
      </defs>
      <rect x="1" y="1" width="98" height="148" rx="13" fill="#fff" />
      <rect x="4" y="4" width="92" height="142" rx="10" fill="url(#uno-back-g)" />
      <rect x="4" y="4" width="92" height="142" rx="10" fill="url(#uno-back-dots)" />
      {/* 红色椭圆徽标 */}
      <ellipse cx="50" cy="75" rx="35" ry="50" fill="#e83c3c" transform="rotate(-24 50 75)"
        style={{ filter: 'drop-shadow(0 3px 5px rgba(0,0,0,.4))' }} />
      <ellipse cx="50" cy="75" rx="35" ry="50" fill="none" stroke="#ffb1a8" strokeWidth="2" opacity=".5"
        transform="rotate(-24 50 75)" />
      <g transform="rotate(-6 50 75)">
        <text x="50" y="82" textAnchor="middle" fontSize="27" fontWeight="900" fontFamily={NUM_FONT}
          fill="#fff">UNO</text>
        <text x="50" y="95" textAnchor="middle" fontSize="10" fontWeight="800" fontFamily="Arial"
          fill="#ffd6d2" letterSpacing="2.2">PRO</text>
      </g>
      {/* 高光 */}
      <ellipse cx="24" cy="12" rx="46" ry="26" fill="#fff" opacity=".08" />
    </svg>
  );
}

/** 小尺寸牌背扇（对手手牌展示） */
export function MiniCardBack({ w = 14 }: { w?: number }) {
  const h = w * 1.5;
  return (
    <svg viewBox="0 0 100 150" width={w} height={h} style={{ borderRadius: Math.max(2, w * 0.1) }}>
      <rect x="3" y="3" width="94" height="144" rx="11" fill="#2b2e60" stroke="#9aa0d8" strokeWidth="5" />
      <ellipse cx="50" cy="75" rx="33" ry="48" fill="#e83c3c" transform="rotate(-24 50 75)" />
      <ellipse cx="50" cy="75" rx="33" ry="48" fill="none" stroke="#ffb1a8" strokeWidth="4" opacity=".4"
        transform="rotate(-24 50 75)" />
    </svg>
  );
}
