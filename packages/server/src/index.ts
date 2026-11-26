import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import serveStatic from '@fastify/static';
import { Server } from 'socket.io';
import { DEFAULT_HOUSE_RULES, gameDef, type BotDifficulty, type GameAction, type RoomSettings } from '@uno-pro/shared';
import { RoomManager, type Room } from './room.js';
import { Scores, type Guest } from './scores.js';

const dbPath = process.env.UNO_SCORE_FILE || fileURLToPath(new URL('../../../.local/scores.sqlite', import.meta.url));
if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
const scores = new Scores(dbPath);
const app = Fastify();
const io = new Server(app.server, { maxHttpBufferSize: 128 * 1024 });
const rooms = new RoomManager(scores, {
  sendState: (key, view) => io.to(key).emit('game:state', view),
  broadcast: (room, event, payload) => io.to(room.code).emit(event, payload),
  lobbyChanged: () => io.emit('lobby:list', rooms.listPublic()),
});

function localHosts(): string[] {
  return Object.values(networkInterfaces()).flatMap(infos => (infos ?? [])
    .filter(info => info.family === 'IPv4' && !info.internal)
    .map(info => info.address));
}
app.get('/api/health', () => ({ ok: true }));
app.get('/api/lan', () => ({ hosts: localHosts() }));
app.get<{ Params: { key: string } }>('/api/profile/:key', req => scores.profile(req.params.key));
app.get('/api/leaderboard', () => scores.leaderboard());
await app.register(serveStatic, { root: fileURLToPath(new URL('../../client/dist/', import.meta.url)) });

const levels: BotDifficulty[] = ['novice', 'easy', 'normal', 'hard'];
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
type SettingsPatch = Omit<Partial<RoomSettings>, 'houseRules'> & { houseRules?: Partial<RoomSettings['houseRules']> };
function settings(value: unknown): SettingsPatch {
  const raw = object(value);
  const patch: SettingsPatch = {};
  if (typeof raw.gameId === 'string' && gameDef(raw.gameId)) patch.gameId = raw.gameId;
  if (typeof raw.isPrivate === 'boolean') patch.isPrivate = raw.isPrivate;
  if (typeof raw.allowSpectate === 'boolean') patch.allowSpectate = raw.allowSpectate;
  for (const [key, min, max] of [['maxPlayers', 2, 8], ['targetScore', 0, 5000], ['turnSeconds', 5, 120]] as const) {
    if (typeof raw[key] === 'number' && Number.isInteger(raw[key])) patch[key] = Math.max(min, Math.min(max, raw[key]));
  }
  if (raw.houseRules) {
    const rules = Object.entries(object(raw.houseRules)).filter(([key, v]) =>
      Object.hasOwn(DEFAULT_HOUSE_RULES, key) && (key === 'unoPenalty' ? [2, 4, 6].includes(Number(v)) && typeof v === 'number' : typeof v === 'boolean'));
    patch.houseRules = Object.fromEntries(rules);
  }
  return patch;
}

io.on('connection', socket => {
  // 一个浏览器档案对应一个可重连的客座。公开座位标识与浏览器本地随机值分离。
  const guestId = socket.handshake.auth.guestId;
  if (typeof guestId !== 'string' || !/^[a-f0-9]{48}$/.test(guestId)) return socket.disconnect(true);
  const key = 'guest-' + createHash('sha256').update(guestId).digest('hex').slice(0, 32);
  const guest: Guest = { key, name: '访客', userId: null };
  const getRoom = () => socket.data.room as Room | undefined;
  const lobby = () => io.emit('lobby:list', rooms.listPublic());
  const bind = (room: Room) => {
    socket.data.room = room;
    socket.join(room.code);
    room.markConnected(key, true);
    room.broadcastState();
    lobby();
  };
  const leave = () => {
    const room = getRoom();
    if (!room) return;
    room.leaveSeat(key);
    room.unwatch(key);
    socket.leave(room.code);
    delete socket.data.room;
    room.broadcastState();
    if (!room.hasHumans()) rooms.remove(room.code);
    lobby();
  };

  // 另一个标签页使用同一档案时接管连接。
  for (const id of io.sockets.adapter.rooms.get(key) ?? []) io.sockets.sockets.get(id)?.disconnect(true);
  socket.join(key);
  socket.emit('guest:ready', { key });
  socket.emit('lobby:list', rooms.listPublic());
  const previous = rooms.findByPlayer(key);
  if (previous) bind(previous);

  type Result = { ok: boolean; error?: string; code?: string };
  type Handler = (payload: Record<string, unknown>) => Result;
  function on(event: string, operation: Handler) {
    socket.on(event, (...args) => {
      const ack = args.find(arg => typeof arg === 'function');
      let result: Result;
      try { result = operation(object(args[0])); }
      catch { result = { ok: false, error: '操作参数无效' }; }
      if (ack) ack(result);
      else if (!result.ok) socket.emit('error:msg', result);
    });
  }
  const seatedName = (name: unknown) => {
    guest.name = typeof name === 'string' && name.trim() ? name.trim().slice(0, 20) : '访客';
  };
  on('room:create', p => {
    if (getRoom()) return { ok: false, error: '请先离开当前房间' };
    seatedName(p.name);
    const room = rooms.create(guest, settings(p.settings));
    room.takeSeat(guest, 0);
    bind(room);
    return { ok: true, code: room.code };
  });
  on('room:join', p => {
    const room = typeof p.code === 'string' && rooms.get(p.code);
    if (!room) return { ok: false, error: '找不到这个房间' };
    if (getRoom() && getRoom() !== room) return { ok: false, error: '请先离开当前房间' };
    seatedName(p.name);
    const result = p.spectate || room.status !== 'waiting' ? room.watch(guest) :
      room.takeSeat(guest, room.seats.slice(0, room.settings.maxPlayers).findIndex(s => !s));
    if (result.ok) bind(room);
    return result;
  });
  on('room:leave', () => { leave(); return { ok: true }; });
  function inRoom(event: string, op: (room: Room, p: Record<string, unknown>) => Result) {
    on(event, p => {
      const room = getRoom();
      return room ? op(room, p) : { ok: false, error: '请先进入房间' };
    });
  }
  function configure(event: string, op: (r: Room, p: Record<string, unknown>) => Result) {
    inRoom(event, (r, p) => {
      if (r.ownerKey !== key || r.status !== 'waiting') return { ok: false, error: '仅房主可在准备阶段调整' };
      const result = op(r, p);
      if (result.ok) { r.broadcastState(); lobby(); }
      return result;
    });
  }
  configure('room:addBot', (r, p) => levels.includes(p.difficulty as BotDifficulty)
    ? r.addBot(p.difficulty as BotDifficulty) : { ok: false, error: '未知难度' });
  configure('room:removeBot', (r, p) => r.removeSeat(Number(p.index), key));
  configure('room:settings', (r, p) => {
    const patch = settings(p);
    if (patch.maxPlayers && r.seats.slice(patch.maxPlayers).some(Boolean))
      return { ok: false, error: '请先腾出超出人数上限的座位' };
    return r.updateSettings(patch, key);
  });
  configure('room:start', r => {
    const count = r.seats.filter(Boolean).length;
    const game = gameDef(r.settings.gameId)!;
    if (count < game.minPlayers || count > game.maxPlayers)
      return { ok: false, error: `本游戏需要 ${game.minPlayers} 至 ${game.maxPlayers} 人` };
    return r.start(key);
  });
  inRoom('game:nextRound', r => r.ownerKey === key ? r.nextRound(key) : { ok: false, error: '请等待房主开始' });
  inRoom('game:rematch', r => { const result = r.rematch(key); if (result.ok) lobby(); return result; });
  function apply(room: Room, action: GameAction) {
    return room.playerAction(key, (g, seat) => g.apply(seat, action));
  }
  for (const [event, type] of Object.entries({ play: 'play', draw: 'draw', pass: 'pass', uno: 'uno',
    catch: 'catch', color: 'choose_color', swap: 'swap_target', challenge: 'challenge' })) {
    inRoom('game:' + event, (r, p) => apply(r, { ...p, type }));
  }
  inRoom('game:action', (r, p) => typeof p.type === 'string' ? apply(r, { ...p, type: p.type }) : { ok: false });
  inRoom('chat', (r, p) => {
    if ((p.kind !== 'phrase' && p.kind !== 'emoji') || typeof p.value !== 'string') return { ok: false };
    io.to(r.code).emit('chat', { seq: ++r.chatSeq, t: Date.now(), from: key, seat: r.seatIndexOf(key), kind: p.kind, value: p.value.slice(0, 80) });
    return { ok: true };
  });
  socket.on('disconnect', () => {
    const r = getRoom();
    if (r) { r.markConnected(key, false); r.broadcastState(); lobby(); }
  });
});
setInterval(() => rooms.sweep(), 60_000).unref();
const port = Number(process.env.PORT ?? 3501);
const host = process.env.HOST || '0.0.0.0';
await app.listen({ host, port });
const bound = app.server.address();
const actualPort = typeof bound === 'object' && bound ? bound.port : port;
console.log(`本机牌桌  http://localhost:${actualPort}`);
if (host === '0.0.0.0') {
  for (const infos of Object.values(networkInterfaces())) for (const info of infos ?? []) {
    if (info.family === 'IPv4' && !info.internal) console.log(`局域网    http://${info.address}:${actualPort}`);
  }
}
