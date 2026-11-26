import { useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../store';
import { socket } from '../socket';
import type { HouseRules } from '@uno-pro/shared';
import { GAME_DEFS, gameDef } from '@uno-pro/shared';
import { ArrowLeft, Copy, Crown, ChevronDown, Play, UserPlus } from 'lucide-react';
import Avatar from '../components/Avatar';

const RULE_INFO: [keyof HouseRules, string][] = [
  ['stackDrawTwo', '+2 可叠加'],
  ['stackDrawFour', '+4 可叠加'],
  ['crossStack', '+2/+4 互叠'],
  ['zeroRotateHands', '0 轮转手牌'],
  ['sevenSwapHands', '7 指定换牌'],
  ['jumpIn', '同牌抢出'],
  ['multiplePlaySameNumber', '同数字全出'],
  ['drawUntilPlayable', '摸到能出为止'],
  ['noChallenge', '关闭+4质疑'],
  ['elimination', '末位淘汰'],
  ['finishAll', '3人+局决出名次'],
];

export default function Room() {
  const { room, identity, leaveRoom, showColorblind, setColorblind, muted, setMuted } = useStore();
  const [showRules, setShowRules] = useState(false);
  const [botLevel, setBotLevel] = useState('normal');

  if (!room) return null;
  const isOwner = room.ownerKey === identity?.key;
  const seated = room.seats.filter(s => !('empty' in s && s.empty));

  const emit = (ev: string, p?: unknown) => socket.emit(ev, p);
  const s = room.settings;
  const hr = s.houseRules;

  const setRule = (k: keyof HouseRules, v: boolean) =>
    emit('room:settings', { houseRules: { [k]: v } });

  return (
    <div className="felt h-full flex flex-col p-4 overflow-y-auto">
      {/* 顶栏 */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={leaveRoom} className="glass text-white/70 p-2 rounded-xl"><ArrowLeft size={18} /></button>
        <div className="text-center">
          <div className="text-white/50 text-[10px] tracking-widest">{gameDef(s.gameId)?.name ?? 'UNO'} · 房间码</div>
          <div className="text-amber-300 font-black text-2xl tracking-[0.3em] font-mono"
            style={{ textShadow: '0 0 18px rgba(255,201,61,.4)' }}>{room.code}</div>
        </div>
        <button aria-label="复制邀请链接" onClick={async () => {
          const url = new URL(location.origin);
          if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
            try {
              const data = await fetch('/api/lan').then(r => r.json());
              if (data.hosts[0]) url.hostname = data.hosts[0];
            } catch { /* 房间码仍然可手动分享 */ }
          }
          url.searchParams.set('join', room.code);
          try {
            await navigator.clipboard.writeText(url.toString());
            useStore.getState().toast('已复制邀请链接');
          } catch { window.prompt('复制邀请链接，与同一网络的朋友分享', url.toString()); }

        }} className="glass text-white/70 p-2 rounded-xl"><Copy size={17} /></button>
      </div>

      {/* 座位 */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {room.seats.map((st, i) => (
          <div key={i}
            className={`rounded-2xl px-3 py-2.5 min-h-[60px] flex items-center justify-between
              ${('empty' in st) ? 'border border-dashed border-white/15' : 'glass'}`}>
            {'empty' in st ? (
              <span className="text-white/30 text-sm mx-auto">空位</span>
            ) : (
              <>
                <div className="flex items-center gap-2.5">
                  <div className="relative">
                    <Avatar name={(st as any).name} isBot={(st as any).isBot} size={36} />
                    {(st as any).key === room.ownerKey &&
                      <Crown size={11} className="absolute -top-1.5 -right-1.5 text-amber-300" />}
                  </div>
                  <div>
                    <div className="text-white font-bold text-sm">
                      {(st as any).name}
                      {(st as any).isBot && <span className="ml-1 text-white/50 text-[10px]">AI·{(st as any).difficulty}</span>}
                    </div>
                    <div className="text-white/40 text-[11px]">
                      {(st as any).connected === false ? '离线' : '已就绪'}
                    </div>
                  </div>
                </div>
                {isOwner && (st as any).isBot && (
                  <button onClick={() => emit('room:removeBot', { index: i })} className="text-white/40 text-lg px-1">×</button>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {/* 游戏选择（房主等待时） */}
      {room.status === 'waiting' && (
        <div className="grid grid-cols-4 gap-1.5 mb-3">
          {GAME_DEFS.map(g => {
            const live = g.status === 'live';
            const active = s.gameId === g.id;
            return (
              <button key={g.id} disabled={!live || !isOwner}
                onClick={() => live && isOwner && emit('room:settings', { gameId: g.id })}
                className={`rounded-xl px-1 py-2 text-center transition-colors relative
                  ${active ? 'bg-amber-400 text-black' : live ? 'glass text-white/80 hover:bg-white/15' : 'bg-white/5 text-white/30'}
                  ${!isOwner && !active ? 'opacity-60' : ''}`}>
                <div className="font-black text-[13px]">{g.name}</div>
                <div className={`text-[9px] ${active ? 'text-black/55' : 'text-white/35'}`}>
                  {live ? `${g.minPlayers}-${g.maxPlayers}人` : '即将推出'}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* 加人机 */}
      {isOwner && room.status === 'waiting' && (
        <div className="flex gap-2 mb-3">
          <select value={botLevel} onChange={e => setBotLevel(e.target.value)}
            className="glass text-white text-sm rounded-xl px-3 py-2 outline-none">
            <option value="novice">萌新</option><option value="easy">简单</option>
            <option value="normal">普通</option><option value="hard">困难</option>
          </select>
          <button onClick={() => emit('room:addBot', { difficulty: botLevel })}
            className="flex-1 glass text-white font-bold rounded-xl py-2 flex items-center justify-center gap-1.5">
            <UserPlus size={16} /> 加人机
          </button>
        </div>
      )}

      {/* 基本设置 */}
      {isOwner && room.status === 'waiting' && (
        <div className="glass rounded-2xl p-3 mb-3">
          <div className="flex gap-2 mb-2">
            <div className="flex-1">
              <div className="text-white/50 text-xs mb-1">人数上限</div>
              <select value={s.maxPlayers} onChange={e => emit('room:settings', { maxPlayers: +e.target.value })}
                className="w-full bg-white/10 text-white rounded-lg px-2 py-2 text-sm outline-none">
                {[2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n} 人</option>)}
              </select>
            </div>
            <div className="flex-1">
              <div className="text-white/50 text-xs mb-1">目标分数</div>
              <select value={s.targetScore} onChange={e => emit('room:settings', { targetScore: +e.target.value })}
                className="w-full bg-white/10 text-white rounded-lg px-2 py-2 text-sm outline-none">
                <option value={0}>单轮定胜负</option>
                {[100, 200, 300, 500].map(n => <option key={n} value={n}>{n} 分</option>)}
              </select>
            </div>
            <div className="flex-1">
              <div className="text-white/50 text-xs mb-1">回合限时</div>
              <select value={s.turnSeconds} onChange={e => emit('room:settings', { turnSeconds: +e.target.value })}
                className="w-full bg-white/10 text-white rounded-lg px-2 py-2 text-sm outline-none">
                {[15, 30, 45, 60, 90].map(n => <option key={n} value={n}>{n} 秒</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-white/60 text-sm">私密房间<span className="text-white/35 text-[11px]">（不进公开大厅）</span></span>
            <Toggle v={s.isPrivate} on={v => emit('room:settings', { isPrivate: v })} />
          </div>
          {s.gameId === 'uno' && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-white/60 text-sm">简洁规则模式</span>
                <Toggle v={hr.simpleMode} on={v => setRule('simpleMode', v)} />
              </div>
              {!hr.simpleMode && (
                <div className="flex items-center justify-between mt-2">
                  <span className="text-white/60 text-sm">自动喊 UNO</span>
                  <Toggle v={hr.autoUno} on={v => setRule('autoUno', v)} />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 村规开关（仅 UNO） */}
      {s.gameId === 'uno' && (
      <button onClick={() => setShowRules(!showRules)}
        className="w-full glass rounded-2xl px-4 py-3 mb-3 flex justify-between items-center">
        <span className="text-white/80 font-bold text-sm">村规 / 高级规则</span>
        <ChevronDown size={16} className={`text-white/40 transition-transform ${showRules ? 'rotate-180' : ''}`} />
      </button>
      )}
      {showRules && (
        <div className="glass rounded-2xl p-3 mb-3 space-y-2">
          {RULE_INFO.map(([k, label]) => (
            <div key={k} className="flex items-center justify-between">
              <span className="text-white/70 text-sm">{label}</span>
              <Toggle v={hr[k] as boolean} on={v => isOwner && setRule(k, v)} disabled={!isOwner} />
            </div>
          ))}
          <div className="flex items-center justify-between pt-1 border-t border-white/10">
            <span className="text-white/70 text-sm">UNO 罚摸张数</span>
            <select value={hr.unoPenalty} disabled={!isOwner}
              onChange={e => emit('room:settings', { houseRules: { unoPenalty: +e.target.value } })}
              className="bg-white/10 text-white rounded-lg px-2 py-1 text-sm outline-none">
              {[2, 4, 6].map(n => <option key={n} value={n}>{n} 张</option>)}
            </select>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/70 text-sm">色盲角标符号</span>
            <Toggle v={showColorblind} on={v => setColorblind(v)} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/70 text-sm">音效</span>
            <Toggle v={!muted} on={v => setMuted(!v)} />
          </div>
        </div>
      )}

      <div className="flex-1" />

      {/* 开始 */}
      {isOwner ? (
        <motion.button whileTap={{ scale: 0.97 }} onClick={() => emit('room:start')}
          className="w-full bg-gradient-to-b from-amber-300 to-amber-500 text-black font-black text-xl py-4 rounded-2xl shadow-lg flex items-center justify-center gap-2">
          <Play size={20} strokeWidth={3} /> 开始游戏（{seated.length} 人）
        </motion.button>
      ) : (
        <div className="text-center text-white/50 py-4">等待房主开始…</div>
      )}
    </div>
  );
}

function Toggle({ v, on, disabled }: { v: boolean; on(v: boolean): void; disabled?: boolean }) {
  return (
    <button disabled={disabled} onClick={() => on(!v)}
      className={`w-11 h-6 rounded-full transition-colors relative ${v ? 'bg-amber-400' : 'bg-white/15'} ${disabled ? 'opacity-40' : ''}`}>
      <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${v ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  );
}
