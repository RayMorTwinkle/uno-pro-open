import type { BotDifficulty } from '../types.js';
import type { ActionResult, SeatPlayer } from '../engine.js';
export type { ActionResult, SeatPlayer };

/** 已规划的游戏 id */
export type GameId = 'uno' | 'nimmt' | 'cheat' | 'drawguess' | 'galli';

/** 游戏元信息（大厅/房间选择器展示用） */
export interface GameDef {
  id: GameId;
  name: string;
  tagline: string;
  desc: string;
  minPlayers: number;
  maxPlayers: number;
  status: 'live' | 'soon';
}

/** 通用玩家动作：socket 'game:*' 事件映射为 { type, ...payload } 后交给引擎 */
export interface GameAction {
  type: string;
  [k: string]: unknown;
}

/** 事件日志最小约定（记分/结算/客户端爆闪都靠它） */
export interface EventLite {
  seq: number;
  t?: number;
  type: string;
  seat: number;
  cardIds?: number[];
  detail?: Record<string, unknown>;
}

/** 每步之后房间询问引擎：该谁动、何时兜底 */
export interface GameSched {
  /** 到期兜底（seat = 等待的责任人，null = 窗口期）；房间统一挂计时器调 timeout() */
  deadline?: { seat: number | null; at: number };
  /** 需要一次「思考机会」的座位 —— 房间对其中是 bot 的调度 decideBot→apply */
  thinkSeats: number[];
}

/** 每局游戏的运行时实例：房间对游戏的全部交互都走这个接口 */
export interface GameInstance {
  readonly gameId: GameId;
  /** 引擎自有阶段字符串（'play'|'challenge'|'round_over'|'match_over'|...） */
  readonly phase: string;
  readonly round: number;
  readonly scores: Record<string, number>;
  /** 事件日志（需含 round_end{seat,detail.points} / match_end{detail.winner} 约定） */
  readonly events: EventLite[];
  /** 通用动作入口 */
  apply(seat: number, action: GameAction): ActionResult;
  /** bot 决策：返回要 apply 的动作，null = 无事可做 */
  decideBot(seat: number, difficulty: BotDifficulty): GameAction | null;
  /** 当前等待谁/兜底时间 */
  schedule(): GameSched;
  /** deadline 到期兜底 */
  timeout(): void;
  /** 玩家视图中的游戏专有字段（房间拼 seats/me 信封）；seatIdx<0 = 观战 */
  gameView(seatIdx: number): Record<string, unknown>;
  /** 开新一轮（round_over → play） */
  startRound(): void;
  /** 轮次得分累计（房间在 round_end 事件时调） */
  addScore(key: string, points: number): void;
}

export interface GameFactory {
  (players: SeatPlayer[], settings: import('../types.js').RoomSettings): GameInstance;
}
