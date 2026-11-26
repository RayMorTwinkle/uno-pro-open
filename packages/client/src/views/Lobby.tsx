import { useState } from 'react';
import { ArrowUpRight, Plus, Radio, Trophy } from 'lucide-react';
import { GAME_DEFS } from '@uno-pro/shared';
import { useStore } from '../store';
import { request } from '../socket';
import StatsPanel from '../components/StatsPanel';
import { CardBack } from '../components/Card';

export default function Lobby() {
  const { connected, identity, lobby, toast } = useStore();
  const [name, setName] = useState(localStorage.getItem('uno-name') || '牌友');
  const [code, setCode] = useState(new URLSearchParams(location.search).get('join') || '');
  const [gameId, setGameId] = useState('uno');
  const [showStats, setStats] = useState(false);
  const [pending, setPending] = useState(false);
  async function enter(event: 'room:create' | 'room:join', roomCode = code, spectate = false) {
    if (pending || !connected) return;
    const display = name.trim() || '牌友';
    localStorage.setItem('uno-name', display);
    setPending(true);
    const result = await request(event, { name: display, code: roomCode.trim().toUpperCase(), spectate, settings: { gameId } });
    setPending(false);
    if (!result.ok) toast(result.error || '进入房间失败');
  }
  const canEnter = connected && !pending;
  return <main className="felt min-h-full px-5 py-8 sm:py-14">
    <div className="max-w-2xl mx-auto">
      <header className="flex justify-between items-center mb-10">
        <div className="flex items-center gap-2 text-amber-300 text-sm font-bold"><Radio size={17}/>{connected ? '本地牌桌已连接' : '正在连接牌桌…'}</div>
        <button className="glass rounded-xl px-3 py-2 flex gap-2 items-center" disabled={!identity} onClick={() => setStats(true)}><Trophy size={15}/> 战绩</button>
      </header>
      <section className="relative overflow-hidden pb-5 mb-6 border-b border-white/15">
        <h1 className="relative z-10 text-5xl sm:text-7xl font-black tracking-tighter text-amber-300">UNO-PRO</h1>
        <p className="relative z-10 text-lg mt-3 text-white/80">开一桌，等朋友出牌。</p>
        <div aria-hidden="true" className="absolute -top-2 right-5 rotate-[18deg] opacity-70"><CardBack w={76}/></div>
      </section>
      <label className="block text-white/65 text-sm mb-2" htmlFor="nickname">你的昵称</label>
      <input id="nickname" className="glass rounded-xl w-full px-4 py-3 mb-5" value={name} maxLength={20} onChange={e => setName(e.target.value)} />
      <div className="flex gap-2 mb-5">
        <label className="sr-only" htmlFor="game">选择游戏</label>
        <select id="game" className="glass rounded-xl px-3" value={gameId} onChange={e => setGameId(e.target.value)}>
          {GAME_DEFS.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <button className="flex-1 bg-amber-300 rounded-xl text-black py-3 font-black flex gap-2 items-center justify-center disabled:opacity-50" disabled={!canEnter} onClick={() => enter('room:create')}><Plus size={18}/> 创建房间</button>
      </div>
      <form className="flex gap-2 mb-8" onSubmit={e => { e.preventDefault(); enter('room:join'); }}>
        <input aria-label="房间码" placeholder="输入房间码" className="glass rounded-xl min-w-0 flex-1 px-4 py-3 uppercase" maxLength={5} value={code} onChange={e => setCode(e.target.value.toUpperCase())}/>
        <button disabled={!canEnter || code.trim().length !== 5} className="glass rounded-xl px-5 font-bold disabled:opacity-40">加入</button>
        <button type="button" disabled={!canEnter || code.trim().length !== 5} className="glass rounded-xl px-3 disabled:opacity-40" onClick={() => enter('room:join', code, true)}>观战</button>
      </form>
      <h2 className="text-xl font-bold mb-3">公开房间</h2>
      {lobby.length === 0 && <p className="text-white/60 text-sm">暂无等待中的房间。创建后可加人机，也可以把房间码发给同一网络的朋友。</p>}
      {lobby.map(r => <button key={r.code} disabled={!canEnter} onClick={() => enter('room:join', r.code)} className="glass rounded-xl p-4 w-full flex items-center gap-4 mb-2">
        <strong>{r.gameName}</strong><span className="font-mono text-white/65">{r.code}</span><span className="ml-auto">{r.players} / {r.maxPlayers}</span><ArrowUpRight size={16}/>
      </button>)}
      {showStats && identity && <StatsPanel playerKey={identity.key} name={name} onClose={() => setStats(false)} />}
    </div>
  </main>;
}
