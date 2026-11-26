import { randomBytes } from 'node:crypto';
import {
  createGame, gameDef,
  type BotDifficulty, type GameInstance, type HouseRules,
  type PlayerView, type RoomSettings, type SeatState,
  DEFAULT_ROOM_SETTINGS, DEFAULT_HOUSE_RULES,
} from '@uno-pro/shared';
import type { Guest as Identity, Scores as Db } from './scores.js';

type SettingsPatch = Omit<Partial<RoomSettings>, 'houseRules'> & { houseRules?: Partial<HouseRules> };

export interface Seat {
  key: string;
  name: string;
  isBot: boolean;
  difficulty?: BotDifficulty;
  userId: number | null;
  connected: boolean;
  ready: boolean;
}

interface RoomEvents {
  /** 给指定 key 的玩家发其视角状态 */
  sendState(key: string, view: PlayerView | null): void;
  /** 房间内广播（房间列表/快照/聊天/事件） */
  broadcast(room: Room, event: string, payload: unknown): void;
  /** 房间销毁/大厅变化 */
  lobbyChanged(): void;
}

const BOT_NAMES = ['小U', '诺诺', '阿U', '优诺', '小诺', 'UU', '诺比', '卡酱'];

export class Room {
  code: string;
  ownerKey: string;
  settings: RoomSettings;
  seats: (Seat | null)[];
  spectators = new Map<string, string>(); // key -> name
  status: 'waiting' | 'playing' | 'finished' = 'waiting';
  game: GameInstance | null = null;
  createdAt = Date.now();
  chatSeq = 0;

  private timers: NodeJS.Timeout[] = [];
  private db: Db;
  private ev: RoomEvents;
  private scoreRecorded = false;
  private lastScoredEvSeq = 0;

  constructor(code: string, ownerKey: string, settings: SettingsPatch, db: Db, ev: RoomEvents) {
    this.code = code;
    this.ownerKey = ownerKey;
    this.settings = {
      ...DEFAULT_ROOM_SETTINGS,
      ...settings,
      houseRules: { ...DEFAULT_HOUSE_RULES, ...(settings.houseRules ?? {}) },
    };
    this.settings.maxPlayers = Math.min(8, Math.max(2, this.settings.maxPlayers | 0));
    this.seats = Array.from({ length: 8 }, () => null);
    this.db = db;
    this.ev = ev;
  }

  // ---------- 座位 ----------
  seatIndexOf(key: string): number {
    return this.seats.findIndex(s => s?.key === key);
  }

  takeSeat(identity: Identity, index: number): { ok: boolean; error?: string } {
    if (this.seatIndexOf(identity.key) >= 0) return { ok: true }; // 已入座（重连）
    if (index < 0 || index >= this.settings.maxPlayers || this.seats[index]) return { ok: false, error: '座位不可用' };
    this.seats[index] = {
      key: identity.key, name: identity.name, isBot: false,
      userId: identity.userId, connected: true, ready: false,
    };
    this.spectators.delete(identity.key);
    return { ok: true };
  }

  leaveSeat(key: string): void {
    const i = this.seatIndexOf(key);
    if (i < 0) return;
    const seat = this.seats[i]!;
    if (this.status === 'playing' && this.game) {
      // 对局中离座 → 换成 normal bot 顶位
      this.seats[i] = { ...seat, isBot: true, difficulty: 'normal', connected: false, name: seat.name + '·AI' };
    } else {
      this.seats[i] = null;
    }
    if (key === this.ownerKey) this.transferOwner();
  }

  addBot(difficulty: BotDifficulty = 'normal'): { ok: boolean; error?: string } {
    const idx = this.seats.findIndex((s, i) => !s && i < this.settings.maxPlayers);
    if (idx < 0) return { ok: false, error: '座位已满' };
    const used = new Set(this.seats.filter(Boolean).map(s => s!.name));
    const name = BOT_NAMES.find(n => !used.has(n)) ?? `AI${idx}`;
    this.seats[idx] = {
      key: `b:${this.code}:${idx}`, name: `${name}`, isBot: true,
      difficulty, userId: null, connected: true, ready: true,
    };
    return { ok: true };
  }

  removeSeat(index: number, byKey: string): { ok: boolean; error?: string } {
    if (byKey !== this.ownerKey) return { ok: false, error: '只有房主可以操作' };
    const s = this.seats[index];
    if (!s) return { ok: false };
    if (!s.isBot) return { ok: false, error: '不能踢真人（请其自行离开）' };
    this.seats[index] = null;
    return { ok: true };
  }

  setReady(key: string, ready: boolean) {
    const i = this.seatIndexOf(key);
    if (i >= 0) this.seats[i]!.ready = ready;
  }

  updateSettings(patch: SettingsPatch, byKey: string): { ok: boolean; error?: string } {
    if (byKey !== this.ownerKey) return { ok: false, error: '只有房主可以修改' };
    if (this.status !== 'waiting') return { ok: false, error: '对局中不能修改' };
    const hr: Partial<HouseRules> = patch.houseRules ?? {};
    if (patch.gameId !== undefined && !gameDef(patch.gameId)) return { ok: false, error: '未知游戏' };
    this.settings = {
      ...this.settings,
      ...patch,
      houseRules: { ...this.settings.houseRules, ...hr },
      maxPlayers: Math.min(8, Math.max(2, patch.maxPlayers ?? this.settings.maxPlayers)),
      targetScore: Math.max(0, Math.min(5000, patch.targetScore ?? this.settings.targetScore)),
      turnSeconds: Math.max(5, Math.min(120, patch.turnSeconds ?? this.settings.turnSeconds)),
    };
    // 收缩人数：清出超出范围的座位
    for (let i = this.settings.maxPlayers; i < 8; i++) this.seats[i] = null;
    if (patch.isPrivate !== undefined) this.ev.lobbyChanged();
    return { ok: true };
  }

  watch(identity: Identity) {
    if (!this.settings.allowSpectate) return { ok: false, error: '房间不允许观战' };
    if (this.seatIndexOf(identity.key) >= 0) return { ok: true };
    this.spectators.set(identity.key, identity.name);
    return { ok: true };
  }

  unwatch(key: string) { this.spectators.delete(key); }

  hasHumans(): boolean {
    return this.seats.some(s => s && !s.isBot && s.connected) || [...this.spectators.keys()].length > 0;
  }

  private transferOwner() {
    const next = this.seats.find(s => s && !s.isBot);
    this.ownerKey = next?.key ?? this.ownerKey;
  }

  // ---------- 对局 ----------
  start(byKey: string): { ok: boolean; error?: string } {
    if (byKey !== this.ownerKey) return { ok: false, error: '只有房主可以开始' };
    if (this.status === 'playing') return { ok: false, error: '已在游戏中' };
    const seated = this.seats.filter(Boolean) as Seat[];
    if (seated.length < 2) return { ok: false, error: '至少需要 2 名玩家' };
    let game: GameInstance;
    try {
      game = createGame(
        this.settings.gameId,
        seated.map((s) => ({ seatIndex: this.seats.indexOf(s), key: s.key, name: s.name, isBot: s.isBot, difficulty: s.difficulty })),
        this.settings,
      );
    } catch {
      return { ok: false, error: '该游戏暂未开放' };
    }
    this.game = game;
    this.status = 'playing';
    this.scoreRecorded = false;
    this.lastScoredEvSeq = 0;
    game.startRound();
    this.afterAction();
    return { ok: true };
  }

  nextRound(byKey: string): { ok: boolean; error?: string } {
    if (!this.game || this.game.phase !== 'round_over') return { ok: false, error: '当前不能开下一轮' };
    this.game.startRound();
    this.afterAction();
    return { ok: true };
  }

  /** 整局结束后回到房间等待状态（不发送 game:state，客户端靠 room:snapshot 切回房间页） */
  rematch(byKey: string): { ok: boolean; error?: string } {
    if (this.status !== 'finished') return { ok: false, error: '对局未结束' };
    if (this.seatIndexOf(byKey) < 0) return { ok: false, error: '你不在座位上' };
    this.game = null;
    this.status = 'waiting';
    this.scoreRecorded = false;
    for (const s of this.seats) if (s && !s.isBot) s.ready = false;
    this.ev.broadcast(this, 'room:snapshot', this.snapshot());
    return { ok: true };
  }

  /** 任何动作后调用：广播 + 调度 bot/计时器 + 记录比赛 */
  afterAction() {
    const g = this.game;
    if (!g) return;
    this.clearTurnTimer();

    // 记录轮次得分到累计分（每个 round_end 事件只记一次）
    const roundEv = [...g.events].reverse().find(e => e.type === 'round_end');
    if (roundEv && roundEv.seq > this.lastScoredEvSeq && (g.phase === 'round_over' || g.phase === 'match_over')) {
      this.lastScoredEvSeq = roundEv.seq;
      const seat = this.seats[roundEv.seat];
      if (seat) {
        g.addScore(seat.key, (roundEv.detail?.points as number) ?? 0);
        if (!seat.isBot) this.db.recordRoundWin(seat.key);
      }
    }

    if (g.phase === 'match_over') {
      this.finishMatch();
    }

    this.broadcastState();

    // 调度：deadline 兜底计时 + bot 思考机会
    const sched = g.schedule();
    if (sched.deadline) {
      const wait = Math.max(300, sched.deadline.at - Date.now());
      this.timers.push(setTimeout(() => this.safeAction(() => { g.timeout(); return { ok: true }; }), wait));
    }
    for (const idx of sched.thinkSeats) {
      const seat = this.seats[idx];
      if (seat && (seat.isBot || !seat.connected)) {
        const delay = (seat.difficulty === 'novice' ? 900 + Math.random() * 1200 : 700 + Math.random() * 1000) + 150 * sched.thinkSeats.indexOf(idx);
        this.timers.push(setTimeout(() => {
          if (this.game) this.runBot(this.game, idx, seat);
        }, delay));
      }
    }
  }

  private runBot(g: GameInstance, seatIndex: number, seat: Seat) {
    const action = g.decideBot(seatIndex, seat.difficulty ?? 'normal');
    if (!action) return;
    this.safeAction(() => g.apply(seatIndex, action));
  }

  private safeAction(fn: () => { ok: boolean }) {
    try { fn(); } catch { /* ignore */ }
    this.afterAction();
  }

  private clearTurnTimer() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private finishMatch() {
    if (this.scoreRecorded || !this.game) return;
    this.scoreRecorded = true;
    this.status = 'finished';
    const g = this.game;
    const winnerEv = [...g.events].reverse().find(e => e.type === 'match_end');
    const winnerKey = winnerEv?.detail?.winner as string | undefined;
    const players = this.seats.filter(Boolean) as Seat[];
    for (const s of players) {
      if (!s.isBot) {
        this.db.recordMatch(s.key, s.name, s.key === winnerKey, g.scores[s.key] ?? 0, players.length);
      }
    }
    this.clearTurnTimer();
  }

  // ---------- 玩家动作入口 ----------
  playerAction(key: string, fn: (g: GameInstance, seat: number) => { ok: boolean; error?: string }) {
    const g = this.game;
    if (!g) return { ok: false, error: '对局未开始' };
    const seat = this.seatIndexOf(key);
    if (seat < 0) return { ok: false, error: '你不在座位上' };
    const r = fn(g, seat);
    if (r.ok) this.afterAction();
    return r;
  }

  markConnected(key: string, connected: boolean) {
    const i = this.seatIndexOf(key);
    if (i >= 0 && this.seats[i]) {
      this.seats[i]!.connected = connected;
      if (this.status === 'playing') this.afterAction();
    }
  }

  // ---------- 视图 ----------
  viewFor(key: string): PlayerView | null {
    const g = this.game;
    const seatIdx = this.seatIndexOf(key);
    const isSpectator = seatIdx < 0;
    if (!g) return null;
    const gv = g.gameView(seatIdx);
    const counts = (gv.cardCounts ?? {}) as Record<number, number>;
    const seatExtras = (gv.seatExtras ?? {}) as Record<number, Record<string, unknown>>;
    return {
      code: this.code,
      game: this.settings.gameId,
      status: this.status,
      seats: this.seats.slice(0, this.settings.maxPlayers).map((st, i) => ({
        index: i,
        key: st?.key ?? '',
        name: st?.name ?? '',
        isBot: st?.isBot ?? false,
        cardCount: st ? (counts[i] ?? 0) : -1,
        ...(seatExtras[i] ?? {}),
      })),
      me: { seatIndex: seatIdx, hand: (gv.meHand as PlayerView['me']['hand']) ?? [], isSpectator },
      ...gv,
      cardCounts: undefined,
      seatExtras: undefined,
      meHand: undefined,
      turnSeconds: this.settings.turnSeconds,
      scores: g.scores,
      round: g.round,
      targetScore: this.settings.targetScore,
    } as unknown as PlayerView;
  }

  snapshot() {
    return {
      code: this.code,
      ownerKey: this.ownerKey,
      status: this.status,
      seats: this.seats.slice(0, this.settings.maxPlayers).map((s, i) => (
        s ? { index: i, key: s.key, name: s.name, isBot: s.isBot, difficulty: s.difficulty, ready: s.ready, connected: s.connected } : { index: i, empty: true }
      )),
      settings: this.settings,
      spectators: [...this.spectators.values()],
      round: this.game?.round ?? 0,
      scores: this.game?.scores ?? {},
      createdAt: this.createdAt,
    };
  }

  broadcastState() {
    const keys = new Set<string>();
    for (const s of this.seats) if (s && !s.isBot) keys.add(s.key);
    for (const k of this.spectators.keys()) keys.add(k);
    if (this.game) for (const k of keys) this.ev.sendState(k, this.viewFor(k));
    this.ev.broadcast(this, 'room:snapshot', this.snapshot());
  }

  destroy() {
    this.clearTurnTimer();
  }
}

// ---------- 房间管理 ----------
export class RoomManager {
  rooms = new Map<string, Room>();
  private db: Db;
  private ev: RoomEvents;

  constructor(db: Db, ev: RoomEvents) {
    this.db = db;
    this.ev = ev;
  }

  create(owner: Identity, settings: SettingsPatch): Room {
    let code = '';
    do { code = randomBytes(3).toString('hex').toUpperCase().slice(0, 5); } while (this.rooms.has(code));
    const room = new Room(code, owner.key, settings, this.db, this.ev);
    this.rooms.set(code, room);
    this.ev.lobbyChanged();
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  findByPlayer(key: string): Room | undefined {
    for (const r of this.rooms.values()) {
      if (r.seats.some(s => s?.key === key && !s.isBot) || r.spectators.has(key)) return r;
    }
    return undefined;
  }

  remove(code: string) {
    const r = this.rooms.get(code);
    if (r) { r.destroy(); this.rooms.delete(code); this.ev.lobbyChanged(); }
  }

  listPublic() {
    return [...this.rooms.values()]
      .filter(r => r.status === 'waiting' && r.hasHumans() && !r.settings.isPrivate)
      .map(r => ({
        code: r.code,
        gameId: r.settings.gameId,
        gameName: gameDef(r.settings.gameId)?.name ?? r.settings.gameId,
        players: r.seats.filter(Boolean).length,
        maxPlayers: r.settings.maxPlayers,
        targetScore: r.settings.targetScore,
      }));
  }

  /** 每 60s 清扫无人的房间 */
  sweep() {
    for (const [code, r] of this.rooms) {
      if (!r.hasHumans()) this.remove(code);
    }
  }
}
