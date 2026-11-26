import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, playSnd } from '../store';
import { playVoice, voiceLang, setVoiceLang, voiceEnabled, setVoiceEnabled } from '../voice';
import { stopBgm, syncBgm, bgmEnabled, setBgmEnabled } from '../bgm';
import { socket } from '../socket';
import { CardFace, CardBack, MiniCardBack, COLOR_HEX, COLOR_DARK } from '../components/Card';
import Avatar, { avatarGrad } from '../components/Avatar';
import type { Card, Color } from '@uno-pro/shared';
import { cardMatches } from '@uno-pro/shared';
import { counterCards, jumpInCards, numberBundle } from '../uno-options';
import {
  ArrowLeft, Trophy, VolumeX, Volume2, SmilePlus, Bot, Crown, Hand, Palette, ArrowUpDown, Music, Bug,
} from 'lucide-react';

const EMOJIS = ['😂', '😮', '😭', '😡', '👍', '🎉', '🤔', '💀', '🔥', '❤️'];

/** 事件 → 一句话播报 */
function describeEvent(ev: { type: string; seat: number; detail?: Record<string, unknown> }, view: { seats: { index: number; name: string }[]; discardTop: Card | null }, cardName: (c: Card | null) => string) {
  const name = view.seats[ev.seat]?.name ?? '?';
  switch (ev.type) {
    case 'play': case 'jump_in': case 'multi_play': return `${name} 打出 ${cardName(view.discardTop)}`;
    case 'draw': return `${name} 摸了牌`;
    case 'draw_penalty': return `${name} 被罚摸牌`;
    case 'skip': return `${name} 被跳过`;
    case 'reverse': return '方向反转';
    case 'wild': return `${name} 选择了${COLOR_NAME[(ev.detail?.color as Color) ?? 'red']}色`;
    case 'player_out': return `${name} 第 ${(ev.detail?.rank as number) ?? '?'} 名出完`;
    case 'uno': return `${name} 喊了 UNO!`;
    case 'uno_caught': return `${name} 被抓 UNO`;
    case 'challenge_win': return `${name} 质疑成功`;
    case 'challenge_lose': return `${name} 质疑失败`;
    case 'swap_hands': return `${name} 交换了手牌`;
    case 'rotate_hands': return '场上玩家轮转手牌';
    case 'eliminated': return `${name} 被淘汰`;
    case 'deal': return '发牌';
    default: return '';
  }
}
const PHRASES = ['就这？', '好牌！', '搞快点', '救命', 'GG', '再来一局', '稳了', '完了完了'];
const COLORS: Color[] = ['red', 'yellow', 'green', 'blue'];
const COLOR_NAME: Record<Color, string> = { red: '红', yellow: '黄', green: '绿', blue: '蓝' };

/** 当前是否紧凑横屏（seatPos 在 render 外也要用） */
let seatCompact = false;
/** 座位边缘内缩边距（%），随座位实测尺寸动态计算 —— render 中更新 */
let seatM = { x: 10, yT: 14, yB: 30 };
/** 自动 UI 缩放系数（滑条手动缩放 × 自动缩放） */
let autoZVal = 1;

/** 三段折线（容器 % 坐标）：portrait 左+顶+右；compact 左+顶+底 */
function edgeSegs(compact: boolean): [number, number, number, number][] {
  const { x, yT, yB } = seatM;
  return compact
    ? [[x, 100 - yB, x, yT], [x, yT, 100 - x, yT], [20, 100 - yB, 82, 100 - yB]]
    : [[x, 100 - yB, x, yT], [x, yT, 100 - x, yT], [100 - x, yT, 100 - x, 100 - yB]];
}

/** 各段的「座位单位数」：纵向段按座位块高折算、横向段按宽折算；每段两端各留半个单位作转角死区 */
function segUnits(w: number, h: number, sc: number, compact: boolean): { segs: [number, number, number, number][]; units: number[]; total: number } {
  const segs = edgeSegs(compact);
  const units = segs.map(([x1, y1, x2, y2]) => {
    const dx = Math.abs(x2 - x1) * w / 100, dy = Math.abs(y2 - y1) * h / 100;
    const len = Math.hypot(dx, dy);
    return Math.max(0, len / ((dy > dx ? 130 : 84) * sc) - 1);
  });
  return { segs, units, total: units.reduce((a, b) => a + b, 0) };
}

/** 对手沿牌桌边缘按「座位单位」均匀分布，任意宽高比都不重叠 */
function seatPositions(n: number, compact: boolean, w: number, h: number, sc: number): [number, number][] {
  const { segs, units, total } = segUnits(w, h, sc, compact);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    let d = (total * (i + 1)) / (n + 1);
    for (let s = 0; s < segs.length; s++) {
      if (d <= units[s] || s === segs.length - 1) {
        // 死区后的有效区间居中映射：raw 端各收 0.5 单位
        const raw = units[s] + 1;
        const t01 = units[s] > 0 ? Math.max(0, Math.min(1, d / units[s])) : 0.5;
        const t = Math.max(0, Math.min(1, (0.5 + t01 * units[s]) / raw));
        const [x1, y1, x2, y2] = segs[s];
        out.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
        break;
      }
      d -= units[s];
    }
  }
  return out;
}

/** render 中刷新的座位位置缓存（飞牌/箭头在 render 外读） */
let seatPosCache: [number, number][] = [];

/** 座位 → 牌桌区坐标（用于飞牌/气泡定位） */
function seatPos(seatIdx: number, mySeat: number, total: number): [number, number] {
  if (seatIdx === mySeat || mySeat < 0) return [50, 96];
  const opp = orderedOpponents(mySeat, total);
  const i = opp.indexOf(seatIdx);
  return seatPosCache[Math.max(0, i)] ?? [50, 14];
}

/** 对手牌扇中心（座位锚点下方）——飞牌起落点 */
function fanPos(seatIdx: number, mySeat: number, total: number): [number, number] {
  if (seatIdx === mySeat || mySeat < 0) return [50, 96];
  const [x, y] = seatPos(seatIdx, mySeat, total);
  return [x, y + 8];
}
function orderedOpponents(mySeat: number, total: number): number[] {
  const arr: number[] = [];
  for (let k = 1; k < total; k++) arr.push((mySeat + k) % total);
  return arr;
}

interface Fly { id: number; from: [number, number]; to: [number, number]; card?: Card; delay?: number; w?: number; toW?: number; rot?: number; toRot?: number; dur?: number; flip?: boolean; toHand?: boolean }
interface Burst { id: number; text: string; color: string; pos: [number, number] }
interface Spark { id: number; ang: number; dist: number; color: string; pos: [number, number] }
let flySeq = 0;

/** 事件 → 屏幕大字爆闪 */
const BURSTS: Record<string, { text: string; color: string }> = {
  skip: { text: '跳过!', color: '#7dd3fc' },
  reverse: { text: '转向!', color: '#f0abfc' },
  draw_penalty: { text: '罚牌!', color: '#fb923c' },
  wild: { text: '变色!', color: '#fde047' },
  uno: { text: 'UNO!', color: '#ef4444' },
  uno_caught: { text: '被抓!', color: '#f87171' },
  challenge_win: { text: '质疑成功!', color: '#4ade80' },
  challenge_lose: { text: '质疑失败!', color: '#f87171' },
  eliminated: { text: '淘汰!', color: '#f87171' },
  swap_hands: { text: '换手牌!', color: '#fbbf24' },
  rotate_hands: { text: '传手牌!', color: '#fbbf24' },
  multi_play: { text: '全出!', color: '#4ade80' },
  jump_in: { text: '抢出!', color: '#fb923c' },
  turn_timeout: { text: '超时!', color: '#f87171' },
  player_out: { text: '出完!', color: '#4ade80' },
};

/** 中央小指示环：绕牌堆一圈，当前生效色描边 + 慢速流动虚线 + 单箭头指向当前出牌者方位 */
function DirectionRing({ direction, activeColor, aim, aspect }: {
  direction: 1 | -1; activeColor: Color; aim: [number, number]; aspect: number;
}) {
  // viewBox 200x200，圆心 (100,100)，半径 78
  const cx = 100, cy = 100, r = 78;
  // 圆心→当前座位连线与圆环交点（容器%换算到屏幕等效比例）
  const dx = (aim[0] - 50) * aspect, dy = aim[1] - 56;
  const ang = Math.atan2(dy, dx);
  const ax = cx + r * Math.cos(ang), ay = cy + r * Math.sin(ang);
  // 箭头沿圆周切线，随出牌方向顺/逆时针
  const tang = ((direction === 1 ? ang + Math.PI / 2 : ang - Math.PI / 2) * 180) / Math.PI;
  return (
    <svg id="dir-ring" viewBox="0 0 200 200" className="absolute pointer-events-none z-0"
      style={{ left: '50%', top: '56%', height: 'min(235px, 55%)', aspectRatio: '1', transform: 'translate(-50%,-50%)' }}>
      <circle cx={cx} cy={cy} r={r} fill="none"
        stroke={COLOR_HEX[activeColor]} strokeOpacity=".5" strokeWidth="4" style={{ transition: 'stroke .4s' }} />
      <circle cx={cx} cy={cy} r={r} fill="none"
        stroke="rgba(255,235,180,.38)" strokeWidth="3" strokeLinecap="round"
        strokeDasharray="2 34" className={direction === 1 ? 'flow-cw' : 'flow-ccw'}
        style={{ animationDuration: '16s' }} />
      <g transform={`translate(${ax} ${ay}) rotate(${tang})`}>
        <path d="M -11 -9 L 9 0 L -11 9 L -4 0 Z" fill={COLOR_HEX[activeColor]}
          style={{ filter: `drop-shadow(0 0 5px ${COLOR_HEX[activeColor]})` }} />
        <path d="M -11 -9 L 9 0 L -11 9 L -4 0 Z" fill="#fff" opacity=".3" />
      </g>
    </svg>
  );
}

/** 横屏短屏（手机横持）→ 紧凑布局：牌桌居左，右侧窄栏手牌 */
function useCompactLandscape() {
  const [c, setC] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth > window.innerHeight && window.innerHeight < 560);
  useEffect(() => {
    const f = () => setC(window.innerWidth > window.innerHeight && window.innerHeight < 560);
    window.addEventListener('resize', f);
    window.addEventListener('orientationchange', f);
    return () => { window.removeEventListener('resize', f); window.removeEventListener('orientationchange', f); };
  }, []);
  return c;
}

export default function Game() {
  const { view, room, identity, chat, muted, setMuted, showColorblind, leaveRoom, connected, theme, setTheme } = useStore();
  const [pendingWild, setPendingWild] = useState<number | null>(null);
  const [groupChoice, setGroupChoice] = useState<{ id: number; turn: number } | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showScore, setShowScore] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [flies, setFlies] = useState<Fly[]>([]);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [sparks, setSparks] = useState<Spark[]>([]);
  const [feed, setFeed] = useState<{ id: number; text: string } | null>(null);
  const [shake, setShake] = useState(false);
  const [intro, setIntro] = useState<string | null>(null);
  const [sorted, setSorted] = useState(false);
  const [showTut, setShowTut] = useState(() => !localStorage.getItem('uno-tut'));
  const [voiceTick, setVoiceTick] = useState(0);
  const [debugMode, setDebugMode] = useState(() =>
    new URLSearchParams(location.search).get('debug') === '1' || localStorage.getItem('uno-debug') === '1');
  const compact = useCompactLandscape();

  const lastEvSeq = useRef(0);
  const lastActRef = useRef<{ k: string; t: number }>({ k: '', t: 0 });
  const dragLock = useRef(0);
  const tableRef = useRef<HTMLDivElement>(null);
  const [tableBox, setTableBox] = useState({ w: 1440, h: 700 });
  const [gone, setGone] = useState<Set<number>>(new Set());
  const optPlay = useRef<{ cardId: number; t: number } | null>(null);
  const optDraw = useRef(0);

  // 牌桌尺寸测量 → 座位椭圆对齐 + 响应式缩放
  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setTableBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);

  // 自动 UI 缩放：座位边距按实测尺寸动态算 + 人多/屏小时整体缩 UI，避免重叠裁边
  useEffect(() => {
    seatCompact = compact;
    // 座位路径容量（座位单位数）装不下 n 个座位块 → 整体缩 zoom
    const sc = Math.max(0.8, Math.min(1.5, (tableBox.w * 0.55 + tableBox.h * 0.45) / 560));
    const nOpp = (view?.seats.filter(s => s.cardCount >= 0).length ?? 2) - 1;
    autoZVal = Math.min(1, segUnits(tableBox.w, tableBox.h, sc, compact).total / Math.max(1, nOpp * 1.02));
    const manual = parseFloat(localStorage.getItem('uno-uiscale') ?? '1');
    const root = document.getElementById('root');
    if (root) root.style.zoom = String(manual * autoZVal);
    return () => {
      autoZVal = 1;
      if (root) root.style.zoom = localStorage.getItem('uno-uiscale') ?? '1';
    };
  }, [tableBox, compact, view?.seats.length]);

  // DOMRect → 牌桌区内百分比坐标（手牌在表下方，y 可 >100）
  const relPct = (r: DOMRect): [number, number] => {
    const t = tableRef.current?.getBoundingClientRect();
    if (!t) return [50, 50];
    return [((r.left + r.width / 2 - t.left) / t.width) * 100, ((r.top + r.height / 2 - t.top) / t.height) * 100];
  };
  const elPct = (id: string): [number, number] | null => {
    const el = document.getElementById(id);
    return el ? relPct(el.getBoundingClientRect()) : null;
  };
  /** 即将摸到的牌在手牌扇中的槽位中心（末尾位置），牌桌区 % 坐标 */
  const slotPct = (): [number, number] | null => {
    const el = document.getElementById('my-hand');
    const t = tableRef.current;
    if (!el || !t) return null;
    const r = el.getBoundingClientRect(), tr = t.getBoundingClientRect();
    const n0 = myHand.length;                       // 摸前牌数
    const pitch0 = n0 > 1 ? Math.max(22, Math.min(cardW * 0.68, (vw - 24 - cardW) / Math.max(n0, 1))) : 0;
    const cx = r.left + r.width / 2 + (n0 / 2) * pitch0;   // 新牌位于末尾 → off = n/2
    return [((cx - tr.left) / tr.width) * 100, ((r.top + r.height / 2 - tr.top) / tr.height) * 100];
  };

  const me = view?.me;
  const mySeat = me?.seatIndex ?? -1;
  const total = view?.seats.filter(s => s.cardCount >= 0).length ?? 0;
  const myTurn = !!view && !!me && !me.isSpectator && view.current === mySeat && view.phase === 'play';
  const top = view?.discardTop;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 300);
    return () => clearInterval(t);
  }, []);


  // 事件 → 飞牌动画
  useEffect(() => {
    const ev = view?.lastEvent;
    if (!ev || ev.seq <= lastEvSeq.current) return;
    lastEvSeq.current = ev.seq;
    const n = total;
    const src = seatPos(ev.seat, mySeat, n);
    const srcFan = fanPos(ev.seat, mySeat, n);
    const addFly = (fly: Fly) => {
      setFlies(f => [...f, fly]);
      setTimeout(() => setFlies(f => f.filter(x => x.id !== fly.id)), (fly.dur ?? .5) * 1000 + 260 + (fly.delay ?? 0) * 1000);
    };
    if (ev.type === 'deal') {
      const seats = view!.seats.filter(s => s.cardCount >= 0).map(s => s.index);
      const dealFrom = elPct('deck-pile') ?? [41, 48];
      seats.forEach(si => [0, 1, 2].forEach(j =>
        addFly({ id: ++flySeq, from: dealFrom, to: seatPos(si, mySeat, n), delay: si * 0.1 + j * 0.16,
          w: 64, toW: si === mySeat ? cardW : 30 })));
      setIntro(view!.round === 1 ? 'UNO 开局！' : `第 ${view!.round} 轮`);
      setTimeout(() => setIntro(null), 1600);
      playSnd('deal', useStore.getState().muted);
      if (identity?.key) playVoice(identity.key, 'start', useStore.getState().muted);
      return;
    }
    if (ev.type === 'play' || ev.type === 'jump_in' || ev.type === 'multi_play') {
      const skipFly = ev.seat === mySeat && optPlay.current != null
        && Date.now() - optPlay.current.t < 1500 && view.discardTop?.id === optPlay.current.cardId;
      if (!skipFly) {
        addFly({ id: ++flySeq, from: srcFan, to: elPct('discard-top') ?? elPct('discard-pile') ?? [59, 48],
          card: view.discardTop ?? undefined, w: 44, toW: 88, toRot: -4, dur: 0.62, flip: true });
        playSnd('play', useStore.getState().muted);
      }
      optPlay.current = null;
      // 弃牌堆粒子溅射
      const c = view.discardTop?.color ? COLOR_HEX[view.discardTop.color] : '#fbbf24';
      const ns = Array.from({ length: 8 }, (_, i) => ({
        id: ++flySeq, ang: i * 45 + (ev.seq % 30), dist: 30 + ((i * 37 + ev.seq) % 34),
        color: i % 3 === 0 ? '#fff' : c, pos: [59, 48] as [number, number],
      }));
      setSparks(s => [...s, ...ns]);
      setTimeout(() => setSparks(s => s.filter(x => !ns.some(n => n.id === x.id))), 750);
    } else if (ev.type === 'draw' || ev.type === 'draw_penalty') {
      {
        const drawFrom = elPct('deck-pile') ?? [41, 48];
        // 我摸的牌：牌背翻成真实牌面，飞到它在扇形里的实际槽位；对手摸的：缩进 24px 牌扇
        const myDrawCard = ev.seat === mySeat ? (view.drewThisTurn ?? undefined) : undefined;
        const drawTo = ev.seat === mySeat ? (slotPct() ?? elPct('my-hand') ?? [50, 115]) : srcFan;
        addFly({ id: ++flySeq, from: drawFrom, to: drawTo, w: 64,
          toW: ev.seat === mySeat ? cardW : 30, card: myDrawCard, flip: !!myDrawCard, toHand: !!myDrawCard });
        playSnd('draw', useStore.getState().muted);
      }
      if (ev.seat === mySeat) optDraw.current = 0;
      if (ev.type === 'draw_penalty' && ev.seat === mySeat) {
        setShake(true);
        setTimeout(() => setShake(false), 500);
      }
    } else if (ev.type === 'swap_hands') {
      const tgt = (ev.detail?.target as number) ?? -1;
      const dst = seatPos(tgt, mySeat, n);
      addFly({ id: ++flySeq, from: src, to: dst });
      addFly({ id: ++flySeq, from: dst, to: src, delay: 0.08 });
    } else if (ev.type === 'rotate_hands') {
      const d = view!.direction;
      const seatIdxs = view!.seats.filter(s => !s.eliminated && !s.outRank && s.cardCount >= 0).map(s => s.index);
      seatIdxs.forEach((si, k) => {
        const next = seatIdxs[(k + d + seatIdxs.length) % seatIdxs.length];
        addFly({ id: ++flySeq, from: seatPos(si, mySeat, n), to: seatPos(next, mySeat, n), delay: k * 0.05 });
      });
    } else if (ev.type === 'uno') {
      playSnd('uno', useStore.getState().muted);
    } else if (ev.type === 'uno_caught') {
      playSnd('catch', useStore.getState().muted);
    } else if (ev.type === 'round_end' || ev.type === 'match_end') {
      playSnd('win', useStore.getState().muted);
    }
    // 角色语音：出牌按牌型播报，其余按事件
    const seatKey = view!.seats[ev.seat]?.key;
    if (seatKey) {
      let vev: string | null = null;
      if (ev.type === 'play' || ev.type === 'jump_in') {
        const k = (ev.detail?.kind as string) ?? (view!.discardTop?.kind ?? '');
        vev = k === 'draw_two' ? 'draw_two' : k === 'wild_draw_four' ? 'draw_four'
          : k === 'skip' ? 'skip' : k === 'reverse' ? 'reverse' : k === 'wild' ? 'wild' : null;
      } else if (ev.type === 'uno') vev = 'uno';
      else if (ev.type === 'uno_caught') vev = 'uno_caught';
      else if (ev.type === 'player_out') vev = 'out';
      else if (ev.type === 'match_end') vev = ev.seat === mySeat ? 'win' : 'lose';
      if (vev) playVoice(seatKey, vev, useStore.getState().muted);
    }
    const b = BURSTS[ev.type];
    if (b) {
      const id = ++flySeq;
      setBursts(bs => [...bs, { id, text: b.text, color: b.color, pos: src }]);
      setTimeout(() => setBursts(bs => bs.filter(x => x.id !== id)), 1100);
    }
    const txt = describeEvent(ev, view!, cardLabel);
    if (txt) {
      const id = ev.seq;
      setFeed({ id, text: txt });
      setTimeout(() => setFeed(f => (f?.id === id ? null : f)), 3200);
    }
  }, [view?.lastEvent, mySeat, total]);


  const playableIds = useMemo(() => {
    const ids = new Set<number>();
    if (!view || !me || me.isSpectator || !top) return ids;
    const seat = view.seats[me.seatIndex];
    if (!seat || seat.eliminated || seat.outRank) return ids;
    const hand = me.hand;
    const hr = room?.settings.houseRules;
    if (view.phase === 'challenge' && view.challenge?.challengerSeat === me.seatIndex) {
      return new Set(counterCards(hand, top, hr).map(c => c.id));
    }
    if (view.phase !== 'play') return ids;
    if (!myTurn) return new Set(jumpInCards(hand, top, !!hr?.jumpIn).map(c => c.id));
    if (view.pendingDraw > 0) return new Set(counterCards(hand, top, hr).map(c => c.id));
    if (view.drewThisTurn) { ids.add(view.drewThisTurn.id); return ids; }
    for (const c of hand) {
      if (c.kind === 'wild_draw_four' && !hr?.simpleMode) {
        if (!hand.some(x => x.id !== c.id && x.color === view.activeColor)) ids.add(c.id);
        continue;
      }
      if (cardMatches(c, top, view.activeColor)) ids.add(c.id);
    }
    return ids;
  }, [view, me, myTurn, top, room]);

  useEffect(() => {
    if (pendingWild !== null && !playableIds.has(pendingWild)) setPendingWild(null);
  }, [pendingWild, playableIds]);

  // 桌面快捷键：1-9 出可出的第 N 张、空格摸牌、U 喊 UNO、P 过牌
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const st = useStore.getState();
      if (!st.view || st.route !== 'game') return;
      if (e.key === 'u' || e.key === 'U') { socket.emit('game:uno'); playSnd('uno', st.muted); return; }
      if (!myTurn) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (!st.view!.drewThisTurn) socket.emit('game:draw');
        return;
      }
      if (e.key === 'p' || e.key === 'P') { if (st.view!.drewThisTurn) socket.emit('game:pass'); return; }
      const k = +e.key;
      if (k >= 1 && k <= 9) {
        const playable = (st.view!.me.hand ?? []).filter(c => playableIds.has(c.id));
        const c = playable[k - 1];
        if (c) onCardTap(c);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [myTurn, playableIds]);

  // 服务器同步新手牌 → 清除乐观隐藏
  const handRef = me?.hand;
  useEffect(() => { setGone(new Set()); optPlay.current = null; }, [handRef]);

  // 背景音乐：对局中播放，随静音联动，离开页面停止
  useEffect(() => { syncBgm(muted); return () => stopBgm(); }, [muted]);

  // 调试模式：应用已保存的位移/缩放覆盖
  useEffect(() => {
    localStorage.setItem('uno-debug', debugMode ? '1' : '0');
    if (!debugMode) return;
    try {
      const ov = JSON.parse(localStorage.getItem('uno-dbg') ?? '{}') as Record<string, { dx: number; dy: number; s: number }>;
      (window as unknown as { __dbg: unknown }).__dbg = ov;
      Object.entries(ov).forEach(([id, o]) => {
        const el = document.getElementById(id);
        if (el) { el.style.translate = `${o.dx}px ${o.dy}px`; el.style.scale = `${o.s}`; }
      });
    } catch { /* ignore */ }
  }, [debugMode, view]);

  // 轮到我的回合 → 提示音
  const myTurnRef = useRef(false);
  useEffect(() => {
    if (myTurn && !myTurnRef.current) {
      playSnd('turn', muted);
      if (identity?.key) playVoice(identity.key, 'turn', muted);
    }
    myTurnRef.current = myTurn;
  }, [myTurn, muted]);

  if (!view) return <div className="felt h-full flex items-center justify-center">加载中…</div>;

  const opponents = orderedOpponents(mySeat, total)
    .map(i => view.seats[i])
    .filter(s => s && s.cardCount >= 0);
  seatCompact = compact;
  const oppScale = Math.max(0.8, Math.min(1.5, (tableBox.w * 0.55 + tableBox.h * 0.45) / 560));
  // 座位块实测：宽约 110px（含名牌），中心向上 ~52px（名牌+半头像），向下 ~92px（头像+牌扇+抓按钮）
  seatM = {
    x: Math.min(14, Math.max(4, (58 * oppScale / tableBox.w) * 100 + 0.5)),
    yT: Math.min(22, Math.max(6, (56 * oppScale / tableBox.h) * 100 + 0.5)),
    yB: Math.min(34, Math.max(10, (96 * oppScale / tableBox.h) * 100 + 0.5)),
  };
  const positions = seatPositions(opponents.length, compact, tableBox.w, tableBox.h, oppScale);
  seatPosCache = positions;
  const myHandRaw = me?.hand ?? [];
  const myHand = sorted ? [...myHandRaw].sort((a, b) => {
    const co = (c: Card) => (c.color ? COLORS.indexOf(c.color) : c.kind === 'wild_draw_four' ? 5 : 4);
    const d = co(a) - co(b); if (d) return d;
    const vo = (c: Card) => c.kind === 'number' ? (c.value ?? 0) : c.kind === 'draw_two' ? 20 : c.kind === 'skip' ? 21 : 22;
    return vo(a) - vo(b);
  }) : myHandRaw;
  const isChallenger = view.phase === 'challenge' && view.challenge?.challengerSeat === mySeat;
  const needColor = view.phase === 'choose_color' && view.current === mySeat;
  const needSwap = view.phase === 'swap_target' && view.current === mySeat;
  const vulnerable = new Set(view.unoVulnerable);
  const offline = new Set((room?.seats ?? []).filter(s => 'connected' in s && !s.connected).map(s => ('key' in s ? s.key : '')));
  const recentChat = chat.filter(m => now - m.t < 4000);

  // 动作防抖：同一事件 400ms 内重复触发直接丢弃（双击/拖拽回弹 click 兜底）
  const act = (ev: string, p?: unknown) => {
    const k = ev + JSON.stringify(p ?? null);
    const t = Date.now();
    if (k === lastActRef.current.k && t - lastActRef.current.t < 400) return;
    lastActRef.current = { k, t };
    socket.emit(ev, p);
  };

  // 乐观出牌：立即隐藏手牌 + 从牌原位飞到弃牌堆（不等服务器回包）
  const spawnOptFly = (c: Card, el?: HTMLElement | null, rot = 0) => {
    optPlay.current = { cardId: c.id, t: Date.now() };
    setGone(g => { const s = new Set(g); s.add(c.id); return s; });
    setTimeout(() => setGone(g => { const s = new Set(g); s.delete(c.id); return s; }), 2500);
    const from: [number, number] = el ? relPct(el.getBoundingClientRect()) : [50, 115];
    const fly: Fly = { id: ++flySeq, from, to: elPct('discard-top') ?? elPct('discard-pile') ?? [59, 48],
      card: c, w: cardW, rot, toW: 88, toRot: -4 };
    setFlies(f => [...f, fly]);
    setTimeout(() => setFlies(f => f.filter(x => x.id !== fly.id)), 700);
    playSnd('play', muted);
  };

  const allowBundle = !!(myTurn && !view.drewThisTurn && !view.pendingDraw && room?.settings.houseRules.multiplePlaySameNumber);
  const firstOfGroup = groupChoice?.turn === view.turnStartedAt && playableIds.has(groupChoice.id)
    ? me?.hand.find(c => c.id === groupChoice.id) : undefined;
  const group = firstOfGroup ? numberBundle(firstOfGroup, me?.hand ?? [], allowBundle) : [];
  const playGroup = (cards: Card[]) => {
    setGroupChoice(null);
    if (!cards.length) return;
    spawnOptFly(cards[0]);
    act('game:play', { cardIds: cards.map(c => c.id) });
  };

  const onCardTap = (c: Card, el?: HTMLElement | null, rot = 0) => {
    if (!playableIds.has(c.id) || gone.has(c.id)) return;
    if (numberBundle(c, me?.hand ?? [], allowBundle).length > 1) {
      setGroupChoice({ id: c.id, turn: view.turnStartedAt });
      return;
    }
    spawnOptFly(c, el, rot);
    if (c.kind === 'wild' || c.kind === 'wild_draw_four') setPendingWild(c.id);
    else act('game:play', { cardIds: [c.id] });
  };
  const playWild = (color: Color) => {
    if (pendingWild != null) {
      act('game:play', { cardIds: [pendingWild], wildColor: color });
      setPendingWild(null);
    } else if (needColor) act('game:color', { color });
  };

  const remain = Math.max(0, view.turnSeconds - (now - view.turnStartedAt) / 1000);
  const remainPct = Math.max(0, Math.min(1, remain / view.turnSeconds));
  const topCovered = flies.some(f => f.toW === 88);
  const coveredHandIds = new Set(flies.filter(f => f.toHand && f.card).map(f => f.card!.id));

  // 手牌尺寸与扇形参数（随视口与牌数自适应）
  const vw = typeof window === 'undefined' ? 800 : Math.min(window.innerWidth, 920);
  const n = myHand.length;
  // 扇形手牌：牌宽优先，横向间距 pitch 保证每张至少露出 ~68%
  const cardW = compact ? 50 : Math.max(46, Math.min(80, (vw - 24) / (n > 1 ? 0.62 * (n - 1) + 1 : 1)));
  const pitch = n > 1 ? Math.max(22, Math.min(cardW * 0.68, (vw - 24 - cardW) / (n - 1))) : 0;

  const curName = view.seats[view.current]?.name ?? '…';
  const hint = me?.isSpectator ? '观战中'
    : needColor ? '选择一种颜色'
    : needSwap ? '点一名玩家交换手牌'
    : view.pendingDraw > 0 && myTurn ? `被加牌！打出 +牌 或摸 ${view.pendingDraw} 张`
    : myTurn && view.drewThisTurn ? '打出摸到的牌，或过牌'
    : myTurn && playableIds.size > 0 ? '轮到你 · 选一张高亮的牌打出'
    : myTurn ? '没有能出的牌 · 点牌堆摸一张'
    : view.phase === 'play' && playableIds.size > 0 ? '同牌抢出 · 点选高亮牌'
    : `等待 ${curName}`;

  const cardLabel = (c: Card | null) => {
    if (!c) return '牌';
    if (c.kind === 'wild') return '变色';
    if (c.kind === 'wild_draw_four') return '+4';
    const cn = c.color ? COLOR_NAME[c.color] : '';
    const kn = c.kind === 'number' ? `${c.value}` : c.kind === 'skip' ? '跳过' : c.kind === 'reverse' ? '反转' : '+2';
    return `${cn}${kn}`;
  };

  return (
    <div className={`felt h-full flex flex-col overflow-hidden relative ${shake ? 'screen-shake' : ''}`}>
      {/* 断线提示 */}
      {!connected && (
        <div className="absolute top-0 inset-x-0 z-50 bg-red-600/95 text-white text-center text-xs font-bold py-1.5">
          连接中断，重连中…
        </div>
      )}
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-3 pt-2 z-20">
        <button onClick={leaveRoom} className="glass text-white/70 p-2 rounded-xl"><ArrowLeft size={18} /></button>
        <div className="glass rounded-xl px-4 py-1 text-center">
          <div className="text-white/90 text-[13px] font-bold tracking-wide">房间 {view.code}</div>
          <div className="text-white/45 text-[10px] h-3.5">
            {feed ? feed.text : `第 ${view.round} 轮${view.targetScore > 0 ? ` · 目标 ${view.targetScore}` : ''}`}
          </div>
        </div>
        <div className="flex gap-1.5">
          <button title="切换牌桌主题"
            onClick={() => setTheme(theme === 'night' ? 'green' : theme === 'green' ? 'violet' : 'night')}
            className="glass text-white/70 p-2 rounded-xl"><Palette size={17} /></button>
          <button onClick={() => setShowScore(true)} className="glass text-white/70 p-2 rounded-xl"><Trophy size={17} /></button>
          <button onClick={() => setMuted(!muted)} className="glass text-white/70 p-2 rounded-xl">
            {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>
          <button title="背景音乐" onClick={() => { setBgmEnabled(!bgmEnabled()); setVoiceTick(t => t + 1); }}
            className={`glass p-2 rounded-xl ${bgmEnabled() && voiceTick >= 0 ? 'text-amber-300' : 'text-white/40'}`}>
            <Music size={17} />
          </button>
          <button title="布局调试模式" onClick={() => setDebugMode(d => !d)}
            className={`glass p-2 rounded-xl ${debugMode ? 'text-emerald-300' : 'text-white/40'}`}>
            <Bug size={17} />
          </button>
          <button title="语音包：点击切中/EN，长按关闭" onClick={() => {
              if (!voiceEnabled()) setVoiceEnabled(true);
              else if (voiceLang() === 'zh') setVoiceLang('en');
              else { setVoiceLang('zh'); setVoiceEnabled(false); }
              setVoiceTick(t => t + 1);
            }} className="glass text-white/70 px-2 py-2 rounded-xl text-[11px] font-black">
            {voiceTick >= 0 && (!voiceEnabled() ? '静' : voiceLang() === 'zh' ? '中' : 'EN')}
          </button>
        </div>
      </div>

      {/* 牌桌区（compact 时与右侧栏同排） */}
      <div className={compact ? 'flex-1 flex min-h-0' : 'contents'}>
      <div ref={tableRef} className="flex-1 relative min-h-0">
        <DirectionRing direction={view.direction} activeColor={view.activeColor}
          aim={seatPos(view.current, mySeat, total)} aspect={tableBox.w / Math.max(1, tableBox.h)} />

        {/* 对手座位 */}
        {opponents.map((o, i) => (
          <OpponentSeat key={o.index} o={o} pos={positions[i]} dbgId={`opp-${i}`}
            isCurrent={view.current === o.index && (view.phase === 'play' || view.phase === 'choose_color' || view.phase === 'swap_target' || view.phase === 'challenge')}
            remainPct={view.current === o.index ? remainPct : 1}
            isOwner={o.key === room?.ownerKey}
            needSwap={needSwap && !o.eliminated && !o.outRank} onSwap={() => act('game:swap', { targetSeat: o.index })}
            canCatch={vulnerable.has(o.index)} onCatch={() => act('game:catch', { targetSeat: o.index })}
            chatBubble={recentChat.filter(m => m.seat === o.index).at(-1)}
            offline={offline.has(o.key)}
            outRank={o.outRank}
            scale={oppScale}
          />
        ))}

        {/* 中央：摸牌堆 + 弃牌堆 */}
        <div id="piles" className="absolute left-1/2 top-[56%] -translate-x-1/2 -translate-y-1/2 flex items-center gap-7 z-10">
          {/* 摸牌堆：三层叠影 */}
          <motion.button id="deck-pile" whileTap={{ scale: 0.93 }} onClick={() => {
              if (!(myTurn && (!view.drewThisTurn || view.pendingDraw > 0))) return;
              playSnd('draw', muted);
              act('game:draw');
            }}
            className="relative" style={{ width: 72, height: 106 }}>
            <div className="absolute left-1 top-1 opacity-60"><CardBack w={64} /></div>
            <div className="absolute left-0.5 top-0.5 opacity-85"><CardBack w={64} /></div>
            <div className="absolute left-0 top-0"><CardBack w={64} /></div>
            <div className="absolute -top-2 -right-2 glass rounded-full min-w-6 h-6 px-1.5 flex items-center justify-center text-[11px] font-black text-white/90 z-10">
              {view.deckCount}
            </div>
            {myTurn && !view.drewThisTurn && playableIds.size === 0 && view.pendingDraw === 0 && (
              <div className="absolute -top-3 -left-3 w-6 h-6 bg-amber-400 rounded-full animate-bounce text-[13px] flex items-center justify-center font-black text-black z-10">!</div>
            )}
            {view.pendingDraw > 0 && myTurn && (
              <div className="absolute -bottom-9 inset-x-0 text-center text-orange-300 text-[11px] font-bold whitespace-nowrap z-10">点此摸牌</div>
            )}
          </motion.button>

          {/* 弃牌堆：底色光晕 + 顶部大牌 + 当前颜色角标 */}
          <div className="relative" id="discard-pile">
            <div className="absolute inset-0 -m-10 rounded-full pointer-events-none"
              style={{ background: `radial-gradient(circle, ${COLOR_HEX[view.activeColor]}55, transparent 65%)`, transition: 'background .4s' }} />
            {/* 当前生效颜色 */}
            <div className="absolute -top-8 -right-8 flex items-center gap-1 z-20 pointer-events-none">
              <div className="w-4 h-4 rounded-full border-2 border-white shadow-md"
                style={{ background: COLOR_HEX[view.activeColor] }} />
              <span className="text-[10px] font-black text-white/80 drop-shadow">{COLOR_NAME[view.activeColor]}</span>
            </div>
            {/* 飞牌落位期间隐藏真身，飞出完毕交叉淡入 —— 动画对象与真身无缝衔接 */}
            {(view.discardPrev ?? []).map((c, i) => (
              <div key={c.id} className="absolute" style={{
                transform: `rotate(${-16 + i * 9}deg) translate(${-10 + i * 7}px, ${3 - i * 2}px)`,
                opacity: 0.4 - i * 0.08, zIndex: 0,
              }}><CardFace card={c} w={80} /></div>
            ))}
            <AnimatePresence mode="popLayout">
              {top && (
                <motion.div key={`${top.id}-${view.round}`} id="discard-top"
                  initial={{ y: 42, rotate: -16, opacity: 0, scale: .8 }}
                  animate={{ y: 0, rotate: -4, opacity: topCovered ? 0 : 1, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 22, opacity: { duration: 0 } }}>
                  <CardFace card={top} w={88} />
                </motion.div>
              )}
            </AnimatePresence>
            {view.pendingDraw > 0 && (
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
                className="absolute -top-3 -right-4 bg-red-500 text-white text-[12px] font-black px-2.5 py-1 rounded-full z-10 shadow-lg border border-red-300">
                +{view.pendingDraw}
              </motion.div>
            )}
          </div>
        </div>

        {/* 飞牌动画层 */}
        <AnimatePresence>
          {flies.map(f => (
            <motion.div key={f.id} className="absolute z-30 pointer-events-none"
              initial={{ left: `${f.from[0]}%`, top: `${f.from[1]}%`, x: '-50%', y: '-50%', opacity: 1, scale: (f.w ?? 64) / 80, rotate: f.rot ?? 0 }}
              animate={{ left: `${f.to[0]}%`, top: `${f.to[1]}%`, x: '-50%', y: '-50%', opacity: 1, scale: (f.toW ?? 80) / 80, rotate: f.toRot ?? 0 }}
              transition={{ duration: f.dur ?? .5, ease: [0.25, 0.8, 0.35, 1], delay: f.delay ?? 0 }}
              onAnimationComplete={() => setFlies(fl => fl.filter(x => x.id !== f.id))}
              style={{ willChange: 'transform, left, top' }}>
              {f.flip && f.card ? (
                <div style={{ perspective: 800 }}>
                  <motion.div
                    initial={{ rotateY: 0 }} animate={{ rotateY: 180 }}
                    transition={{ duration: (f.dur ?? .5) * 0.85, delay: f.delay ?? 0 }}
                    style={{ transformStyle: 'preserve-3d', position: 'relative', width: 80, height: 118 }}>
                    <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <CardBack w={64} />
                    </div>
                    <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                      <CardFace card={f.card} w={80} />
                    </div>
                  </motion.div>
                </div>
              ) : f.card ? <CardFace card={f.card} w={80} /> : <CardBack w={64} />}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* 弃牌堆粒子 */}
        <AnimatePresence>
          {sparks.map(s => (
            <motion.div key={s.id} className="absolute z-30 pointer-events-none rounded-full"
              style={{ left: `${s.pos[0]}%`, top: `${s.pos[1]}%`, width: 7, height: 7, background: s.color,
                boxShadow: `0 0 8px ${s.color}`, marginLeft: -3.5, marginTop: -3.5 }}
              initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
              animate={{ x: Math.cos(s.ang * Math.PI / 180) * s.dist * 1.6, y: Math.sin(s.ang * Math.PI / 180) * s.dist, opacity: 0, scale: .3 }}
              transition={{ duration: .55, ease: 'easeOut' }} />
          ))}
        </AnimatePresence>

        {/* 事件爆闪 */}
        <AnimatePresence>
          {bursts.map(b => (
            <motion.div key={b.id}
              className="absolute z-40 pointer-events-none font-black whitespace-nowrap"
              style={{ left: `${b.pos[0]}%`, top: `${b.pos[1]}%`, color: b.color,
                textShadow: `0 0 18px ${b.color}, 0 2px 6px rgba(0,0,0,.6)`,
                fontSize: 26, WebkitTextStroke: '1px rgba(0,0,0,.35)' }}
              initial={{ scale: .3, opacity: 0, rotate: -10, x: '-50%', y: '-50%' }}
              animate={{ scale: 1.15, opacity: 1, rotate: 0, x: '-50%', y: '-60%' }}
              exit={{ opacity: 0, scale: 1.3, x: '-50%', y: '-80%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 18 }}>
              {b.text}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* 开局/新一轮大字 */}
        <AnimatePresence>
          {intro && (
            <motion.div key="intro"
              className="absolute inset-0 z-50 flex flex-col items-center justify-center pointer-events-none"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 1.4 }}>
              <motion.div
                className="font-black text-white"
                style={{ fontSize: 54, letterSpacing: '.08em',
                  textShadow: '0 0 40px rgba(96,165,250,.9), 0 4px 14px rgba(0,0,0,.7)' }}
                initial={{ scale: .2, rotate: -8 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 15 }}>
                {intro}
              </motion.div>
              <motion.div className="text-[13px] font-bold text-white/70 mt-2"
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .3 }}>
                好运从一手好牌开始
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 回合提示横幅 */}
        <div id="hint-pill" className="absolute left-1/2 top-[80%] -translate-x-1/2 z-10 pointer-events-none">
          <div key={hint} className="hint-in glass rounded-full px-4 py-1.5 text-[12px] font-bold whitespace-nowrap"
            style={{ color: myTurn ? '#ffd76a' : 'rgba(255,255,255,.6)' }}>
            {hint}
          </div>
        </div>
      </div>
      {compact && (
        <div className="w-[132px] shrink-0 flex flex-col gap-1.5 px-1.5 py-1.5 overflow-y-auto border-l border-white/10 relative z-10">
          <div className={`flex items-center gap-1.5 px-1.5 py-1 rounded-xl ${myTurn ? 'seat-active bg-amber-400/20 ring-1 ring-amber-300/70' : 'glass'}`}>
            <Avatar name={identity?.name ?? '?'} size={22} />
            <span className="text-[11px] font-bold text-white/80 truncate">{identity?.name}</span>
            {(view.scores[identity?.key ?? ''] ?? 0) > 0 && (
              <span className="text-[9px] text-amber-300 font-black ml-auto">{view.scores[identity?.key ?? '']}</span>
            )}
          </div>
          {me?.isSpectator ? (
            <div className="glass text-white/55 text-[11px] py-3 text-center rounded-xl">观战中</div>
          ) : (
            <div className="grid grid-cols-2 gap-1 justify-items-center">
              {myHand.map((c, i) => (
                <motion.div key={c.id} layout
                  initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                  onClick={() => { if (playableIds.has(c.id)) onCardTap(c); }}>
                  <CardFace card={c} w={cardW} playable={playableIds.has(c.id)}
                    dimmed={!!(myTurn && !playableIds.has(c.id) && (view.drewThisTurn != null || playableIds.size > 0))}
                    colorblind={showColorblind} />
                </motion.div>
              ))}
            </div>
          )}
          {!me?.isSpectator && (
            <div className="flex flex-col gap-1.5 mt-auto pt-1.5">
              <motion.button whileTap={{ scale: 0.9 }}
                onClick={() => { act('game:uno'); playSnd('uno', muted); }}
                className={`bg-gradient-to-b from-red-500 to-red-600 text-white font-black text-sm py-1.5 rounded-xl shadow border border-red-300/40
                  ${myHand.length === 2 ? 'uno-glow' : ''}`}>
                UNO!
              </motion.button>
              {view.drewThisTurn && myTurn && (
                <button onClick={() => act('game:pass')} className="glass text-white/90 py-1.5 rounded-xl text-[11px] font-bold">过牌</button>
              )}
              {view.pendingDraw > 0 && myTurn && (
                <button onClick={() => act('game:draw')}
                  className="bg-gradient-to-b from-orange-500 to-orange-600 text-white py-1.5 rounded-xl text-[11px] font-black border border-orange-300/40">摸 {view.pendingDraw}</button>
              )}
              <button onClick={() => setShowEmoji(!showEmoji)} className="glass text-white p-1.5 rounded-xl self-center"><SmilePlus size={16} /></button>
            </div>
          )}
        </div>
      )}
      </div>

      {!compact && (<>
      {/* 我的信息条：倒计时环头像 + 名字状态 */}
      <div id="my-pill" className="flex items-center gap-2.5 px-4 pb-1.5">
        <div className="relative shrink-0 w-9 h-9">
          <Avatar name={identity?.name ?? '?'} size={34} />
          <svg className="absolute -inset-1" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="17.5" fill="none"
              stroke={myTurn ? '#fbbf24' : 'rgba(255,255,255,0.12)'} strokeWidth="2.5" strokeLinecap="round"
              strokeDasharray={110}
              strokeDashoffset={myTurn ? 110 * (1 - remainPct) : 0}
              transform="rotate(-90 20 20)"
              style={{ transition: 'stroke-dashoffset .3s linear' }} />
          </svg>
          {view.seats[mySeat]?.uno && (
            <span className="absolute -top-1 -right-2 text-[8px] bg-red-500 text-white font-black px-1 py-px rounded-full shadow">UNO</span>
          )}
        </div>
        <div className="flex flex-col leading-tight min-w-0">
          <span className={`text-[13px] font-bold truncate ${myTurn ? 'text-amber-200' : 'text-white/85'}`}>
            {identity?.name}{me?.isSpectator ? ' · 观战' : myTurn ? ' · 轮到你' : ''}
            {view.seats[mySeat]?.outRank ? ` · 第${view.seats[mySeat].outRank}名出完` : ''}
          </span>
          {(view.scores[identity?.key ?? ''] ?? 0) > 0 && (
            <span className="text-[10px] font-black text-amber-300/90">{view.scores[identity?.key ?? '']} 分</span>
          )}
        </div>
      </div>

      {/* 手牌扇 */}
      <div className="pb-1">
        <div id="my-hand" className="flex justify-center items-end pt-4 pb-1 overflow-visible"
          style={{ minHeight: cardW * 1.5 + 26, paddingLeft: 10, paddingRight: 10 }}>
          {me?.isSpectator ? (
            <div className="glass text-white/55 text-sm py-3 px-6 rounded-2xl">观战中 — 可发表情围观</div>
          ) : view.seats[mySeat]?.outRank ? (
            <div className="flex items-center gap-2 py-2">
              <span className="bg-gradient-to-b from-amber-300 to-amber-500 text-black text-xs font-black px-3 py-1.5 rounded-full shadow">
                第 {view.seats[mySeat].outRank} 名出完
              </span>
              <span className="text-white/50 text-xs">观战其他人决胜</span>
            </div>
          ) : (
            myHand.map((c, i) => {
              const off = i - (n - 1) / 2;
              const rot = off * Math.min(9, 42 / Math.max(n - 1, 1));
              return (
                <motion.div key={c.id} layout id={`handcard-${c.id}`}
                  initial={view.drewThisTurn?.id === c.id ? { rotateY: 90, opacity: 0, y: 0 } : { y: 60, opacity: 0 }}
                  animate={{ rotateY: 0, y: 0, opacity: coveredHandIds.has(c.id) ? 0 : 1 }}
                  whileHover={playableIds.has(c.id) ? { y: -10, scale: 1.04 } : undefined}
                  whileTap={playableIds.has(c.id) ? { scale: 0.96 } : undefined}
                  drag={playableIds.has(c.id) && !compact}
                  dragSnapToOrigin
                  dragElastic={0.25}
                  whileDrag={{ scale: 1.12, zIndex: 60 }}
                  onDragEnd={(e, info) => {
                    if (Math.hypot(info.offset.x, info.offset.y) > 12) dragLock.current = Date.now();
                    const pile = document.getElementById('discard-pile');
                    if (!pile) return;
                    const r = pile.getBoundingClientRect();
                    const p = info.point;
                    if (p.x > r.left - 34 && p.x < r.right + 34 && p.y > r.top - 40 && p.y < r.bottom + 40)
                      onCardTap(c, e.currentTarget as HTMLElement, rot);
                  }}
                  transition={{ delay: i * 0.03, type: 'spring', stiffness: 380, damping: 28 }}
                  onClick={(e) => {
                    if (Date.now() - dragLock.current < 240) return;
                    if (playableIds.has(c.id)) onCardTap(c, e.currentTarget as HTMLElement, rot);
                  }}
                  style={{
                    marginLeft: i ? pitch - cardW : 0,
                    transform: `rotate(${rot}deg) translateY(${Math.abs(off) * 2.5}px)`,
                    transformOrigin: '50% 135%',
                    zIndex: i,
                    visibility: gone.has(c.id) ? 'hidden' : 'visible',
                    cursor: playableIds.has(c.id) ? 'pointer' : 'default',
                  }}>
                  <CardFace card={c} w={cardW}
                    playable={playableIds.has(c.id)}
                    dimmed={!!(myTurn && !playableIds.has(c.id) && (view.drewThisTurn != null || playableIds.size > 0))}
                    colorblind={showColorblind} />
                </motion.div>
              );
            })
          )}
        </div>
      </div>

      {/* 操作按钮行 */}
      <div id="btn-row" className="flex items-center gap-2 px-3 pb-3 safe-bottom">
        {!me?.isSpectator && (
          <>
            <motion.button whileTap={{ scale: 0.9 }}
              onClick={() => { act('game:uno'); playSnd('uno', muted); }}
              className={`bg-gradient-to-b from-red-500 to-red-600 text-white font-black text-lg px-6 py-2.5 rounded-2xl shadow-lg border border-red-300/40
                ${myHand.length === 2 ? 'uno-glow' : ''}`}>
              UNO!
            </motion.button>
            {view.drewThisTurn && myTurn && (
              <button onClick={() => act('game:pass')}
                className="glass text-white/90 px-4 py-2.5 rounded-2xl text-sm font-bold">过牌</button>
            )}
            {view.pendingDraw > 0 && myTurn && (
              <button onClick={() => act('game:draw')}
                className="bg-gradient-to-b from-orange-500 to-orange-600 text-white px-4 py-2.5 rounded-2xl text-sm font-black shadow-lg border border-orange-300/40">
                摸 {view.pendingDraw} 张
              </button>
            )}
          </>
        )}
        <div className="flex-1" />
        {!me?.isSpectator && myHand.length > 3 && (
          <button onClick={() => setSorted(s => !s)} title={sorted ? '恢复摸牌顺序' : '按颜色理牌'}
            className={`p-2.5 rounded-2xl transition-colors ${sorted ? 'bg-amber-400/90 text-black' : 'glass text-white'}`}>
            <ArrowUpDown size={17} />
          </button>
        )}
        <button onClick={() => setShowEmoji(!showEmoji)} className="glass text-white p-2.5 rounded-2xl">
          <SmilePlus size={20} />
        </button>
      </div>
      </>)}

      {/* 表情条 */}
      <AnimatePresence>
        {showEmoji && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden glass absolute bottom-0 inset-x-0 z-40">
            <div className="flex gap-1 px-3 py-2 overflow-x-auto">
              {EMOJIS.map(e => (
                <button key={e} onClick={() => act('chat', { kind: 'emoji', value: e })}
                  className="text-2xl px-2 active:scale-125 transition-transform">{e}</button>
              ))}
            </div>
            <div className="flex gap-1.5 px-3 pb-3 overflow-x-auto">
              {PHRASES.map(p => (
                <button key={p} onClick={() => { act('chat', { kind: 'phrase', value: p }); setShowEmoji(false); }}
                  className="bg-white/10 text-white/85 text-xs px-3 py-1.5 rounded-full whitespace-nowrap">{p}</button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {group.length > 1 && (
        <Modal onClose={() => setGroupChoice(null)}>
          <div className="text-white text-center font-bold mb-3">同数字连打</div>
          <div className="text-center text-white/70 mb-4">{group.map(c => cardLabel(c)).join(' → ')}</div>
          <div className="flex gap-3">
            <button className="flex-1 glass rounded-xl p-3" onClick={() => playGroup(group.slice(0, 1))}>只出第一张</button>
            <button className="flex-1 bg-amber-400 text-black rounded-xl p-3 font-bold" onClick={() => playGroup(group)}>连出 {group.length} 张</button>
          </div>
        </Modal>
      )}

      {/* 选色：四色牌块 */}
      <AnimatePresence>
        {(pendingWild != null || needColor) && (
          <Modal onClose={pendingWild != null ? () => setPendingWild(null) : undefined}>
            <div className="text-white text-center mb-4 font-black text-lg">选择颜色</div>
            <div className="grid grid-cols-4 gap-2.5">
              {COLORS.map((c, i) => (
                <motion.button key={c} whileTap={{ scale: 0.88 }} whileHover={{ y: -5, rotate: -3 }}
                  initial={{ opacity: 0, y: 20, rotate: i % 2 ? 10 : -10 }}
                  animate={{ opacity: 1, y: 0, rotate: 0 }}
                  transition={{ delay: i * 0.05, type: 'spring', stiffness: 340, damping: 20 }}
                  onClick={() => playWild(c)}
                  className="h-24 rounded-xl relative overflow-hidden"
                  style={{
                    background: `linear-gradient(160deg, ${COLOR_HEX[c]}, ${COLOR_DARK[c]})`,
                    border: '3px solid rgba(255,255,255,.92)',
                    boxShadow: `0 10px 22px ${COLOR_HEX[c]}77, inset 0 1px 0 rgba(255,255,255,.4)`,
                  }}>
                  <div className="absolute inset-x-2 top-3 bottom-3 rounded-full bg-white" style={{ transform: 'rotate(-22deg)', clipPath: 'ellipse(50% 50%)' }} />
                  <span className="absolute inset-0 flex items-center justify-center font-black text-lg" style={{ color: COLOR_HEX[c] }}>
                    {COLOR_NAME[c]}
                  </span>
                </motion.button>
              ))}
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* 质疑 */}
      <AnimatePresence>
        {isChallenger && pendingWild === null && (
          <Modal>
            <div className="text-white text-center mb-1 font-black text-lg">被 +4 了！</div>
            <div className="text-white/60 text-center text-sm mb-5">质疑对方是否合法？<br />成功对方摸 4 张 · 失败你摸 6 张</div>
            {playableIds.size > 0 && (
              <div className="mb-3 flex flex-wrap gap-2 justify-center">
                {myHand.filter(c => playableIds.has(c.id)).map(c => (
                  <button key={c.id} className="glass px-3 py-2 rounded-xl font-bold" onClick={() => onCardTap(c)}>
                    叠加 {cardLabel(c)}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => act('game:challenge', { challenge: false })}
                className="flex-1 bg-white/15 text-white py-3 rounded-2xl font-bold">接受摸 {view.pendingDraw} 张</button>
              <button onClick={() => act('game:challenge', { challenge: true })}
                className="flex-1 bg-gradient-to-b from-red-500 to-red-600 text-white py-3 rounded-2xl font-black shadow-lg">质疑！</button>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {needSwap && (
        <div className="absolute top-16 inset-x-0 text-center z-30 pointer-events-none">
          <div className="inline-flex items-center gap-2 bg-amber-400 text-black text-sm font-black px-4 py-2 rounded-full shadow-lg">
            <Hand size={15} /> 打出 7！点选一名玩家换手牌
          </div>
        </div>
      )}

      {/* 计分板 */}
      <AnimatePresence>
        {showScore && (
          <Modal onClose={() => setShowScore(false)}>
            <div className="text-white font-black mb-3 flex items-center gap-2"><Trophy size={16} className="text-amber-300" />比分</div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {[...view.seats].filter(s => s.cardCount >= 0)
                .sort((a, b) => (view.scores[b.key] ?? 0) - (view.scores[a.key] ?? 0))
                .map((s, rank) => (
                  <div key={s.index} className="flex justify-between items-center text-sm bg-white/8 rounded-lg px-3 py-2">
                    <span className="text-white/85 flex items-center gap-1.5">
                      {rank === 0 && <Crown size={13} className="text-amber-300" />}
                      {s.name}{s.isBot ? ' · AI' : ''}
                    </span>
                    <span className="font-black text-amber-300">{view.scores[s.key] ?? 0}</span>
                  </div>
                ))}
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* 轮/局结束 */}
      {/* 首局新手指引（只看一次） */}
      {showTut && !me?.isSpectator && view.phase === 'play' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="absolute left-1/2 top-[58%] -translate-x-1/2 z-40 glass rounded-2xl px-4 py-3 w-[280px] text-left">
          <div className="text-white font-black text-sm mb-1.5">新手速成</div>
          <div className="text-white/75 text-[12px] leading-5">
            · 点<b className="text-amber-300">发亮</b>的牌打出（或拖到牌堆上）<br />
            · 没牌出就点左侧牌堆摸一张<br />
            · 剩最后一张前记得点 <b className="text-red-400">UNO!</b>
          </div>
          <button onClick={() => { localStorage.setItem('uno-tut', '1'); setShowTut(false); }}
            className="mt-2 w-full bg-amber-400 text-black font-black text-xs py-1.5 rounded-xl">知道了</button>
        </motion.div>
      )}

      <AnimatePresence>
        {(view.phase === 'round_over' || view.phase === 'match_over') && (
          <Modal>
            <Confetti />
            <div className="text-center">
              <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 14 }}
                className="mb-2 flex justify-center"><Trophy size={44} className="text-amber-300" /></motion.div>
              <div className="text-white font-black text-xl mb-1">
                {view.phase === 'match_over' ? '本局结束' : `第 ${view.round} 轮结束`}
              </div>
              <div className="space-y-1 mb-5 mt-3">
                {[...view.seats].filter(s => s.cardCount >= 0)
                  .sort((a, b) => (a.outRank ?? 99) - (b.outRank ?? 99) || (view.scores[b.key] ?? 0) - (view.scores[a.key] ?? 0))
                  .map((s, i) => (
                    <div key={s.index}
                      className={`flex items-center justify-between text-sm px-2 py-1 rounded-xl
                        ${i === 0 ? 'bg-amber-400/15 text-amber-200 font-black ring-1 ring-amber-300/40' : 'text-white/80'}`}>
                      <span className="flex items-center gap-1.5">
                        <Avatar name={s.name} isBot={s.isBot} size={18} />
                        {i === 0 && <Crown size={12} className="text-amber-300" />}
                        {i === 1 ? '第2 ' : i === 2 ? '第3 ' : i > 2 ? `第${i + 1} ` : ''}{s.name}
                      </span>
                      <span className="text-amber-300 font-bold">{view.scores[s.key] ?? 0} 分</span>
                    </div>
                  ))}
              </div>
              {view.phase === 'round_over' ? (
                <button onClick={() => act('game:nextRound')} className="w-full bg-gradient-to-b from-amber-300 to-amber-500 text-black font-black py-3 rounded-2xl shadow-lg">下一轮</button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => socket.emit('game:rematch', (r: { ok: boolean; error?: string }) => { if (!r?.ok) useStore.getState().toast(r?.error ?? '无法再来一局'); })}
                    className="flex-1 bg-gradient-to-b from-amber-300 to-amber-500 text-black font-black py-3 rounded-2xl shadow-lg">再来一局</button>
                  <button onClick={leaveRoom} className="flex-1 bg-white/15 text-white font-bold py-3 rounded-2xl">返回大厅</button>
                </div>
              )}
            </div>
          </Modal>
        )}
      </AnimatePresence>
      {debugMode && <DebugLayer />}
    </div>
  );
}

/** 布局调试层：给所有 UI 块画可拖拽/缩放虚线框，偏移写入 localStorage('uno-dbg')+window.__dbg */
function DebugLayer() {
  const IDS = ['piles', 'dir-ring', 'my-hand', 'my-pill', 'hint-pill', 'btn-row',
    ...Array.from({ length: 7 }, (_, i) => `opp-${i}`)];
  const [, force] = useState(0);
  const [zoom, setZoom] = useState(() => parseFloat(localStorage.getItem('uno-uiscale') ?? '1'));
  const ov: Record<string, { dx: number; dy: number; s: number }> =
    (window as unknown as { __dbg: Record<string, { dx: number; dy: number; s: number }> }).__dbg
    ?? JSON.parse(localStorage.getItem('uno-dbg') ?? '{}');

  const save = (id: string, dx: number, dy: number, s: number) => {
    ov[id] = { dx, dy, s };
    localStorage.setItem('uno-dbg', JSON.stringify(ov));
    (window as unknown as { __dbg: unknown }).__dbg = ov;
    force(x => x + 1);
  };

  const drag = (e: React.PointerEvent, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    const cur = ov[id] ?? { dx: 0, dy: 0, s: 1 };
    const x0 = e.clientX - cur.dx, y0 = e.clientY - cur.dy;
    const mv = (ev: PointerEvent) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      el.style.translate = `${dx}px ${dy}px`;
      save(id, dx, dy, cur.s);
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  const resize = (e: React.PointerEvent, id: string) => {
    e.preventDefault(); e.stopPropagation();
    const el = document.getElementById(id);
    if (!el) return;
    const cur = ov[id] ?? { dx: 0, dy: 0, s: 1 };
    const s0 = cur.s, x0 = e.clientX;
    const mv = (ev: PointerEvent) => {
      const s = Math.max(0.3, Math.min(3, s0 + (ev.clientX - x0) / 200));
      el.style.scale = `${s}`;
      save(id, cur.dx, cur.dy, s);
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="fixed inset-0 z-[80] pointer-events-none">
      {IDS.map(id => {
        const el = document.getElementById(id);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const o = ov[id];
        return (
          <div key={id} className="absolute pointer-events-auto cursor-move border-2 border-dashed border-emerald-400/90 rounded-lg"
            style={{ left: r.left, top: r.top, width: r.width, height: r.height, touchAction: 'none' }}
            onPointerDown={e => drag(e, id)}>
            <span className="absolute -top-5 left-0 text-[9px] font-mono text-emerald-300 bg-black/70 px-1 rounded whitespace-nowrap">
              {id}{o ? ` (${Math.round(o.dx)},${Math.round(o.dy)} ×${o.s.toFixed(2)})` : ''}
            </span>
            <span className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-emerald-400 rounded-sm cursor-nwse-resize"
              style={{ touchAction: 'none' }} onPointerDown={e => resize(e, id)} />
          </div>
        );
      })}
      <button className="absolute top-14 left-3 pointer-events-auto bg-red-500/90 text-white text-[10px] font-bold px-2 py-1 rounded-lg"
        onClick={() => { localStorage.removeItem('uno-dbg'); (window as unknown as { __dbg: unknown }).__dbg = {}; location.reload(); }}>
        重置布局
      </button>
      {/* UI 缩放滑条 */}
      <div className="absolute top-14 right-3 pointer-events-auto glass rounded-xl px-2.5 py-1.5 flex items-center gap-2">
        <span className="text-[9px] text-white/70 font-mono w-11">缩放 {Math.round(zoom * 100)}%</span>
        <input type="range" min={0.5} max={1.5} step={0.05} value={zoom}
          className="w-24 accent-emerald-400"
          onChange={e => {
            const z = Number(e.target.value);
            setZoom(z);
            localStorage.setItem('uno-uiscale', String(z));
            const root = document.getElementById('root');
            if (root) root.style.zoom = String(z * autoZVal);
          }} />
      </div>
    </div>
  );
}

function OpponentSeat({ o, pos, isCurrent, remainPct, needSwap, onSwap, canCatch, onCatch, chatBubble, isOwner, offline, outRank, scale = 1, dbgId }: {
  o: { index: number; name: string; isBot: boolean; cardCount: number; uno: boolean; eliminated: boolean; outRank?: number };
  pos: [number, number]; isCurrent: boolean; remainPct: number; isOwner?: boolean; offline?: boolean;
  needSwap: boolean; onSwap(): void; canCatch: boolean; onCatch(): void;
  chatBubble?: { kind: string; value: string }; outRank?: number; scale?: number; dbgId?: string;
}) {
  const R = 27;
  const C = 2 * Math.PI * R;
  const fanN = Math.min(o.cardCount, 8);
  return (
    <div id={dbgId} className="absolute z-10" style={{ left: `${pos[0]}%`, top: `${pos[1]}%`, transform: `translate(-50%, -50%) scale(${scale})` }}>
      <motion.div layout onClick={() => needSwap && onSwap()}
        className={`relative flex flex-col items-center ${needSwap ? 'cursor-pointer' : ''}`}>
        {/* 名字 + 牌数 */}
        <div className={`mb-0.5 text-[11px] font-bold flex items-center gap-1 px-2.5 py-0.5 rounded-full glass whitespace-nowrap
          ${isCurrent ? 'text-amber-200 border-amber-300/40' : 'text-white/80'}`}>
          {isOwner && <Crown size={10} className="text-amber-300" />}
          {o.name}
          <span className="ml-0.5 min-w-4 h-4 px-1 rounded-full bg-white/15 flex items-center justify-center text-[10px] font-black text-white">
            {o.cardCount}
          </span>
        </div>
        {/* 倒计时环 + 头像 */}
        <div className={`relative ${isCurrent ? 'seat-active' : ''}`}>
          <svg width="64" height="64" className={isCurrent ? '' : 'opacity-0'} style={{ transition: 'opacity .2s' }}>
            <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(255,201,61,.25)" strokeWidth="3.5" />
            <circle cx="32" cy="32" r={R} fill="none" stroke="#ffc93d" strokeWidth="3.5" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - remainPct)}
              transform="rotate(-90 32 32)" style={{ transition: 'stroke-dashoffset .3s linear' }} />
          </svg>
          <div className={`absolute inset-0 flex items-center justify-center ${offline ? 'opacity-45 grayscale' : ''}`}>
            <Avatar name={o.name} isBot={o.isBot} size={44} ring={isCurrent} />
          </div>
          {outRank && (
            <motion.div initial={{ scale: 0, rotate: -12 }} animate={{ scale: 1, rotate: 0 }}
              className="absolute -top-2 -left-3 bg-gradient-to-b from-amber-300 to-amber-500 text-black text-[9px] font-black px-1.5 py-0.5 rounded-full shadow border border-amber-200 z-20">
              第{outRank}名
            </motion.div>
          )}
          {offline && (
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-slate-700/90 text-white/90 text-[8px] font-bold px-1.5 py-0.5 rounded-full z-20">离线</div>
          )}
          {o.eliminated && (
            <div className="absolute inset-0 rounded-2xl bg-black/60 flex items-center justify-center text-[9px] text-white/60 font-bold">淘汰</div>
          )}
          {o.uno && (
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
              className="absolute -top-1.5 -right-2.5 bg-red-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full shadow border border-red-300">UNO</motion.div>
          )}
        </div>
        {/* 牌背扇（头像下方） */}
        <div className="relative h-10 mt-0.5 flex items-start justify-center" style={{ width: 84 }}>
          {Array.from({ length: fanN }, (_, i) => {
            const r = (i - (fanN - 1) / 2) * 13;
            return (
              <div key={i} className="absolute top-0"
                style={{ transform: `rotate(${r}deg) translateY(${Math.abs(r) * 0.06}px)`, transformOrigin: '50% 135%' }}>
                <MiniCardBack w={24} />
              </div>
            );
          })}
        </div>
        {/* 抓 UNO */}
        {canCatch && (
          <motion.button initial={{ scale: 0, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} whileTap={{ scale: 0.85 }}
            onClick={(e) => { e.stopPropagation(); onCatch(); }}
            className="absolute -bottom-5 bg-gradient-to-b from-orange-400 to-orange-600 text-white text-[10px] font-black px-3 py-1 rounded-full shadow-lg border border-orange-300 z-20 uno-glow">
            抓!
          </motion.button>
        )}
        {/* 聊天泡泡 */}
        <AnimatePresence>
          {chatBubble && (
            <motion.div key={`${chatBubble.value}-${o.index}`}
              initial={{ opacity: 0, y: 6, scale: 0.8 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}
              className="absolute -top-10 left-1/2 -translate-x-1/2 bg-white text-slate-800 rounded-2xl px-2.5 py-1 shadow-lg whitespace-nowrap z-30"
              style={{ fontSize: chatBubble.kind === 'emoji' ? 20 : 12 }}>
              {chatBubble.value}
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white rotate-45" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

/** 结算彩带：彩色方块洒落 */
function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 40 }, (_, i) => ({
    x: (i * 61) % 100,
    delay: (i * 37) % 60 / 100,
    dur: 1.4 + ((i * 13) % 40) / 40,
    color: COLOR_HEX[COLORS[i % 4]],
    size: 5 + (i % 3) * 3,
    rot: (i * 53) % 360,
  })), []);
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-3xl">
      {pieces.map((p, i) => (
        <motion.div key={i} className="absolute rounded-[2px]"
          style={{ left: `${p.x}%`, width: p.size, height: p.size * 0.6, background: p.color }}
          initial={{ top: '-4%', rotate: p.rot, opacity: 1 }}
          animate={{ top: '108%', rotate: p.rot + 340 + i * 17, opacity: [1, 1, .6] }}
          transition={{ duration: p.dur, delay: p.delay, ease: 'easeIn' }} />
      ))}
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-6"
      onClick={onClose}>
      <motion.div initial={{ scale: 0.85, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="glass rounded-3xl p-5 w-full max-w-xs shadow-2xl relative overflow-hidden">
        {children}
      </motion.div>
    </motion.div>
  );
}
