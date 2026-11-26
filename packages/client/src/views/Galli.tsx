import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, playSnd } from '../store';
import { socket } from '../socket';
import Avatar from '../components/Avatar';

/* ---------- 水果牌 ---------- */
const FRUIT_COLORS = ['#facc15', '#f87171', '#a3e635', '#c084fc'];
const FRUIT_BG = ['#fefce8', '#fef2f2', '#f7fee7', '#faf5ff'];

export function GalliCardView({ fruit, count, w = 60, icon }: { fruit: number; count: number; w?: number; icon: string }) {
  const h = w * 1.38;
  const rows = count <= 2 ? [count] : count === 3 ? [1, 2] : count === 4 ? [2, 2] : [2, 3];
  return (
    <div className="rounded-lg relative select-none shrink-0 overflow-hidden"
      style={{ width: w, height: h, background: FRUIT_BG[fruit] ?? '#fff',
        border: `2px solid ${FRUIT_COLORS[fruit] ?? '#e2e8f0'}`,
        boxShadow: '0 2px 8px rgba(0,0,0,.4)' }}>
      <span className="absolute font-black" style={{ left: '8%', top: '1%', fontSize: w * 0.26, color: '#334155' }}>{count}</span>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[2%]">
        {rows.map((n, ri) => (
          <div key={ri} className="flex justify-center gap-[4%]">
            {Array.from({ length: n }).map((_, i) => (
              <span key={i} style={{ fontSize: w * (count <= 2 ? 0.4 : 0.3), lineHeight: 1, filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.15))' }}>{icon}</span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function DeckBack({ w = 56, count }: { w?: number; count: number }) {
  return (
    <div className="relative" style={{ width: w, height: w * 1.38 }}>
      <div className="absolute inset-0 rounded-lg" style={{ background: 'linear-gradient(155deg,#365314,#1a2e05)', border: '2px solid #65a30d', boxShadow: '0 3px 8px rgba(0,0,0,.45)' }}>
        <div className="absolute inset-[12%] rounded-md flex items-center justify-center" style={{ border: '1.5px dashed rgba(163,230,53,.5)' }}>
          <span style={{ fontSize: w * 0.42 }}>🔔</span>
        </div>
      </div>
      <div className="absolute -bottom-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-400 text-black text-[10px] font-black flex items-center justify-center shadow">{count}</div>
    </div>
  );
}

/* ---------- 视图类型 ---------- */
type GC = { fruit: number; count: number };
type GV = {
  openTop: Record<number, GC | null>;
  openCount: Record<number, number>;
  alive: number[];
  current: number;
  phase: 'play' | 'slap_wait' | 'match_over';
  windowUntil: number;
  flipDeadline: number;
  turn: number;
  lastFlip: { seat: number; card: GC } | null;
  lastSlap: { seat: number; correct: boolean; fruit: number | null } | null;
  fiveFruit: number;
  fruitName: string[];
  fruitIcon: string[];
  lastEvent: { seq: number; type: string; seat: number; detail?: Record<string, unknown> } | null;
  scoresLive: Record<number, number>;
};

interface Fly { id: number; card: GC | 'back'; from: [number, number]; to: [number, number] }
let flySeq = 0;

export default function Galli() {
  const st = useStore();
  const v = st.view;
  const gv = v ? (v as unknown as GV) : null;
  const meIdx = v?.me.seatIndex ?? -1;
  const [flies, setFlies] = useState<Fly[]>([]);
  const lastSeq = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);
  const [slapFlash, setSlapFlash] = useState<null | 'win' | 'wrong'>(null);
  const [dims, setDims] = useState<[number, number]>([1280, 800]);

  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 120); return () => clearInterval(t); }, []);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDims([el.clientWidth, el.clientHeight]));
    ro.observe(el);
    setDims([el.clientWidth, el.clientHeight]);
    return () => ro.disconnect();
  }, []);

  const rel = (r: DOMRect): [number, number] => {
    const rr = rootRef.current?.getBoundingClientRect();
    return [((r.left + r.width / 2 - (rr?.left ?? 0)) / (rr?.width ?? 1)) * 100,
            ((r.top + r.height / 2 - (rr?.top ?? 0)) / (rr?.height ?? 1)) * 100];
  };
  const elC = (id: string) => { const el = document.getElementById(id); return el ? rel(el.getBoundingClientRect()) : null; };

  const seatXY = (i: number, n: number): [number, number] => {
    const k = n <= 1 ? 0.5 : i / (n - 1);
    // 座位格约 140px 宽：左右边距按容器宽折算，保证不裁边
    const padX = Math.min(0.26, Math.max(0.09, 68 / dims[0])) * 100;
    // 座位格约 115px 高且顶栏药丸占 ~40px：y 按容器高折算
    const y = Math.min(0.22, Math.max(0.15, 84 / dims[1])) * 100;
    return [padX + k * (100 - padX * 2), y];
  };

  // 事件 → 飞牌/爆闪
  useEffect(() => {
    const ev = gv?.lastEvent;
    if (!ev || ev.seq === lastSeq.current || !gv || !v) return;
    lastSeq.current = ev.seq;
    const others = v.seats.filter(s => s.key && s.index !== meIdx);
    const seatPt = (seat: number, part: 'deck' | 'open' = 'deck'): [number, number] => {
      const id = seat === meIdx ? `galli-me-${part}` : `galli-opp-${seat}-${part}`;
      return elC(id) ?? (seat === meIdx ? [50, 88] : seatXY(others.findIndex(s => s.index === seat), Math.max(others.length, 1)));
    };
    const spawn = (f: Omit<Fly, 'id'>) => { const ff = { ...f, id: ++flySeq }; setFlies(x => [...x, ff]); setTimeout(() => setFlies(x => x.filter(y => y.id !== ff.id)), 700); };

    if (ev.type === 'flip' && ev.detail) {
      const card = { fruit: ev.detail.fruit as number, count: ev.detail.count as number };
      spawn({ card, from: seatPt(ev.seat, 'deck'), to: seatPt(ev.seat, 'open') });
      playSnd('play', st.muted);
    } else if (ev.type === 'slap_window') {
      playSnd('uno', st.muted);
    } else if (ev.type === 'slap_win') {
      for (const s of v.seats.filter(x => x.key && x.index !== ev.seat))
        spawn({ card: 'back', from: seatPt(s.index, 'open'), to: seatPt(ev.seat, 'deck') });
      setSlapFlash('win'); setTimeout(() => setSlapFlash(null), 900);
      playSnd('win', st.muted);
    } else if (ev.type === 'slap_wrong') {
      for (const s of v.seats.filter(x => x.key && x.index !== ev.seat))
        spawn({ card: 'back', from: seatPt(ev.seat, 'deck'), to: seatPt(s.index, 'deck') });
      setSlapFlash('wrong'); setTimeout(() => setSlapFlash(null), 900);
      playSnd('catch', st.muted);
    } else if (ev.type === 'match_end') {
      playSnd('win', st.muted);
    }
  }, [gv?.lastEvent?.seq]);

  const sums = useMemo(() => {
    const t = [0, 0, 0, 0];
    if (!gv?.openTop) return t;
    for (const k of Object.keys(gv.openTop)) { const c = gv.openTop[+k]; if (c) t[c.fruit] += c.count; }
    return t;
  }, [gv?.openTop, gv?.turn]);

  if (!v || !gv || !gv.openTop) return null;
  const realSeats = v.seats.filter(s => s.key);
  const opponents = realSeats.filter(s => s.index !== meIdx);
  const meOut = !gv.alive.includes(meIdx);
  const windowLeft = gv.phase === 'slap_wait' ? Math.max(0, gv.windowUntil - Date.now()) : 0;
  const flipLeft = Math.max(0, (gv.flipDeadline ?? 0) - Date.now());
  const five = gv.fiveFruit;
  const oppScale = dims[0] < 560 ? Math.max(0.7, dims[0] / 560) : 1;
  const compactH = dims[1] < 560;
  const nameOf = (seat: number) => v.seats.find(s => s.index === seat)?.name ?? `玩家${seat}`;

  const flip = () => { if (gv.current === meIdx && gv.phase === 'play' && !meOut) socket.emit('game:action', { type: 'flip' }); };
  const slap = () => { if (gv.phase !== 'match_over' && !meOut) socket.emit('game:action', { type: 'slap' }); };
  const flipRef = useRef(flip); flipRef.current = flip;
  const slapRef = useRef(slap); slapRef.current = slap;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); slapRef.current(); }
      else if (e.code === 'Enter' || e.code === 'KeyF') flipRef.current();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const seatExtrasOf = (i: number) => v.seats.find(s => s.index === i) as unknown as { out?: boolean; wins?: number } | undefined;

  return (
    <div ref={rootRef} className="relative w-full h-full overflow-hidden" data-game="galli">
      {/* 对手 */}
      {opponents.map((s, i) => {
        const [x, y] = seatXY(i, opponents.length);
        const extra = seatExtrasOf(s.index);
        const top = gv.openTop[s.index];
        const isCur = gv.current === s.index && gv.phase === 'play';
        const out = extra?.out ?? !gv.alive.includes(s.index);
        return (
          <div key={s.key} className="absolute z-10 flex flex-col items-center" style={{ left: `${x}%`, top: `${y}%`, transform: `translate(-50%,-50%) scale(${oppScale})`, opacity: out ? 0.35 : 1 }}>
            <div className="flex items-end gap-2">
              <div id={`galli-opp-${s.index}-deck`}><DeckBack w={40} count={s.cardCount} /></div>
              <div className="flex flex-col items-center gap-0.5">
                <Avatar name={s.name} isBot={s.isBot} size={44} ring={isCur} />
                <div className="text-[10px] text-white/85 font-medium whitespace-nowrap max-w-[72px] truncate">{s.name}</div>
                <div className="flex gap-1">
                  {(extra?.wins ?? 0) > 0 && <span className="text-[9px] px-1 rounded-full bg-amber-400/85 text-black font-bold">🏆{extra!.wins}</span>}
                  {out && <span className="text-[9px] px-1 rounded-full bg-white/15 text-white/60">出局</span>}
                </div>
              </div>
              <div id={`galli-opp-${s.index}-open`} className="relative" style={{ width: 46, height: 64 }}>
                {top
                  ? <motion.div key={`${s.index}-${gv.turn}-${top.fruit}-${top.count}`} initial={{ rotateY: 90, scale: 0.7 }} animate={{ rotateY: 0, scale: 1 }} transition={{ duration: 0.28 }}>
                      <GalliCardView fruit={top.fruit} count={top.count} w={46} icon={gv.fruitIcon[top.fruit]} />
                    </motion.div>
                  : <div className="w-full h-full rounded-lg border-2 border-dashed border-white/15" />}
                {(gv.openCount[s.index] ?? 0) > 1 && <div className="absolute -bottom-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-white/20 text-white/80 text-[9px] font-bold flex items-center justify-center">{gv.openCount[s.index]}</div>}
              </div>
            </div>
            {isCur && (
              <svg className="absolute -inset-1 pointer-events-none" style={{ width: 52, height: 52, left: '50%', top: 22, transform: 'translateX(-50%)' }} viewBox="0 0 52 52">
                <circle cx="26" cy="26" r="24" fill="none" stroke="#fbbf24" strokeWidth="2.5" strokeDasharray={`${(flipLeft / 3500) * 151} 151`} strokeLinecap="round" transform="rotate(-90 26 26)" />
              </svg>
            )}
          </div>
        );
      })}

      {/* 顶部状态条 */}
      <div className="absolute left-1/2 top-[2.5%] -translate-x-1/2 z-10 flex items-center gap-2">
        <span className="text-[11px] px-2.5 py-1 rounded-full bg-white/10 text-white/80">
          {gv.phase === 'play' ? `轮到 ${nameOf(gv.current)} 翻牌` : gv.phase === 'slap_wait' ? `凑满 5 个${gv.fruitName[five]}！` : '对局结束'}
        </span>
      </div>

      {/* 中央铃 + 水果计数 */}
      <div className={`absolute left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center ${compactH ? 'gap-1.5' : 'gap-2.5'}`} style={{ top: compactH ? '51%' : '46%' }}>
        {!compactH && (
          <div className="flex gap-1.5">
            {gv.fruitIcon.map((ic, f) => (
              <div key={f} className={`px-1.5 py-0.5 rounded-full text-[11px] font-bold flex items-center gap-0.5 transition-all ${sums[f] === 5 && gv.phase === 'slap_wait' ? 'bg-amber-400 text-black scale-110 shadow-[0_0_12px_rgba(251,191,36,.9)]' : 'bg-white/10 text-white/70'}`}>
                <span>{ic}</span><span>{sums[f]}</span>
              </div>
            ))}
          </div>
        )}
        <motion.button id="galli-bell" onClick={slap} disabled={meOut || gv.phase === 'match_over'}
          animate={gv.phase === 'slap_wait' ? { scale: [1, 1.12, 1], rotate: [0, -6, 6, 0] } : slapFlash === 'wrong' ? { x: [0, -8, 8, -6, 6, 0] } : { scale: 1 }}
          transition={gv.phase === 'slap_wait' ? { repeat: Infinity, duration: 0.7 } : { duration: 0.45 }}
          className={`relative rounded-full flex items-center justify-center select-none ${meOut || gv.phase === 'match_over' ? 'cursor-default' : 'cursor-pointer active:scale-95'}`}
          style={{ width: 96, height: 96, background: 'radial-gradient(circle at 35% 30%, #fde68a, #f59e0b 55%, #b45309)', border: '3px solid #78350f', boxShadow: gv.phase === 'slap_wait' ? '0 0 30px rgba(251,191,36,.9), 0 8px 20px rgba(0,0,0,.5)' : '0 6px 16px rgba(0,0,0,.45)' }}>
          <span style={{ fontSize: 44, filter: 'drop-shadow(0 2px 2px rgba(0,0,0,.3))' }}>🔔</span>
          {gv.phase === 'slap_wait' && (
            <svg className="absolute -inset-2" viewBox="0 0 112 112">
              <circle cx="56" cy="56" r="52" fill="none" stroke="#fbbf24" strokeWidth="4" strokeDasharray={`${(windowLeft / 6000) * 327} 327`} strokeLinecap="round" transform="rotate(-90 56 56)" />
            </svg>
          )}
        </motion.button>
        <div className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${gv.phase === 'slap_wait' ? 'bg-amber-400 text-black animate-pulse' : 'bg-white/10 text-white/60'}`}>
          {gv.phase === 'slap_wait' ? `拍铃（空格）！${(windowLeft / 1000).toFixed(1)}s` : meOut ? '你已出局' : gv.current === meIdx ? '点牌堆或回车翻牌' : '凑满 5 个同款水果就拍铃（空格）'}
        </div>
        {compactH && (
          <div className="flex gap-1.5">
            {gv.fruitIcon.map((ic, f) => (
              <div key={f} className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-0.5 transition-all ${sums[f] === 5 && gv.phase === 'slap_wait' ? 'bg-amber-400 text-black scale-110 shadow-[0_0_12px_rgba(251,191,36,.9)]' : 'bg-white/10 text-white/70'}`}>
                <span>{ic}</span><span>{sums[f]}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 拍铃反馈爆闪 */}
      <AnimatePresence>
        {slapFlash && (
          <motion.div key={slapFlash} className="absolute left-1/2 top-[46%] -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none"
            initial={{ scale: 0.5, opacity: 0.9 }} animate={{ scale: 2.2, opacity: 0 }} transition={{ duration: 0.8 }}
            style={{ width: 96, height: 96, borderRadius: '50%', border: `6px solid ${slapFlash === 'win' ? '#34d399' : '#f87171'}` }} />
        )}
      </AnimatePresence>

      {/* 我的区域 */}
      <div className="absolute left-1/2 bottom-[3%] -translate-x-1/2 z-20 flex items-end gap-6">
        <motion.div id="galli-me-deck" onClick={flip}
          whileTap={gv.current === meIdx && gv.phase === 'play' && !meOut ? { scale: 0.92 } : undefined}
          className={gv.current === meIdx && gv.phase === 'play' && !meOut ? 'cursor-pointer' : ''}
          animate={gv.current === meIdx && gv.phase === 'play' && !meOut ? { y: [0, -6, 0] } : { y: 0 }}
          transition={gv.current === meIdx ? { repeat: Infinity, duration: 1.2 } : {}}>
          <DeckBack w={64} count={v.seats.find(s => s.index === meIdx)?.cardCount ?? 0} />
          {gv.current === meIdx && gv.phase === 'play' && !meOut && <div className="text-center text-[10px] text-amber-300 font-bold mt-1">翻牌</div>}
        </motion.div>
        <div className="flex flex-col items-center gap-0.5 mb-1">
          <Avatar name={nameOf(meIdx)} isBot={false} size={46} ring={gv.current === meIdx && gv.phase === 'play'} />
          <div className="text-[10px] text-white/85 font-medium">我</div>
        </div>
        <div id="galli-me-open" className="relative" style={{ width: 64, height: 88 }}>
          {gv.openTop[meIdx]
            ? <motion.div key={`me-${gv.turn}`} initial={{ rotateY: 90, scale: 0.7 }} animate={{ rotateY: 0, scale: 1 }} transition={{ duration: 0.28 }}>
                <GalliCardView fruit={gv.openTop[meIdx]!.fruit} count={gv.openTop[meIdx]!.count} w={64} icon={gv.fruitIcon[gv.openTop[meIdx]!.fruit]} />
              </motion.div>
            : <div className="w-full h-full rounded-lg border-2 border-dashed border-white/15" />}
          {(gv.openCount[meIdx] ?? 0) > 1 && <div className="absolute -bottom-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-white/20 text-white/80 text-[10px] font-bold flex items-center justify-center">{gv.openCount[meIdx]}</div>}
        </div>
      </div>

      {/* 飞牌层 */}
      <AnimatePresence>
        {flies.map(f => (
          <motion.div key={f.id} className="absolute z-50 pointer-events-none"
            initial={{ left: `${f.from[0]}%`, top: `${f.from[1]}%`, x: '-50%', y: '-50%', opacity: 0.95 }}
            animate={{ left: `${f.to[0]}%`, top: `${f.to[1]}%`, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 0.8, 0.3, 1] }}>
            {f.card === 'back'
              ? <div className="rounded-md" style={{ width: 40, height: 56, background: 'linear-gradient(155deg,#365314,#1a2e05)', border: '2px solid #65a30d' }} />
              : <GalliCardView fruit={f.card.fruit} count={f.card.count} w={44} icon={gv.fruitIcon[f.card.fruit]} />}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* 结算 */}
      {gv.phase === 'match_over' && (() => {
        const sorted = [...realSeats].sort((a, b) => (gv.scoresLive[b.index] ?? 0) - (gv.scoresLive[a.index] ?? 0));
        return (
          <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="rounded-2xl bg-slate-900/95 border border-white/10 p-6 w-[min(92vw,380px)] text-center">
              <div className="text-2xl font-black text-white mb-1">🔔 铃儿响叮当结算</div>
              <div className="text-xs text-white/50 mb-4">手里牌最多者胜</div>
              <div className="space-y-1.5 mb-4">
                {sorted.map((s, i) => (
                  <div key={s.key} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 ${i === 0 ? 'bg-amber-400/15 ring-1 ring-amber-400/50' : 'bg-white/5'}`}>
                    <span className="w-5 text-sm font-black text-white/70">{i + 1}</span>
                    <Avatar name={s.name} isBot={s.isBot} size={24} />
                    <span className="flex-1 text-left text-sm text-white/90 truncate">{s.name}</span>
                    <span className={`text-sm font-bold ${i === 0 ? 'text-amber-300' : 'text-white/70'}`}>{gv.scoresLive[s.index] ?? 0}张</span>
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
