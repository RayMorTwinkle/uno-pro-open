import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, playSnd } from '../store';
import { socket } from '../socket';
import Avatar from '../components/Avatar';

const RANK = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUIT = ['♠', '♥', '♦', '♣'];
const rankOf = (id: number) => (id % 13) + 1;
const suitOf = (id: number) => Math.floor(id / 13);
const red = (s: number) => s === 1 || s === 2;

export function CheatCard({ id, w = 56, back = false, sel = false }: { id: number; w?: number; back?: boolean; sel?: boolean }) {
  const h = w * 1.42;
  if (back) return (
    <div className="rounded-md shrink-0" style={{ width: w, height: h, background: 'linear-gradient(160deg,#312e81,#4c1d95)', border: '1.5px solid #8b5cf6', boxShadow: '0 2px 6px rgba(0,0,0,.35)' }} />
  );
  const r = rankOf(id), s = suitOf(id);
  const color = red(s) ? '#dc2626' : '#1e293b';
  return (
    <div className="rounded-md relative select-none shrink-0"
      style={{ width: w, height: h, background: 'linear-gradient(165deg,#ffffff,#f4f1ea)',
        border: sel ? '2px solid #fbbf24' : '1px solid #cbd5e1',
        boxShadow: sel ? '0 0 10px rgba(251,191,36,.7)' : '0 2px 6px rgba(0,0,0,.3)',
        transform: sel ? 'translateY(-14px)' : undefined, transition: 'transform .15s' }}>
      <span className="absolute font-black" style={{ left: '7%', top: '3%', fontSize: w * 0.26, color }}>{RANK[r - 1]}</span>
      <span className="absolute" style={{ left: '9%', top: `${w * 0.3}px`, fontSize: w * 0.24, color }}>{SUIT[s]}</span>
      <span className="absolute inset-0 flex items-center justify-center" style={{ fontSize: w * 0.5, color }}>{SUIT[s]}</span>
      <span className="absolute font-black" style={{ right: '7%', bottom: '3%', fontSize: w * 0.26, color, transform: 'rotate(180deg)' }}>{RANK[r - 1]}</span>
    </div>
  );
}

type CV = {
  pileCount: number; declared: number; current: number;
  lastPlay: { seat: number; count: number; rank: number; windowUntil: number } | null;
  phase: 'play' | 'match_over'; finished: number[];
  turnStartedAt: number; turnSeconds: number;
  lastEvent: { seq: number; type: string; seat: number; detail?: Record<string, unknown> } | null;
};
interface Fly { id: number; n: number | 'back'; from: [number, number]; to: [number, number] }
let flySeq = 0;

export default function Cheat() {
  const st = useStore();
  const v = st.view;
  const cv = v ? (v as unknown as CV) : null;
  const meIdx = v?.me.seatIndex ?? -1;
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [flies, setFlies] = useState<Fly[]>([]);
  const [reveal, setReveal] = useState<{ cards: number[]; honest: boolean; seat: number } | null>(null);
  const lastSeq = useRef(0);
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 250); return () => clearInterval(t); }, []);

  const seatXY = (i: number, n: number): [number, number] => {
    const k = n <= 1 ? 0.5 : i / Math.max(n - 1, 1);
    return [12 + k * 76, 13];
  };

  useEffect(() => {
    const ev = cv?.lastEvent;
    if (!ev || ev.seq === lastSeq.current || !cv || !v) return;
    lastSeq.current = ev.seq;
    const others = v.seats.filter(s => s.key && s.index !== meIdx);
    const seatPt = (seat: number): [number, number] =>
      seat === meIdx ? [50, 100] : seatXY(Math.max(others.findIndex(s => s.index === seat), 0), Math.max(others.length - 1, 1));
    const spawn = (f: Omit<Fly, 'id'>) => { const ff = { ...f, id: ++flySeq }; setFlies(x => [...x, ff]); setTimeout(() => setFlies(x => x.filter(y => y.id !== ff.id)), 700); };
    if (ev.type === 'play') {
      const n = (ev.detail?.count as number) ?? 1;
      for (let i = 0; i < n; i++) setTimeout(() => spawn({ n: 'back', from: seatPt(ev.seat), to: [50, 52] }), i * 80);
      playSnd('play', st.muted);
    } else if (ev.type === 'reveal_lie' || ev.type === 'reveal_honest') {
      setReveal({ cards: (ev.detail?.cards as number[]) ?? [], honest: ev.type === 'reveal_honest', seat: ev.seat });
      setTimeout(() => setReveal(null), 2400);
      playSnd(ev.type === 'reveal_lie' ? 'catch' : 'uno', st.muted);
    } else if (ev.type === 'take_pile') {
      const n = (ev.detail?.count as number) ?? 3;
      for (let i = 0; i < Math.min(n, 8); i++) setTimeout(() => spawn({ n: 'back', from: [50, 52], to: seatPt(ev.seat) }), i * 60);
      playSnd('draw', st.muted);
    } else if (ev.type === 'out') {
      playSnd('uno', st.muted);
    } else if (ev.type === 'match_end') {
      playSnd('win', st.muted);
    }
  }, [cv?.lastEvent?.seq]);

  if (!v || !cv) return null;
  const realSeats = v.seats.filter(s => s.key);
  const opponents = realSeats.filter(s => s.index !== meIdx);
  const myTurn = cv.phase === 'play' && cv.current === meIdx;
  const windowOpen = !!cv.lastPlay && cv.lastPlay.windowUntil > Date.now();
  const canCall = windowOpen && cv.lastPlay!.seat !== meIdx && (v.me.hand as unknown as number[]).length > 0;
  const winRemain = cv.lastPlay ? Math.max(0, (cv.lastPlay.windowUntil - Date.now()) / 1000) : 0;
  const hand = (v.me.hand as unknown as number[]) ?? [];

  const toggle = (id: number) => {
    if (!myTurn) return;
    setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : (n.size < 4 && n.add(id)); return n; });
  };
  const doPlay = () => {
    if (!myTurn || !sel.size) return;
    socket.emit('game:action', { type: 'play', cardIds: [...sel] });
    setSel(new Set());
    playSnd('play', st.muted);
  };
  const doCall = () => { if (canCall) socket.emit('game:action', { type: 'call' }); };

  const seatName = (i: number) => realSeats.find(s => s.index === i)?.name ?? `座位${i}`;

  return (
    <div className="relative w-full h-full overflow-hidden" data-game="cheat">
      {/* 对手条 */}
      {opponents.map((s, i) => {
        const [x, y] = seatXY(i, opponents.length);
        const extra = s as unknown as { finished?: boolean; outRank?: number };
        const active = cv.current === s.index;
        return (
          <div key={s.key} id={`cheat-seat-${s.index}`} className="absolute flex flex-col items-center gap-1 z-10"
            style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%,-50%)' }}>
            <Avatar name={s.name} isBot={s.isBot} size={46} ring={active} />
            <div className="text-[10px] text-white/80 whitespace-nowrap">{s.name}</div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] px-1.5 rounded-full bg-white/10 text-white/70">{s.cardCount}张</span>
              {extra.finished && <span className="text-[9px] px-1.5 rounded-full bg-emerald-500/80 text-white">第{extra.outRank}名</span>}
            </div>
          </div>
        );
      })}

      {/* 当前要出的牌面 */}
      <div className="absolute left-1/2 top-[3%] -translate-x-1/2 z-10 flex items-center gap-2">
        <span className="text-[11px] px-3 py-1 rounded-full bg-amber-400 text-black font-black">本轮喊 {RANK[cv.declared - 1]}</span>
        {cv.lastPlay && (
          <span className="text-[11px] px-2.5 py-1 rounded-full bg-white/10 text-white/85">
            {seatName(cv.lastPlay.seat)}：{cv.lastPlay.count} 张{RANK[cv.lastPlay.rank - 1]}
          </span>
        )}
      </div>

      {/* 中央牌堆 + 质疑 */}
      <div className="absolute left-1/2 top-[52%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-3 z-[5]">
        <div className="relative">
          {cv.pileCount === 0
            ? <div className="w-[76px] h-[108px] rounded-md border-2 border-dashed border-white/15 flex items-center justify-center text-white/20 text-xs">牌堆</div>
            : <div className="relative" style={{ width: 76, height: 108 }}>
                {Array.from({ length: Math.min(cv.pileCount, 6) }).map((_, i) => (
                  <div key={i} className="absolute" style={{ left: i * 2, top: -i * 1.5 }}>
                    <CheatCard id={0} w={64} back />
                  </div>
                ))}
                <span className="absolute -right-3 -top-3 z-10 bg-red-500 text-white text-[11px] font-bold rounded-full w-6 h-6 flex items-center justify-center">{cv.pileCount}</span>
              </div>}
        </div>
        {windowOpen && cv.lastPlay && (
          <div className="w-40 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-amber-400 transition-[width] duration-200" style={{ width: `${winRemain / 7 * 100}%` }} />
          </div>
        )}
        {canCall && (
          <motion.button whileTap={{ scale: 0.92 }} onClick={doCall}
            className="px-6 py-2.5 rounded-full bg-gradient-to-r from-red-500 to-rose-500 text-white font-black text-sm shadow-lg shadow-red-500/30 animate-pulse">
            吹牛！
          </motion.button>
        )}
        {windowOpen && !canCall && cv.lastPlay!.seat === meIdx && (
          <div className="text-[11px] text-white/50">质疑窗口 {winRemain.toFixed(0)}s…</div>
        )}
      </div>

      {/* 我的手牌 + 出牌 */}
      <div className="absolute left-1/2 bottom-[2.5%] -translate-x-1/2 z-20 flex flex-col items-center gap-2 w-[96%]">
        {myTurn && (
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-white/70">{sel.size ? `已选 ${sel.size} 张（喊 ${RANK[cv.declared - 1]}）` : `轮到你：选 1-4 张喊 ${RANK[cv.declared - 1]}`}</span>
            <motion.button whileTap={{ scale: 0.94 }} onClick={doPlay} disabled={!sel.size}
              className={`px-5 py-1.5 rounded-full font-bold text-sm ${sel.size ? 'bg-amber-400 text-black' : 'bg-white/10 text-white/30'}`}>
              出牌
            </motion.button>
          </div>
        )}
        <div className="flex -space-x-[20px] sm:-space-x-[16px] justify-center">
          {hand.map((id, i) => (
            <div key={id} onClick={() => toggle(id)} style={{ zIndex: i, cursor: myTurn ? 'pointer' : 'default' }}>
              <CheatCard id={id} w={54} sel={sel.has(id)} />
            </div>
          ))}
          {hand.length === 0 && <div className="text-white/40 text-xs py-6">已出完！</div>}
        </div>
      </div>

      {/* 揭穿覆盖层 */}
      <AnimatePresence>
        {reveal && (
          <motion.div initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[70] rounded-2xl bg-slate-900/95 border border-white/15 px-6 py-4 flex flex-col items-center gap-3">
            <div className={`text-lg font-black ${reveal.honest ? 'text-emerald-400' : 'text-red-400'}`}>
              {reveal.honest ? '是实话！质疑者吃牌堆' : '吹牛被抓！出牌人吃牌堆'}
            </div>
            <div className="flex gap-2">
              {reveal.cards.map(c => <CheatCard key={c} id={c} w={52} />)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 飞牌 */}
      <AnimatePresence>
        {flies.map(f => (
          <motion.div key={f.id} className="absolute z-50 pointer-events-none"
            initial={{ left: `${f.from[0]}%`, top: `${f.from[1]}%`, opacity: 0.9 }}
            animate={{ left: `${f.to[0]}%`, top: `${f.to[1]}%`, opacity: 1 }}
            transition={{ duration: 0.5, ease: [0.22, 0.8, 0.3, 1] }}
            style={{ transform: 'translate(-50%,-50%)' }}>
            {f.n === 'back' ? <CheatCard id={0} w={44} back /> : <CheatCard id={f.n} w={44} />}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* 结算 */}
      {cv.phase === 'match_over' && (
        <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="rounded-2xl bg-slate-900/95 border border-white/10 p-6 w-[min(92vw,380px)] text-center">
            <div className="text-2xl font-black text-white mb-4">吹牛结算</div>
            <div className="space-y-1.5 mb-4">
              {[...realSeats].sort((a, b) => {
                const fa = cv.finished.indexOf(a.index), fb = cv.finished.indexOf(b.index);
                if (fa >= 0 && fb >= 0) return fa - fb;
                if (fa >= 0) return -1; if (fb >= 0) return 1;
                return a.cardCount - b.cardCount;
              }).map((s, i) => (
                <div key={s.key} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 ${i === 0 ? 'bg-amber-400/15 ring-1 ring-amber-400/50' : 'bg-white/5'}`}>
                  <span className="w-5 text-sm font-black text-white/70">{i + 1}</span>
                  <Avatar name={s.name} isBot={s.isBot} size={24} />
                  <span className="flex-1 text-left text-sm text-white/90 truncate">{s.name}</span>
                  <span className="text-sm text-white/50">{s.cardCount === 0 ? '出完' : `${s.cardCount}张`}</span>
                </div>
              ))}
            </div>
            <button onClick={() => socket.emit('game:rematch', (r: { ok: boolean }) => { if (!r?.ok) st.toast('无法再来一局'); })}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-black font-bold hover:brightness-110 active:scale-[0.98] transition">
              再来一局
            </button>
          </motion.div>
        </div>
      )}
    </div>
  );
}
