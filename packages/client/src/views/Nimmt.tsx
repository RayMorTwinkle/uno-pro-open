import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, playSnd } from '../store';
import { socket } from '../socket';
import Avatar from '../components/Avatar';

/* ---------- 牛头牌 ---------- */
function headPips(n: number): number {
  if (n === 55) return 7;
  if (n % 11 === 0) return 5;
  if (n % 10 === 0) return 3;
  if (n % 5 === 0) return 2;
  return 1;
}

const PIP_COLORS = ['#64748b', '#f59e0b', '#f97316', '#ef4444', '#dc2626', '#7c3aed', '#7c3aed'];

export function NimmtCard({ n, w = 56, dim = false, glow = false }: { n: number; w?: number; dim?: boolean; glow?: boolean }) {
  const pips = headPips(n);
  const h = w * 1.4;
  return (
    <div className="rounded-md relative select-none shrink-0"
      style={{ width: w, height: h, opacity: dim ? 0.35 : 1,
        background: 'linear-gradient(160deg,#fffdf5,#f1ead8)',
        border: `1.5px solid ${glow ? '#fbbf24' : '#d6c9a8'}`,
        boxShadow: glow ? '0 0 12px rgba(251,191,36,.8)' : '0 2px 6px rgba(0,0,0,.35)',
        fontSize: w * 0.32 }}>
      <span className="absolute font-black" style={{ left: '8%', top: '2%', color: '#3f3a2e' }}>{n}</span>
      <span className="absolute font-black" style={{ right: '8%', bottom: '2%', color: '#3f3a2e', transform: 'rotate(180deg)' }}>{n}</span>
      <div className="absolute inset-0 flex flex-wrap items-center justify-center gap-[6%] px-[12%] py-[18%] content-center">
        {Array.from({ length: pips }).map((_, i) => (
          <svg key={i} viewBox="0 0 12 10" style={{ width: pips > 3 ? '26%' : '34%' }}>
            <path d="M1 9 C0 5 1 2 4 1 L8 1 C11 2 12 5 11 9 L8.5 9 C9 6 8.5 4 6 4 C3.5 4 3 6 3.5 9 Z" fill={PIP_COLORS[Math.min(pips, 6)]} />
          </svg>
        ))}
      </div>
    </div>
  );
}

/* ---------- 视图 ---------- */
type NV = {
  rows: number[][];
  pickedSeats: number[];
  pendingRowChoice: { seat: number; card: number } | null;
  phase: 'pick' | 'choose_row' | 'match_over';
  turn: number; maxTurns: number;
  taken: Record<number, number>;
  turnStartedAt: number;
  turnSeconds: number;
  current: number;
  lastEvent: { seq: number; type: string; seat: number; detail?: Record<string, unknown> } | null;
};

interface Fly { id: number; n: number | 'back'; from: [number, number]; to: [number, number]; w: number; toW: number; hide?: boolean }

let flySeq = 0;

export default function Nimmt() {
  const st = useStore();
  const v = st.view;
  const nv = v ? (v as unknown as NV) : null;
  const meIdx = v?.me.seatIndex ?? -1;
  const [picked, setPicked] = useState<number | null>(null);
  const [flies, setFlies] = useState<Fly[]>([]);
  const lastSeq = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);

  // 时钟
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 250); return () => clearInterval(t); }, []);

  // 新回合清空已选
  useEffect(() => { if (nv?.phase === 'pick') setPicked(null); }, [nv?.turn, nv?.phase]);

  const rel = (r: DOMRect): [number, number] => {
    const rr = rootRef.current?.getBoundingClientRect();
    return [((r.left + r.width / 2 - (rr?.left ?? 0)) / (rr?.width ?? 1)) * 100,
            ((r.top + r.height / 2 - (rr?.top ?? 0)) / (rr?.height ?? 1)) * 100];
  };
  const elC = (id: string) => { const el = document.getElementById(id); return el ? rel(el.getBoundingClientRect()) : null; };

  const seatXY = (i: number, n: number): [number, number] => {
    // 对手沿顶部均布（留出手牌区）
    const k = n <= 1 ? 0.5 : i / (n - 1);
    return [12 + k * 76, 13];
  };

  // 事件 → 飞牌/爆闪
  useEffect(() => {
    const ev = nv?.lastEvent;
    if (!ev || ev.seq === lastSeq.current || !nv) return;
    lastSeq.current = ev.seq;
    const others = v!.seats.filter(s => s.key && s.index !== meIdx);
    const seatPt = (seat: number): [number, number] =>
      seat === meIdx ? [50, 100] : seatXY(others.findIndex(s => s.index === seat), Math.max(others.length - 1, 1));
    const spawn = (f: Omit<Fly, 'id'>) => { const ff = { ...f, id: ++flySeq }; setFlies(x => [...x, ff]); setTimeout(() => setFlies(x => x.filter(y => y.id !== ff.id)), 750); };
    if (ev.type === 'place' && ev.detail) {
      const row = ev.detail.row as number, card = ev.detail.card as number;
      spawn({ n: card, from: seatPt(ev.seat), to: elC(`nimmt-row-${row}`) ?? [50, 50], w: 56, toW: 44 });
      playSnd('play', st.muted);
    } else if ((ev.type === 'take_five' || ev.type === 'take_row') && ev.detail) {
      const row = ev.detail.row as number;
      const cards = (ev.detail.cards as number[]) ?? [];
      cards.slice(0, 5).forEach((c, i) => setTimeout(() =>
        spawn({ n: c, from: elC(`nimmt-row-${row}`) ?? [50, 50], to: seatPt(ev.seat), w: 44, toW: 30 }), i * 90));
      playSnd('draw', st.muted);
    } else if (ev.type === 'reveal') {
      playSnd('deal', st.muted);
    } else if (ev.type === 'match_end') {
      playSnd('win', st.muted);
    }
  }, [nv?.lastEvent?.seq]);

  if (!v || !nv || !nv.rows) return null;
  const realSeats = v.seats.filter(s => s.key);
  const opponents = realSeats.filter(s => s.index !== meIdx);
  const headsOf = (i: number) => nv.taken?.[i] ?? 0;
  const iChoose = nv.phase === 'choose_row' && nv.pendingRowChoice?.seat === meIdx;
  const remain = Math.max(0, Math.ceil(((nv.turnStartedAt ?? 0) + (nv.turnSeconds ?? 30) * 1000 - Date.now()) / 1000));
  void tick;

  const pick = (n: number) => {
    if (nv.phase !== 'pick' || picked !== null) return;
    setPicked(n);
    socket.emit('game:action', { type: 'pick', card: n });
  };
  const chooseRow = (r: number) => {
    if (!iChoose) return;
    socket.emit('game:action', { type: 'choose_row', row: r });
  };

  return (
    <div ref={rootRef} className="relative w-full h-full overflow-hidden" data-game="nimmt">
      {/* 对手条 */}
      {opponents.map((s, i) => {
        const [x, y] = seatXY(i, opponents.length);
        const extra = (s as unknown as { picked?: boolean }).picked;
        const picking = nv.phase === 'choose_row' && nv.pendingRowChoice?.seat === s.index;
        return (
          <div key={s.key} id={`nimmt-seat-${s.index}`} className="absolute flex flex-col items-center gap-1 z-10"
            style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%,-50%)' }}>
            <Avatar name={s.name} isBot={s.isBot} size={46} ring={picking} />
            <div className="text-[10px] text-white/80 font-medium whitespace-nowrap">{s.name}</div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] px-1.5 rounded-full bg-white/10 text-white/70">{s.cardCount}张</span>
              {headsOf(s.index) > 0 && <span className="text-[9px] px-1.5 rounded-full bg-red-500/80 text-white font-bold">🐮{headsOf(s.index)}</span>}
              {extra && <span className="text-[9px] px-1.5 rounded-full bg-emerald-500/80 text-white">已选</span>}
              {picking && <span className="text-[9px] px-1.5 rounded-full bg-amber-400 text-black font-bold animate-pulse">选行</span>}
            </div>
          </div>
        );
      })}

      {/* 回合指示 */}
      <div className="absolute left-1/2 top-[3%] -translate-x-1/2 z-10 flex items-center gap-2">
        <span className="text-[11px] px-2.5 py-1 rounded-full bg-white/10 text-white/80">第 {nv.turn}/{nv.maxTurns} 回合</span>
        {nv.phase === 'pick' && (
          <span className={`text-[11px] px-2.5 py-1 rounded-full font-bold ${remain <= 5 ? 'bg-red-500/80 text-white animate-pulse' : 'bg-white/10 text-white/80'}`}>
            {picked !== null ? '等待对手…' : `暗选 ${remain}s`}
          </span>
        )}
        {iChoose && <span className="text-[11px] px-2.5 py-1 rounded-full bg-amber-400 text-black font-bold animate-pulse">你的牌太小，选一行吃掉</span>}
        {nv.phase === 'choose_row' && !iChoose && <span className="text-[11px] px-2.5 py-1 rounded-full bg-white/10 text-white/80">对手选行中…</span>}
      </div>

      {/* 四行 */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-3 z-[5] w-[92%] max-w-[560px]">
        {nv.rows.map((row, ri) => {
          const heads = row.reduce((a, c) => a + headPips(c), 0);
          const danger = row.length >= 4;
          return (
            <div key={ri} id={`nimmt-row-${ri}`}
              onClick={() => chooseRow(ri)}
              className={`flex items-center rounded-xl px-3 py-1.5 transition-all ${iChoose ? 'cursor-pointer ring-2 ring-amber-400/80 bg-amber-400/10 hover:bg-amber-400/25 hover:scale-[1.02]' : 'bg-white/[0.045]'} ${danger ? 'ring-1 ring-red-400/40' : ''}`}
              style={{ minHeight: 72 }}>
              <div className="flex -space-x-[26px] flex-1 overflow-visible">
                {row.map((c, ci) => (
                  <div key={`${c}-${ci}`} style={{ zIndex: ci }}>
                    <NimmtCard n={c} w={50} glow={ci === row.length - 1 && danger} />
                  </div>
                ))}
                {row.length === 0 && <div className="text-white/25 text-xs py-4 px-2">空行</div>}
              </div>
              <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full ml-2 shrink-0 ${danger ? 'bg-red-500/80 text-white' : 'bg-white/10 text-white/60'}`}>
                {heads}🐮 {row.length}/6
              </div>
            </div>
          );
        })}
      </div>

      {/* 我的手牌 */}
      <div className="absolute left-1/2 bottom-[2.5%] -translate-x-1/2 z-20 flex items-end justify-center w-[96%]">
        <div className="flex -space-x-[18px] sm:-space-x-[14px]">
          {(v.me.hand as unknown as number[]).map((n, i) => (
            <motion.div key={n} layout
              whileHover={nv.phase === 'pick' && picked === null ? { y: -14, scale: 1.06 } : undefined}
              whileTap={{ scale: 0.94 }}
              onClick={() => pick(n)}
              className={nv.phase === 'pick' && picked === null ? 'cursor-pointer' : ''}
              style={{ zIndex: i }}>
              <NimmtCard n={n} w={58} />
            </motion.div>
          ))}
          {(v.me.hand as unknown as number[]).length === 0 && nv.phase !== 'match_over' &&
            <div className="text-white/40 text-xs py-6">手牌已空</div>}
        </div>
      </div>
      {picked !== null && nv.phase === 'pick' && (
        <div className="absolute left-1/2 bottom-[16%] -translate-x-1/2 z-30 pointer-events-none">
          <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
            <div className="relative">
              <div className="rounded-md" style={{ width: 56, height: 78, background: 'linear-gradient(160deg,#4c1d95,#312e81)', border: '1.5px solid #8b5cf6', boxShadow: '0 0 14px rgba(139,92,246,.6)' }}>
                <span className="absolute inset-0 flex items-center justify-center text-white/70 text-xl font-black">?</span>
              </div>
              <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-violet-300">已扣牌</div>
            </div>
          </motion.div>
        </div>
      )}

      {/* 飞牌层 */}
      <AnimatePresence>
        {flies.map(f => (
          <motion.div key={f.id} className="absolute z-50 pointer-events-none"
            initial={{ left: `${f.from[0]}%`, top: `${f.from[1]}%`, x: '-50%', y: '-50%', scale: f.w / Math.max(f.toW, 1) * (f.toW / f.w), opacity: 0.9 }}
            animate={{ left: `${f.to[0]}%`, top: `${f.to[1]}%`, opacity: 1 }}
            transition={{ duration: 0.55, ease: [0.22, 0.8, 0.3, 1] }}
            style={{ transform: 'translate(-50%,-50%)' }}>
            {f.n === 'back'
              ? <div className="rounded-md" style={{ width: 44, height: 62, background: 'linear-gradient(160deg,#4c1d95,#312e81)', border: '1.5px solid #8b5cf6' }} />
              : <NimmtCard n={f.n} w={44} />}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* 结算覆盖层 */}
      {nv.phase === 'match_over' && (() => {
        const sorted = [...realSeats].sort((a, b) => headsOf(a.index) - headsOf(b.index));
        return (
          <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="rounded-2xl bg-slate-900/95 border border-white/10 p-6 w-[min(92vw,380px)] text-center">
              <div className="text-2xl font-black text-white mb-1">🐮 牛头王结算</div>
              <div className="text-xs text-white/50 mb-4">牛头最少者胜</div>
              <div className="space-y-1.5 mb-4">
                {sorted.map((s, i) => (
                  <div key={s.key} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 ${i === 0 ? 'bg-amber-400/15 ring-1 ring-amber-400/50' : 'bg-white/5'}`}>
                    <span className="w-5 text-sm font-black text-white/70">{i + 1}</span>
                    <Avatar name={s.name} isBot={s.isBot} size={24} />
                    <span className="flex-1 text-left text-sm text-white/90 truncate">{s.name}</span>
                    <span className={`text-sm font-bold ${i === 0 ? 'text-amber-300' : 'text-red-300'}`}>{headsOf(s.index)}🐮</span>
                  </div>
                ))}
              </div>
              <button onClick={() => socket.emit('game:rematch', (r: { ok: boolean }) => { if (!r?.ok) st.toast('无法再来一局'); })}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-black font-bold hover:brightness-110 active:scale-[0.98] transition">
                再来一局
              </button>
            </motion.div>
          </div>
        );
      })()}
    </div>
  );
}
