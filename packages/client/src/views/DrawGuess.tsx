import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, playSnd } from '../store';
import { socket } from '../socket';
import Avatar from '../components/Avatar';

type DG = {
  drawer: number; isDrawer: boolean;
  wordChoices: string[]; word: string | null; wordLen: number;
  strokes: { pts: number[]; color: string; w: number }[];
  guesses: { seat: number; text: string; ok: boolean }[];
  guessed: number[];
  phase: 'pick_word' | 'draw' | 'reveal' | 'match_over';
  round: number; totalRounds: number; deadlineAt: number;
  revealedWord: string | null;
  lastEvent: { seq: number; type: string; seat: number; detail?: Record<string, unknown> } | null;
};

const COLORS = ['#f8fafc', '#fbbf24', '#f87171', '#34d399', '#60a5fa', '#a78bfa', '#1e293b'];

export default function DrawGuess() {
  const st = useStore();
  const v = st.view;
  const dg = v ? (v as unknown as DG) : null;
  const meIdx = v?.me.seatIndex ?? -1;
  const [color, setColor] = useState(COLORS[0]);
  const [brush, setBrush] = useState(4);
  const [guessText, setGuessText] = useState('');
  const [liveStroke, setLiveStroke] = useState<{ pts: number[]; color: string; w: number } | null>(null);
  const drawing = useRef<number[] | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);
  const lastSeq = useRef(0);
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 300); return () => clearInterval(t); }, []);

  useEffect(() => {
    const ev = dg?.lastEvent;
    if (!ev || ev.seq === lastSeq.current) return;
    lastSeq.current = ev.seq;
    if (ev.type === 'correct') playSnd('uno', st.muted);
    else if (ev.type === 'reveal') playSnd('deal', st.muted);
    else if (ev.type === 'match_end') playSnd('win', st.muted);
  }, [dg?.lastEvent?.seq]);

  useEffect(() => { feedRef.current?.scrollTo({ top: 1e6 }); }, [dg?.guesses?.length]);

  if (!v || !dg) return null;
  const realSeats = v.seats.filter(s => s.key);
  const meSeat = realSeats.find(s => s.index === meIdx);
  const isDrawer = dg.isDrawer;
  const canDraw = dg.phase === 'draw' && isDrawer;
  const remain = Math.max(0, Math.ceil((dg.deadlineAt - Date.now()) / 1000));

  const toNorm = (e: React.PointerEvent): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    return [Math.round((e.clientX - r.left) / r.width * 700), Math.round((e.clientY - r.top) / r.height * 500)];
  };
  const down = (e: React.PointerEvent) => {
    if (!canDraw) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toNorm(e);
    drawing.current = p;
    setLiveStroke({ pts: p, color, w: brush });
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const p = toNorm(e);
    drawing.current = [...drawing.current, ...p];
    setLiveStroke(s => s && { ...s, pts: drawing.current! });
  };
  const up = () => {
    const pts = drawing.current;
    drawing.current = null;
    setLiveStroke(null);
    if (!pts || pts.length < 4) return;
    socket.emit('game:action', { type: 'stroke', pts, color, w: brush });
  };
  const sendGuess = () => {
    const t = guessText.trim();
    if (!t || dg.phase !== 'draw' || isDrawer) return;
    socket.emit('game:action', { type: 'guess', text: t });
    setGuessText('');
  };

  const path = (pts: number[]) => {
    const n = Math.floor(pts.length / 2);
    if (!n) return '';
    let d = `M${pts[0]},${pts[1] ?? 0}`;
    for (let i = 1; i < n; i++) d += `L${pts[i * 2]},${pts[i * 2 + 1]}`;
    if (n === 1) d += `L${pts[0] + 1},${(pts[1] ?? 0) + 1}`;
    return d;
  };
  const seatName = (i: number) => realSeats.find(s => s.index === i)?.name ?? `座位${i}`;

  return (
    <div className="relative w-full h-full overflow-hidden flex flex-col" data-game="drawguess">
      {/* 顶栏信息 */}
      <div className="flex items-center justify-center gap-2 pt-2 z-10 relative">
        <span className="text-[11px] px-2.5 py-1 rounded-full bg-white/10 text-white/80">第 {dg.round}/{dg.totalRounds} 轮</span>
        <span className="text-[11px] px-2.5 py-1 rounded-full bg-amber-400 text-black font-bold">
          {dg.phase === 'pick_word' ? '画手选词中' : dg.phase === 'reveal' ? `答案：${dg.revealedWord}` : `${remain}s`}
        </span>
        {dg.phase === 'draw' && <span className="text-[11px] px-2.5 py-1 rounded-full bg-white/10 text-white/80">{isDrawer ? `你画：${dg.word}` : `${dg.wordLen} 个字`}</span>}
      </div>

      {/* 玩家条 */}
      <div className="flex justify-center gap-4 py-1.5 z-10 relative flex-wrap px-2">
        {realSeats.map(s => {
          const ex = s as unknown as { drawer?: boolean; guessed?: boolean; pts?: number };
          return (
            <div key={s.key} className={`flex items-center gap-1.5 px-2 py-1 rounded-full ${ex.drawer ? 'bg-amber-400/20 ring-1 ring-amber-400/60' : ex.guessed ? 'bg-emerald-500/15' : 'bg-white/5'}`}>
              <Avatar name={s.name} isBot={s.isBot} size={24} />
              <span className="text-[10px] text-white/85">{s.name}</span>
              <span className="text-[10px] text-amber-300 font-bold">{ex.pts ?? 0}</span>
              {ex.drawer && <span className="text-[9px]">🖌</span>}
              {ex.guessed && <span className="text-[9px] text-emerald-400">✓</span>}
            </div>
          );
        })}
      </div>

      {/* 画布 + 侧栏 */}
      <div className="flex-1 flex flex-col sm:flex-row gap-2 px-2 pb-2 min-h-0">
        <div className="flex-1 relative rounded-2xl overflow-hidden bg-slate-800/60 border border-white/10">
          <svg ref={svgRef} viewBox="0 0 700 500" className="w-full h-full touch-none"
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
            style={{ cursor: canDraw ? 'crosshair' : 'default', background: 'linear-gradient(170deg,#1e293b,#0f172a)' }}>
            {(dg.strokes ?? []).map((s2, i) => (
              <path key={i} d={path(s2.pts)} fill="none" stroke={s2.color} strokeWidth={s2.w} strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {liveStroke && <path d={path(liveStroke.pts)} fill="none" stroke={liveStroke.color} strokeWidth={liveStroke.w} strokeLinecap="round" strokeLinejoin="round" />}
          </svg>
          {/* 画手工具栏 */}
          {canDraw && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-slate-900/85 rounded-full px-3 py-1.5">
              {COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)} className={`w-5 h-5 rounded-full ${color === c ? 'ring-2 ring-white scale-110' : ''}`} style={{ background: c }} />
              ))}
              <span className="w-px h-4 bg-white/20" />
              {[3, 5, 9].map(w2 => (
                <button key={w2} onClick={() => setBrush(w2)} className={`rounded-full bg-white/80 ${brush === w2 ? 'ring-2 ring-amber-400' : 'opacity-50'}`} style={{ width: w2 + 8, height: w2 + 8 }} />
              ))}
              <button onClick={() => socket.emit('game:action', { type: 'clear' })} className="text-[10px] text-white/60 hover:text-white px-1">清空</button>
            </div>
          )}
          {/* 选词覆盖 */}
          {dg.phase === 'pick_word' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-[2px]">
              {isDrawer ? (
                <div className="text-center">
                  <div className="text-white/80 text-sm mb-3">选一个词来画（{remain}s）</div>
                  <div className="flex gap-3">
                    {dg.wordChoices.map(w => (
                      <motion.button key={w} whileTap={{ scale: 0.95 }} onClick={() => socket.emit('game:action', { type: 'pick_word', word: w })}
                        className="px-6 py-3 rounded-xl bg-amber-400 text-black font-black text-lg hover:brightness-110">{w}</motion.button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-white/70 text-sm animate-pulse">{seatName(dg.drawer)} 正在选词…</div>
              )}
            </div>
          )}
          {/* 揭晓覆盖 */}
          {dg.phase === 'reveal' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center">
                <div className="text-white/60 text-sm">答案是</div>
                <div className="text-4xl font-black text-amber-300">{dg.revealedWord}</div>
              </motion.div>
            </div>
          )}
        </div>

        {/* 猜测流 */}
        <div className="h-[34%] sm:h-auto sm:w-[220px] flex flex-col rounded-2xl bg-slate-800/60 border border-white/10 min-h-0 shrink-0">
          <div ref={feedRef} className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
            {(dg.guesses ?? []).map((g, i) => (
              <div key={i} className={`text-[11px] px-2 py-1 rounded-lg ${g.ok ? 'bg-emerald-500/20 text-emerald-300 font-bold' : 'bg-white/5 text-white/70'}`}>
                <span className="text-white/50">{seatName(g.seat)}：</span>{g.text}
              </div>
            ))}
            {!dg.guesses?.length && <div className="text-white/25 text-[11px] p-2">猜词会出现在这里</div>}
          </div>
          {!isDrawer && dg.phase === 'draw' && !(dg.guessed ?? []).includes(meIdx) ? (
            <div className="p-2 border-t border-white/10 flex gap-1">
              <input value={guessText} onChange={e => setGuessText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendGuess()}
                placeholder="输入答案" maxLength={20}
                className="flex-1 min-w-0 bg-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none placeholder:text-white/30" />
              <button onClick={sendGuess} className="px-2.5 rounded-lg bg-amber-400 text-black text-xs font-bold">猜</button>
            </div>
          ) : (
            <div className="p-2 border-t border-white/10 text-center text-[10px] text-white/40">
              {isDrawer ? '你是画手' : (dg.guessed ?? []).includes(meIdx) ? '已猜中 ✓' : '等待中'}
            </div>
          )}
        </div>
      </div>

      {/* 结算 */}
      {dg.phase === 'match_over' && (
        <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="rounded-2xl bg-slate-900/95 border border-white/10 p-6 w-[min(92vw,380px)] text-center">
            <div className="text-2xl font-black text-white mb-4">你画我猜·结算</div>
            <div className="space-y-1.5 mb-4">
              {[...realSeats].sort((a, b) => ((b as unknown as { pts?: number }).pts ?? 0) - ((a as unknown as { pts?: number }).pts ?? 0)).map((s, i) => (
                <div key={s.key} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 ${i === 0 ? 'bg-amber-400/15 ring-1 ring-amber-400/50' : 'bg-white/5'}`}>
                  <span className="w-5 text-sm font-black text-white/70">{i + 1}</span>
                  <Avatar name={s.name} isBot={s.isBot} size={24} />
                  <span className="flex-1 text-left text-sm text-white/90 truncate">{s.name}</span>
                  <span className="text-sm font-bold text-amber-300">{(s as unknown as { pts?: number }).pts ?? 0}分</span>
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
