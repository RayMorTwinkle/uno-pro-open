// 每轮启动独立的内存战绩库与临时端口。LAN 模式由 UNO_TEST_LAN=1 显式启用。
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { networkInterfaces } from 'node:os';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { io } from 'socket.io-client';

function until(socket, event, accepts = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error('等待事件超时 ' + event));
    }, 5000);
    function onEvent(value) {
      if (!accepts(value)) return;
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(value);
    }
    socket.on(event, onEvent);
  });
}

test('本机房间、四档人机、十二项村规、旁观与断线返回', { timeout: 30000 }, async t => {
  const lan = process.env.UNO_TEST_LAN === '1';
  const child = spawn(process.execPath, ['--import', 'tsx', 'packages/server/src/index.ts'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, PORT: '0', HOST: lan ? '0.0.0.0' : '127.0.0.1', UNO_SCORE_FILE: ':memory:' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const ended = once(child, 'exit');
    child.kill();
    await ended;
  });
  let port;
  for await (const line of createInterface({ input: child.stdout })) {
    const match = /本机牌桌\s+http:\/\/localhost:(\d+)/.exec(line);
    if (match) { port = match[1]; break; }
  }
  assert.ok(port, '本地服务启动');
  const lanAddress = Object.values(networkInterfaces()).flat().find(info => info?.family === 'IPv4' && !info.internal)?.address;
  if (lan) assert.ok(lanAddress, '主机有局域网网卡');
  const host = lan ? lanAddress : '127.0.0.1';
  const base = `http://${host}:${port}`;
  assert.equal((await (await fetch(base + '/api/health')).json()).ok, true);
  const sockets = [];
  t.after(() => sockets.forEach(s => s.disconnect()));
  async function connect(guestId = randomBytes(24).toString('hex')) {
    const socket = io(base, { autoConnect: false, forceNew: true, reconnection: false, auth: { guestId } });
    sockets.push(socket);
    const ready = until(socket, 'guest:ready');
    socket.connect();
    await ready;
    return socket;
  }
  const hostId = randomBytes(24).toString('hex');
  const owner = await connect(hostId);
  const guest = await connect();
  const watcher = await connect();
  const request = (s, event, data = {}) => s.timeout(4000).emitWithAck(event, data);
  const room = await request(owner, 'room:create', { name: '东', settings: { gameId: 'uno' } });
  assert.match(room.code, /^[A-F0-9]{5}$/);
  assert.equal((await request(guest, 'room:join', { code: room.code, name: '南' })).ok, true);
  assert.equal((await request(watcher, 'room:join', { code: room.code, name: '观众', spectate: true })).ok, true);
  assert.equal((await request(guest, 'room:addBot', { difficulty: 'hard' })).ok, false);
  assert.equal((await request(owner, 'room:addBot', { difficulty: 'unknown' })).ok, false);
  for (const difficulty of ['novice', 'easy', 'normal', 'hard']) {
    const snap = until(owner, 'room:snapshot', r => r.seats.some(s => s.difficulty === difficulty));
    assert.equal((await request(owner, 'room:addBot', { difficulty })).ok, true);
    await snap;
  }
  const rules = {
    stackDrawTwo: true, stackDrawFour: true, crossStack: true, zeroRotateHands: true,
    sevenSwapHands: true, jumpIn: true, multiplePlaySameNumber: true, drawUntilPlayable: true,
    noChallenge: true, elimination: true, finishAll: false, unoPenalty: 4,
  };
  const settings = until(guest, 'room:snapshot', r => r.settings.houseRules.unoPenalty === 4);
  assert.equal((await request(owner, 'room:settings', { houseRules: rules })).ok, true);
  const snapshot = await settings;
  for (const [k, v] of Object.entries(rules)) assert.equal(snapshot.settings.houseRules[k], v);
  const views = Promise.all([owner, guest, watcher].map(s => until(s, 'game:state')));
  assert.equal((await request(owner, 'room:start')).ok, true);
  const [mine, theirs, watched] = await views;
  assert.ok(mine.me.hand.length > 0 && theirs.me.hand.length > 0);
  assert.equal(mine.me.hand.some(c => theirs.me.hand.some(other => other.id === c.id)), false);
  assert.equal(watched.me.hand.length, 0);
  assert.equal(watched.me.isSpectator, true);
  assert.equal((await request(watcher, 'game:draw')).ok, false);
  const resumed = until(owner, 'game:state', v => v.code === room.code);
  owner.disconnect();
  owner.connect();
  assert.equal((await resumed).me.seatIndex, mine.me.seatIndex);
  assert.equal((await request(owner, 'room:leave')).ok, true);
  assert.equal((await request(guest, 'room:leave')).ok, true);
  assert.equal((await request(watcher, 'room:leave')).ok, true);

  for (const gameId of ['nimmt', 'cheat', 'drawguess', 'galli']) {
    assert.equal((await request(owner, 'room:create', { name: '东', settings: { gameId } })).ok, true);
    for (let i = 0; i < 2; i++) assert.equal((await request(owner, 'room:addBot', { difficulty: 'normal' })).ok, true);
    const dealt = until(owner, 'game:state', v => v.game === gameId);
    assert.equal((await request(owner, 'room:start')).ok, true);
    assert.equal((await dealt).me.isSpectator, false);
    assert.equal((await request(owner, 'room:leave')).ok, true);
  }
});
