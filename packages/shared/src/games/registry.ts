import type { GameDef, GameFactory, GameId } from './types.js';
import { createUnoGame } from './uno/runtime.js';
import { createNimmtGame } from './nimmt/runtime.js';
import { createCheatGame } from './cheat/runtime.js';
import { createDrawGuessGame } from './drawguess/runtime.js';
import { createGalliGame } from './galli/runtime.js';

/** 游戏目录：精挑细选的多人短局游戏，均支持机器人 */
export const GAME_DEFS: GameDef[] = [
  {
    id: 'uno',
    name: 'UNO',
    tagline: '经典配色出牌',
    desc: '打光手牌就赢，+4/反转/UNO 全村规',
    minPlayers: 2,
    maxPlayers: 8,
    status: 'live',
  },
  {
    id: 'nimmt',
    name: '牛头王',
    tagline: '同时暗选·翻牌爆笑',
    desc: '每人同时出一张牌塞进四行，牛头越吃越亏',
    minPlayers: 2,
    maxPlayers: 8,
    status: 'live',
  },
  {
    id: 'cheat',
    name: '吹牛',
    tagline: '扣牌喊数·信不信由你',
    desc: '暗扣出牌报假数，被抓包全收回',
    minPlayers: 2,
    maxPlayers: 6,
    status: 'live',
  },
  {
    id: 'drawguess',
    name: '你画我猜',
    tagline: '灵魂画手上线',
    desc: '一人画其他人抢答猜词',
    minPlayers: 3,
    maxPlayers: 8,
    status: 'live',
  },
  {
    id: 'galli',
    name: '铃儿响叮当',
    tagline: '凑满 5 个就抢拍',
    desc: '翻水果牌见 5 抢铃，拍错罚全场',
    minPlayers: 2,
    maxPlayers: 6,
    status: 'live',
  },
];

export function gameDef(id: string): GameDef | undefined {
  return GAME_DEFS.find(g => g.id === id);
}

const FACTORIES: Partial<Record<GameId, GameFactory>> = {
  uno: createUnoGame,
  nimmt: createNimmtGame,
  cheat: createCheatGame,
  drawguess: createDrawGuessGame,
  galli: createGalliGame,
};

export function createGame(id: string, ...args: Parameters<GameFactory>) {
  const f = FACTORIES[id as GameId];
  if (!f) throw new Error(`游戏 ${id} 未实现`);
  return f(...args);
}

export function gameImplemented(id: string): boolean {
  return id in FACTORIES;
}
