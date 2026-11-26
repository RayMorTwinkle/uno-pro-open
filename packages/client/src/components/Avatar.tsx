const GRADS = [
  ['#f59e0b', '#d97706'], ['#8b5cf6', '#6d28d9'], ['#06b6d4', '#0369a1'],
  ['#ec4899', '#be185d'], ['#84cc16', '#4d7c0f'], ['#f97316', '#c2410c'],
  ['#14b8a6', '#0f766e'], ['#a855f7', '#7e22ce'], ['#ef4444', '#b91c1c'],
  ['#3b82f6', '#1d4ed8'], ['#eab308', '#a16207'], ['#10b981', '#047857'],
];

function hashName(name: string) {
  let h = 7;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export function avatarGrad(name: string) {
  return GRADS[hashName(name) % GRADS.length];
}

/** 共用嘴型 */
function Mouth({ v, dark = false }: { v: number; dark?: boolean }) {
  const c = dark ? '#1f2430' : '#fff';
  if (v === 0) return <path d="M 15 29 Q 22 35 29 29" stroke={c} strokeWidth="2.6" fill="none" strokeLinecap="round" />;
  if (v === 1) return <path d="M 14 28 Q 22 33 30 28 L 30 31 Q 22 36 14 31 Z" fill={c} />;
  if (v === 2) return <circle cx={22} cy={30} r={3.4} fill={c} />;
  return <line x1={16} y1={30} x2={28} y2={30} stroke={c} strokeWidth="2.6" strokeLinecap="round" />;
}

/** 10 种小怪造型，名字哈希定款 */
function Face({ name, s }: { name: string; s: number }) {
  const h = hashName(name);
  const style = h % 10;
  const mouth = (h >> 3) % 4;
  const W = '#fff', D = '#1f2430';
  return (
    <svg width={s} height={s} viewBox="0 0 44 44" className="absolute inset-0">
      {style === 0 && ( // 圆眼
        <>
          <circle cx={15} cy={19} r={4} fill={W} /><circle cx={29} cy={19} r={4} fill={W} />
          <circle cx={15.8} cy={19.8} r={2.1} fill={D} /><circle cx={29.8} cy={19.8} r={2.1} fill={D} />
          <Mouth v={mouth} />
        </>
      )}
      {style === 1 && ( // 大眼
        <>
          <circle cx={15} cy={18} r={5.4} fill={W} /><circle cx={29} cy={18} r={5.4} fill={W} />
          <circle cx={15.8} cy={19} r={2.7} fill={D} /><circle cx={29.8} cy={19} r={2.7} fill={D} />
          <Mouth v={mouth} />
        </>
      )}
      {style === 2 && ( // 眯眯眼
        <>
          <path d="M 10 19 Q 15 15.5 20 19" stroke={W} strokeWidth={2.6} fill="none" strokeLinecap="round" />
          <path d="M 24 19 Q 29 15.5 34 19" stroke={W} strokeWidth={2.6} fill="none" strokeLinecap="round" />
          <Mouth v={mouth} />
        </>
      )}
      {style === 3 && ( // 独眼巨人
        <>
          <circle cx={22} cy={18} r={7.5} fill={W} />
          <circle cx={23.4} cy={19.2} r={3.4} fill={D} />
          <path d="M 10 8 L 13 12 M 34 8 L 31 12" stroke={W} strokeWidth={2.4} strokeLinecap="round" />
          <Mouth v={mouth} />
        </>
      )}
      {style === 4 && ( // 三眼
        <>
          <circle cx={11} cy={19} r={3.2} fill={W} /><circle cx={22} cy={15} r={3.8} fill={W} /><circle cx={33} cy={19} r={3.2} fill={W} />
          <circle cx={11.6} cy={19.6} r={1.7} fill={D} /><circle cx={22.7} cy={15.8} r={2} fill={D} /><circle cx={33.6} cy={19.6} r={1.7} fill={D} />
          <Mouth v={mouth} />
        </>
      )}
      {style === 5 && ( // 猫：三角耳 + 竖瞳 + 胡须
        <>
          <path d="M 7 12 L 9 3 L 15 9 Z" fill={W} /><path d="M 37 12 L 35 3 L 29 9 Z" fill={W} />
          <ellipse cx={15} cy={19} rx={4} ry={4.6} fill={W} /><ellipse cx={29} cy={19} rx={4} ry={4.6} fill={W} />
          <ellipse cx={15.5} cy={19} rx={1.3} ry={3} fill={D} /><ellipse cx={29.5} cy={19} rx={1.3} ry={3} fill={D} />
          <path d="M 3 26 L 10 25 M 3 30 L 10 29 M 41 26 L 34 25 M 41 30 L 34 29" stroke={W} strokeWidth={1.8} strokeLinecap="round" opacity=".8" />
          <Mouth v={mouth} />
        </>
      )}
      {style === 6 && ( // 星星眼
        <>
          <path d="M15 12 l1.6 4.3 4.5.3 -3.5 2.9 1.1 4.4 -3.7-2.5 -3.7 2.5 1.1-4.4 -3.5-2.9 4.5-.3 Z" fill={W} />
          <path d="M29 12 l1.6 4.3 4.5.3 -3.5 2.9 1.1 4.4 -3.7-2.5 -3.7 2.5 1.1-4.4 -3.5-2.9 4.5-.3 Z" fill={W} />
          <Mouth v={mouth} />
        </>
      )}
      {style === 7 && ( // 睡颜
        <>
          <path d="M 10 19 Q 15 22 20 19" stroke={W} strokeWidth={2.6} fill="none" strokeLinecap="round" />
          <path d="M 24 19 Q 29 22 34 19" stroke={W} strokeWidth={2.6} fill="none" strokeLinecap="round" />
          <text x={30} y={12} fontSize={10} fontWeight="900" fill={W} opacity=".9">z</text>
          <Mouth v={mouth} />
        </>
      )}
      {style === 8 && ( // 骷髅
        <>
          <ellipse cx={15} cy={19} rx={5} ry={5.6} fill={D} />
          <ellipse cx={29} cy={19} rx={5} ry={5.6} fill={D} />
          <path d="M 22 24 L 20 28 L 24 28 Z" fill={D} />
          <path d="M 14 32 H 30 M 17 32 V 36 M 22 32 V 37 M 27 32 V 36" stroke={W} strokeWidth={1.8} strokeLinecap="round" />
        </>
      )}
      {style === 9 && ( // 恶魔角 + 挑眉
        <>
          <path d="M 9 11 Q 6 3 12 4 Q 10 8 13 10 Z" fill="#ffe9ec" />
          <path d="M 35 11 Q 38 3 32 4 Q 34 8 31 10 Z" fill="#ffe9ec" />
          <path d="M 10 15 L 19 17" stroke={W} strokeWidth={2.4} strokeLinecap="round" />
          <path d="M 34 15 L 25 17" stroke={W} strokeWidth={2.4} strokeLinecap="round" />
          <circle cx={16} cy={21} r={2.8} fill={W} /><circle cx={28} cy={21} r={2.8} fill={W} />
          <path d="M 15 29 Q 22 35 29 29 L 26 29 L 26 31.5 L 24.5 29.5 L 19.5 29.5 L 18 31.5 L 18 29 Z" fill={W} />
        </>
      )}
    </svg>
  );
}

/** 机器人脸：天线 + 方框眼 + 格栅嘴 */
function BotFace({ s }: { s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 44 44" className="absolute inset-0">
      <line x1="22" y1="3" x2="22" y2="10" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="22" cy="3.5" r="2.6" fill="#fff" />
      <rect x="4" y="18" width="4" height="7" rx="2" fill="#fff" opacity=".85" />
      <rect x="36" y="18" width="4" height="7" rx="2" fill="#fff" opacity=".85" />
      <rect x="10" y="15" width="9.5" height="8" rx="2.4" fill="#fff" />
      <rect x="24.5" y="15" width="9.5" height="8" rx="2.4" fill="#fff" />
      <circle cx="14.7" cy="19" r="2.1" fill="#1f2430" />
      <circle cx="29.3" cy="19" r="2.1" fill="#1f2430" />
      <rect x="14" y="29" width="16" height="5" rx="2.5" fill="#fff" />
      <line x1="19.3" y1="29" x2="19.3" y2="34" stroke="#1f2430" strokeWidth="1.5" />
      <line x1="22" y1="29" x2="22" y2="34" stroke="#1f2430" strokeWidth="1.5" />
      <line x1="24.7" y1="29" x2="24.7" y2="34" stroke="#1f2430" strokeWidth="1.5" />
    </svg>
  );
}

/** 头顶配件：王冠 / 耳机 / 派对帽 */
function Accessory({ v }: { v: number }) {
  if (v === 0) return (
    <g>
      <path d="M 11 11 L 14.5 4 L 18 9.5 L 22 3 L 26 9.5 L 29.5 4 L 33 11 Z"
        fill="#ffd34d" stroke="#b8860b" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx={22} cy={6.5} r={1.2} fill="#e11d48" />
    </g>
  );
  if (v === 1) return (
    <g fill="none" stroke="#161a26" strokeWidth="3">
      <path d="M 8 21 A 14 13 0 0 1 36 21" />
      <rect x={4} y={17} width={6} height={9} rx={2.5} fill="#161a26" stroke="none" />
      <rect x={34} y={17} width={6} height={9} rx={2.5} fill="#161a26" stroke="none" />
    </g>
  );
  return (
    <g transform="rotate(14 30 8)">
      <path d="M 30 -1 L 37 14 L 23 14 Z" fill="#f472b6" stroke="#fff" strokeWidth="1.2" />
      <circle cx={30} cy={-1} r={2.4} fill="#fff" />
      <circle cx={30} cy={7} r={1.1} fill="#fde047" />
      <circle cx={28} cy={11} r={1.1} fill="#fff" />
    </g>
  );
}

export default function Avatar({ name, isBot, size = 44, ring = false }: {
  name: string; isBot?: boolean; size?: number; ring?: boolean;
}) {
  const [g1, g2] = avatarGrad(name);
  const acc = (hashName(name) >> 7) % 6; // 0-2 无配件 3/4/5 王冠/耳机/派对帽
  return (
    <div className={`relative rounded-[28%] flex items-center justify-center overflow-hidden
      ${ring ? 'ring-2 ring-amber-300' : 'ring-1 ring-white/20'}`}
      style={{
        width: size, height: size,
        background: `linear-gradient(145deg, ${g1}, ${g2})`,
        boxShadow: '0 4px 12px rgba(0,0,0,.45), inset 0 2px 4px rgba(255,255,255,.25)',
      }}>
      {isBot ? <BotFace s={size} /> : <Face name={name} s={size} />}
      {!isBot && acc >= 3 && (
        <svg width={size} height={size} viewBox="0 0 44 44" className="absolute inset-0 pointer-events-none">
          <Accessory v={acc - 3} />
        </svg>
      )}
    </div>
  );
}
