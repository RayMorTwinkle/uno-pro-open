import type { SeatPlayer, GameAction, ActionResult, EventLite } from '../types.js';
import type { RoomSettings } from '../../types.js';
import { botSketch } from './sketch.js';

export const WORDS = [
  '大象', '熊猫', '长颈鹿', '袋鼠', '章鱼', '螃蟹', '蜗牛', '恐龙', '猫头鹰', '鲨鱼',
  '火锅', '奶茶', '披萨', '寿司', '月饼', '糖葫芦', '爆米花', '冰淇淋', '包子', '西瓜',
  '火箭', '飞机', '自行车', '潜水艇', '热气球', '摩天轮', '过山车', '蹦极', '雨伞', '雪人',
  '弹吉他', '打篮球', '游泳', '睡觉', '刷牙', '钓鱼', '放风筝', '拔河', '瑜伽', '打游戏',
  '孙悟空', '蜘蛛侠', '奥特曼', '白雪公主', '僵尸', '吸血鬼', '圣诞老人', '财神', '外星人', '美人鱼',
  '长城', '金字塔', '自由女神', '比萨斜塔', '埃菲尔铁塔', '火山', '彩虹', '闪电', '龙卷风', '流星雨',
  '洗衣机', '电吹风', '微波炉', '钢琴', '灯笼', '算盘', '望远镜', '放大镜', '听诊器', '毛笔',
];
// 猜错时的近似干扰词（给 bot 用）
export const NEAR_MISS = ['不知道', '这是啥', '抽象画', '再来一笔', '看不懂啊', '是动物吗', '是吃的吗', '像个人', '好难啊'];

export interface Stroke { pts: number[]; color: string; w: number }
export interface GuessMsg { seat: number; text: string; ok: boolean }

export interface DGState {
  drawerIdx: number;          // seats 数组里的画手下标
  drawer: number;             // 画手 seatIndex
  wordChoices: string[];
  word: string | null;
  strokes: Stroke[];
  guesses: GuessMsg[];
  guessed: number[];          // 已猜中的座位（本轮）
  phase: 'pick_word' | 'draw' | 'reveal' | 'match_over';
  round: number;              // 第几轮（=画手轮换计数）
  totalRounds: number;
  deadlineAt: number;
  revealedWord: string | null;
  /** 画手完成进度奖励次数 */
  scoresLive: Record<number, number>;
  lastEvent: DGEvent | null;
  log: DGEvent[];
  botStrokeQueue: Stroke[];   // bot 画手预生成笔迹
  botGuessAt: Record<number, number>; // bot 猜手预定猜中时刻（ms after start）
  drawStartedAt: number;
}

export interface DGEvent extends EventLite {
  type: 'new_drawer' | 'pick' | 'stroke' | 'clear' | 'guess' | 'correct' | 'reveal' | 'match_end' | 'timeout';
}

const DRAW_MS = 75_000;
const PICK_MS = 15_000;
const REVEAL_MS = 5_000;

export class DrawGuessGame {
  seats: SeatPlayer[];
  state: DGState;
  private seq = 0;
  private rng: () => number;
  private scoresMap: Record<string, number> = {};
  private usedWords = new Set<string>();

  constructor(seats: SeatPlayer[], _settings: RoomSettings, rng: () => number = Math.random) {
    this.seats = seats;
    this.rng = rng;
    this.state = {
      drawerIdx: 0, drawer: seats[0].seatIndex,
      wordChoices: [], word: null, strokes: [], guesses: [], guessed: [],
      phase: 'pick_word', round: 0, totalRounds: seats.length,
      deadlineAt: Date.now() + PICK_MS, revealedWord: null,
      scoresLive: {}, lastEvent: null, log: [], botStrokeQueue: [], botGuessAt: {},
      drawStartedAt: 0,
    };
    for (const s of seats) { this.scoresMap[s.key] = 0; this.state.scoresLive[s.seatIndex] = 0; }
  }

  private emit(type: DGEvent['type'], seat: number, detail?: Record<string, unknown>) {
    const ev: DGEvent = { seq: ++this.seq, t: Date.now(), type, seat, detail };
    this.state.lastEvent = ev;
    this.state.log.push(ev);
  }

  private isBot(seat: number): boolean {
    return !!this.seats.find(p => p.seatIndex === seat)?.isBot;
  }

  private pick3(): string[] {
    const pool = WORDS.filter(w => !this.usedWords.has(w));
    const choices: string[] = [];
    while (choices.length < 3 && pool.length) {
      const w = pool[Math.floor(this.rng() * pool.length)];
      if (!choices.includes(w)) { choices.push(w); this.usedWords.add(w); }
    }
    return choices;
  }

  startRound(): void {
    const s = this.state;
    s.round += 1;
    s.drawer = this.seats[s.drawerIdx].seatIndex;
    s.wordChoices = this.pick3();
    s.word = null;
    s.strokes = [];
    s.guesses = [];
    s.guessed = [];
    s.revealedWord = null;
    s.phase = 'pick_word';
    s.deadlineAt = Date.now() + PICK_MS;
    s.botStrokeQueue = [];
    s.botGuessAt = {};
    this.emit('new_drawer', s.drawer, { round: s.round });
  }

  /** 画手选词（或超时自动选） */
  pickWord(seat: number, word: string): ActionResult {
    const s = this.state;
    if (s.phase !== 'pick_word') return { ok: false, error: '当前不能选词' };
    if (seat !== s.drawer) return { ok: false, error: '你是画手才能选' };
    if (!s.wordChoices.includes(word)) return { ok: false, error: '不在候选词中' };
    this.beginDraw(word);
    return { ok: true };
  }

  private beginDraw(word: string): void {
    const s = this.state;
    s.word = word;
    s.phase = 'draw';
    s.deadlineAt = Date.now() + DRAW_MS;
    s.drawStartedAt = Date.now();
    this.emit('pick', s.drawer, { len: word.length });
    // bot 画手：预生成抽象笔迹队列
    if (this.isBot(s.drawer)) s.botStrokeQueue = botSketch(word, this.rng);
    // bot 猜手：预定猜中时刻（越早越聪明），部分 bot 猜不中
    for (const p of this.seats) {
      if (p.isBot && p.seatIndex !== s.drawer) {
        const t = 8000 + this.rng() * 55000;
        s.botGuessAt[p.seatIndex] = t;
      }
    }
  }

  stroke(seat: number, stroke: Stroke): ActionResult {
    const s = this.state;
    if (s.phase !== 'draw') return { ok: false, error: '当前不能画' };
    if (seat !== s.drawer) return { ok: false, error: '只有画手能画' };
    if (!stroke?.pts?.length || stroke.pts.length < 2) return { ok: false, error: '空笔画' };
    if (stroke.pts.length > 800) stroke.pts = stroke.pts.slice(0, 800);
    if (s.strokes.length > 400) return { ok: false, error: '笔画太多了' };
    const st: Stroke = { pts: stroke.pts.map(v => Math.max(0, Math.min(1000, Math.round(v)))), color: String(stroke.color).slice(0, 16), w: Math.max(1, Math.min(20, +stroke.w || 3)) };
    s.strokes.push(st);
    this.emit('stroke', seat, { i: s.strokes.length - 1 });
    return { ok: true };
  }

  clear(seat: number): ActionResult {
    const s = this.state;
    if (s.phase !== 'draw' || seat !== s.drawer) return { ok: false, error: '不能清' };
    s.strokes = [];
    this.emit('clear', seat);
    return { ok: true };
  }

  guess(seat: number, text: string): ActionResult {
    const s = this.state;
    if (s.phase !== 'draw') return { ok: false, error: '当前不能猜' };
    if (seat === s.drawer) return { ok: false, error: '画手不能猜' };
    if (s.guessed.includes(seat)) return { ok: false, error: '已猜中' };
    const t = String(text ?? '').trim().slice(0, 30);
    if (!t) return { ok: false, error: '空答案' };
    const ok = s.word !== null && t.replace(/\s/g, '') === s.word;
    s.guesses.push({ seat, text: ok ? '猜中了！' : t, ok });
    if (s.guesses.length > 40) s.guesses.shift();
    this.emit('guess', seat, { ok, text: ok ? '猜中了！' : t });
    if (ok) {
      s.guessed.push(seat);
      const elapsed = Date.now() - s.drawStartedAt;
      const gPts = Math.round(80 + 120 * (1 - elapsed / DRAW_MS));
      const dPts = 30;
      const gk = this.seats.find(p => p.seatIndex === seat)?.key;
      const dk = this.seats.find(p => p.seatIndex === s.drawer)?.key;
      if (gk) { this.scoresMap[gk] += gPts; s.scoresLive[seat] += gPts; }
      if (dk) { this.scoresMap[dk] += dPts; s.scoresLive[s.drawer] += dPts; }
      this.emit('correct', seat, { pts: gPts });
      if (s.guessed.length === this.seats.length - 1) this.endDraw();
    }
    return { ok: true };
  }

  /** bot 内部调用：到点按计划画一笔/猜一次 */
  botTick(): void {
    const s = this.state;
    if (s.phase === 'pick_word') {
      // bot 画手 3-6s 内选定；到 deadline 兜底也自动选
      if (this.isBot(s.drawer) && (Date.now() - (s.deadlineAt - PICK_MS) > 3000 + this.rng() * 3000 || Date.now() >= s.deadlineAt))
        this.pickWord(s.drawer, s.wordChoices[Math.floor(this.rng() * s.wordChoices.length)] ?? WORDS[0]);
      else if (Date.now() >= s.deadlineAt) this.pickWord(s.drawer, s.wordChoices[0] ?? WORDS[0]);
      return;
    }
    if (s.phase === 'reveal') {
      if (Date.now() >= s.deadlineAt) this.nextRound();
      return;
    }
    if (s.phase !== 'draw') return;
    if (Date.now() >= s.deadlineAt) { this.endDraw(); return; }
    const elapsed = Date.now() - s.drawStartedAt;
    // bot 画手逐笔放出（~1.1 秒一笔，像真人作画节奏）
    if (this.isBot(s.drawer) && s.botStrokeQueue.length) {
      const want = Math.min(s.botStrokeQueue.length, Math.floor(elapsed / 1100));
      while (s.strokes.length < want && s.botStrokeQueue.length) {
        const st = s.botStrokeQueue.shift()!;
        s.strokes.push(st);
        this.emit('stroke', s.drawer, { i: s.strokes.length - 1 });
      }
    }
    // bot 猜手：到点猜（先丢两个近似错猜再命中）
    for (const p of this.seats) {
      if (!p.isBot || p.seatIndex === s.drawer || s.guessed.includes(p.seatIndex)) continue;
      const at = s.botGuessAt[p.seatIndex];
      if (at === undefined) continue;
      if (elapsed > at - 9000 && elapsed < at && this.rng() < 0.05) {
        this.guess(p.seatIndex, NEAR_MISS[Math.floor(this.rng() * NEAR_MISS.length)]);
      } else if (elapsed >= at) {
        delete s.botGuessAt[p.seatIndex];
        if (s.word) this.guess(p.seatIndex, s.word);
      }
    }
  }

  private endDraw(): void {
    const s = this.state;
    s.phase = 'reveal';
    s.revealedWord = s.word;
    s.deadlineAt = Date.now() + REVEAL_MS;
    this.emit('reveal', s.drawer, { word: s.word });
  }

  private nextRound(): void {
    const s = this.state;
    s.drawerIdx += 1;
    if (s.drawerIdx >= this.seats.length) {
      s.phase = 'match_over';
      const order = [...this.seats].sort((a, b) => (s.scoresLive[b.seatIndex] ?? 0) - (s.scoresLive[a.seatIndex] ?? 0));
      this.emit('match_end', -1, { winner: order[0]?.key, order: order.map(p => p.seatIndex) });
    } else {
      this.startRound();
    }
  }

  timeout(): void {
    const s = this.state;
    if (s.phase === 'pick_word') { this.emit('timeout', s.drawer); this.pickWord(s.drawer, s.wordChoices[Math.floor(this.rng() * s.wordChoices.length)] ?? WORDS[0]); }
    else if (s.phase === 'draw') this.endDraw();
    else if (s.phase === 'reveal') this.nextRound();
  }
}

