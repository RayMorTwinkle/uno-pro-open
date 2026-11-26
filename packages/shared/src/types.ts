// ---------- 卡牌 ----------
export type Color = 'red' | 'yellow' | 'green' | 'blue';
export const COLORS: Color[] = ['red', 'yellow', 'green', 'blue'];

export type CardKind = 'number' | 'skip' | 'reverse' | 'draw_two' | 'wild' | 'wild_draw_four';

export interface Card {
  /** 牌在整副牌中的唯一 id（0-107） */
  id: number;
  color: Color | null;
  kind: CardKind;
  /** 数字牌面值 */
  value?: number;
}

// ---------- 村规 ----------
export interface HouseRules {
  /** +2 可叠 +2 */
  stackDrawTwo: boolean;
  /** +4 可叠 +4 */
  stackDrawFour: boolean;
  /** +2 与 +4 互叠 */
  crossStack: boolean;
  /** 打出 0 时所有人按方向换手牌 */
  zeroRotateHands: boolean;
  /** 打出 7 时与指定玩家换手牌 */
  sevenSwapHands: boolean;
  /** 同牌抢出（相同颜色+面值可直接打出） */
  jumpIn: boolean;
  /** 同数字不同颜色可一次全出 */
  multiplePlaySameNumber: boolean;
  /** 无牌可出时一直摸到能出为止 */
  drawUntilPlayable: boolean;
  /** 摸到可出的牌必须打出（官方默认 false：可选择留下） */
  forcedPlayAfterDraw: boolean;
  /** UNO 罚摸张数 */
  unoPenalty: 2 | 4 | 6;
  /** 严格 UNO：只能恰好在剩 1 张时喊 */
  strictUnoCall: boolean;
  /** 自动喊 UNO（高级选项） */
  autoUno: boolean;
  /** 最后一张不能是功能牌(+2/+4) */
  noActionCardFinish: boolean;
  /** 最后一张不能是万能牌 */
  noWildFinish: boolean;
  /** 关闭 +4 质疑 */
  noChallenge: boolean;
  /** 末位淘汰：每轮结束手牌最多者淘汰 */
  elimination: boolean;
  /** 3 人及以上局：决出全部名次才结束（默认开） */
  finishAll: boolean;
  /** 简洁规则模式：忽略 +4 合法限制与质疑、无 UNO 罚摸 */
  simpleMode: boolean;
}

export const DEFAULT_HOUSE_RULES: HouseRules = {
  stackDrawTwo: false,
  stackDrawFour: false,
  crossStack: false,
  zeroRotateHands: false,
  sevenSwapHands: false,
  jumpIn: false,
  multiplePlaySameNumber: false,
  drawUntilPlayable: false,
  forcedPlayAfterDraw: false,
  unoPenalty: 2,
  strictUnoCall: false,
  autoUno: false,
  noActionCardFinish: false,
  noWildFinish: false,
  noChallenge: false,
  elimination: false,
  finishAll: true,
  simpleMode: false,
};

export const SIMPLE_MODE_RULES: Partial<HouseRules> = {
  simpleMode: true,
  noChallenge: true,
  autoUno: true,
};

// ---------- 房间 ----------
export type BotDifficulty = 'novice' | 'easy' | 'normal' | 'hard';

export interface RoomSettings {
  maxPlayers: number; // 2-8
  targetScore: number; // 0 = 单轮定胜负；>0 = 多轮先到该分数
  turnSeconds: number; // 回合限时
  allowSpectate: boolean;
  isPrivate: boolean; // 私密房间：不出现在公开大厅列表，仅邀请码进
  /** 本房间玩的游戏（注册表 GameId） */
  gameId: string;
  houseRules: HouseRules;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  maxPlayers: 8,
  targetScore: 0,
  turnSeconds: 30,
  allowSpectate: true,
  isPrivate: false,
  gameId: 'uno',
  houseRules: DEFAULT_HOUSE_RULES,
};

export type SeatState =
  | { kind: 'empty' }
  | { kind: 'human'; playerId: string; name: string; ready: boolean }
  | { kind: 'bot'; botId: string; name: string; difficulty: BotDifficulty };

export interface RoomSnapshot {
  code: string;
  ownerId: string | null;
  status: 'waiting' | 'playing' | 'finished';
  seats: SeatState[];
  settings: RoomSettings;
  round: number;
  scores: Record<string, number>; // playerKey -> 累计分
  createdAt: number;
}

// ---------- 对局状态（服务端权威） ----------
export interface HandState {
  seatIndex: number;
  cards: Card[]; // 服务端全量；客户端只见自己的
}

export type Direction = 1 | -1;

/** +4 质疑挂起状态 */
export interface PendingChallenge {
  /** 被质疑的出牌者 seatIndex */
  challengerSeat: number; // 发起质疑者
  playedBySeat: number;   // 出 +4 者
  deadline: number;
  /** 打出 +4 前的生效色；旧快照可能缺省。 */
  prevColor?: Color;
}

export interface PendingDraw {
  /** 累计待摸张数（叠 +2/+4 时） */
  count: number;
  /** 来源功能牌类型 */
  kind: 'draw_two' | 'wild_draw_four';
}

export interface GameState {
  /** 座位 -> 手牌 */
  hands: HandState[];
  deck: Card[];
  discard: Card[];
  /** 当前出牌者 seatIndex */
  current: number;
  direction: Direction;
  /** 当前生效颜色（万能牌指定后） */
  activeColor: Color;
  /** 待摸叠加 */
  pendingDraw: PendingDraw | null;
  /** 等待 +4 出牌者选色 or 被质疑窗口 */
  phase: 'play' | 'choose_color' | 'challenge' | 'swap_target' | 'round_over' | 'match_over';
  /** phase 为 challenge 时的挂起信息 */
  challenge: PendingChallenge | null;
  /** 已喊 UNO 的 seatIndex 集合 */
  unoCalled: number[];
  /** 本轮各 seat 剩牌被标记的时间（抓 UNO 窗口） */
  unoVulnerable: Record<number, number>;
  /** 本回合已摸牌（摸后只能出摸的牌） */
  drewThisTurn: Card | null;
  /** 回合开始时间戳（服务端） */
  turnStartedAt: number;
  round: number;
  /** 本局已淘汰 seats */
  eliminated: number[];
  /** 已出完牌的 seatIndex，按出完先后排名（finishAll 模式） */
  finishOrder: number[];
  /** 上一条可供客户端做动画的事件 */
  lastEvent: GameEvent | null;
  /** 完整事件日志（复盘） */
  log: GameEvent[];
}

export interface GameEvent {
  seq: number;
  t: number;
  type:
    | 'deal' | 'flip' | 'play' | 'multi_play' | 'draw' | 'skip' | 'reverse' | 'direction'
    | 'wild' | 'draw_penalty' | 'uno' | 'uno_caught' | 'challenge_win' | 'challenge_lose'
    | 'swap_hands' | 'rotate_hands' | 'round_end' | 'match_end' | 'eliminated' | 'turn_timeout'
    | 'jump_in' | 'player_out';
  seat: number;
  cardIds?: number[];
  detail?: Record<string, unknown>;
}

// ---------- 客户端视图（各玩家只见自己手牌） ----------
export interface PlayerView {
  code: string;
  /** 本局游戏 id */
  game: string;
  status: 'waiting' | 'playing' | 'finished';
  seats: { index: number; key: string; name: string; isBot: boolean; cardCount: number; uno: boolean; eliminated: boolean; outRank?: number }[];
  me: { seatIndex: number; hand: Card[]; isSpectator: boolean };
  discardTop: Card | null;
  /** 弃牌堆顶之下的最近几张（新→旧，用于堆叠视觉） */
  discardPrev: Card[];
  activeColor: Color;
  current: number;
  direction: Direction;
  pendingDraw: number;
  phase: GameState['phase'];
  drewThisTurn: Card | null;
  turnStartedAt: number;
  turnSeconds: number;
  scores: Record<string, number>;
  round: number;
  deckCount: number;
  challenge: PendingChallenge | null;
  targetScore: number;
  /** 最新游戏事件（客户端动画触发器） */
  lastEvent: GameEvent | null;
  /** UNO 脆弱窗口中的座位（可被抓） */
  unoVulnerable: number[];
  /** finishAll 模式下已出完的 seatIndex（按名次排序） */
  finishOrder: number[];
}
