import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Trophy, Swords, Target, Star, Clock, Flame } from 'lucide-react';
import Avatar from './Avatar';

interface ProfileStats { games_played: number; games_won: number; rounds_won: number; points: number }
interface RecentMatch { finished_at: number; seat_name: string; won: number; score: number; players: number }
interface LeaderRow extends ProfileStats { player_key: string; name: string | null }

function relTime(t: number) {
  const d = Date.now() - t;
  if (d < 60_000) return '刚刚';
  if (d < 3600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)} 小时前`;
  return `${Math.floor(d / 86400_000)} 天前`;
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="bg-white/[.07] rounded-2xl px-3 py-2.5 text-center">
      <div className="flex justify-center text-amber-300/90 mb-0.5">{icon}</div>
      <div className="text-white font-black text-lg leading-tight">{value}</div>
      <div className="text-white/45 text-[10px]">{label}</div>
    </div>
  );
}

export default function StatsPanel({ playerKey, name, onClose }: {
  playerKey: string; name: string; onClose(): void;
}) {
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [recent, setRecent] = useState<RecentMatch[]>([]);
  const [streak, setStreak] = useState(0);
  const [board, setBoard] = useState<LeaderRow[]>([]);

  useEffect(() => {
    fetch(`/api/profile/${encodeURIComponent(playerKey)}`).then(r => r.json()).then(d => {
      setStats(d.stats); setRecent(d.recent ?? []);
      const r: RecentMatch[] = d.recent ?? [];
      let s = 0; for (const m of r) { if (m.won) s++; else break; }
      setStreak(s);
    }).catch(() => {});
    fetch('/api/leaderboard').then(r => r.json()).then(setBoard).catch(() => {});
  }, [playerKey]);

  const winRate = stats && stats.games_played > 0 ? Math.round((stats.games_won / stats.games_played) * 100) : 0;
  const myRank = board.findIndex(r => r.player_key === playerKey);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}>
      <motion.div initial={{ y: 80 }} animate={{ y: 0 }} exit={{ y: 80 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        className="glass w-full sm:max-w-md max-h-[86vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5 relative"
        onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-white/50 hover:text-white"><X size={18} /></button>

        {/* 头部 */}
        <div className="flex items-center gap-3.5 mb-4">
          <Avatar name={name} size={52} ring />
          <div>
            <div className="text-white font-black text-lg">{name}</div>
            {myRank >= 0 && (
              <div className="text-amber-300 text-xs font-bold flex items-center gap-1">
                <Trophy size={11} /> 排行榜 #{myRank + 1}
              </div>
            )}
            {streak >= 2 && (
              <div className="text-orange-400 text-xs font-bold flex items-center gap-1 mt-0.5">
                <Flame size={11} /> 连胜 {streak} 场
              </div>
            )}
          </div>
        </div>

        {/* 数据格 */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          <Stat icon={<Swords size={15} />} label="总局数" value={stats?.games_played ?? '—'} />
          <Stat icon={<Trophy size={15} />} label="胜场" value={stats?.games_won ?? '—'} />
          <Stat icon={<Target size={15} />} label="胜率" value={stats ? `${winRate}%` : '—'} />
          <Stat icon={<Star size={15} />} label="总积分" value={stats?.points ?? '—'} />
        </div>
        {/* 胜率条 */}
        {stats && stats.games_played > 0 && (
          <div className="h-2 rounded-full bg-white/10 overflow-hidden mb-4">
            <motion.div initial={{ width: 0 }} animate={{ width: `${winRate}%` }}
              transition={{ duration: .8, ease: 'easeOut' }}
              className="h-full rounded-full bg-gradient-to-r from-amber-300 to-orange-400" />
          </div>
        )}

        {/* 最近战绩 */}
        {recent.length > 0 && (
          <>
            <div className="text-white/60 text-xs font-bold mb-1.5 flex items-center gap-1"><Clock size={11} /> 最近战绩</div>
            <div className="space-y-1.5 mb-4">
              {recent.slice(0, 8).map((m, i) => (
                <div key={i} className="flex items-center gap-2.5 bg-white/[.05] rounded-xl px-3 py-1.5">
                  <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md ${m.won ? 'bg-amber-400/90 text-black' : 'bg-white/10 text-white/50'}`}>
                    {m.won ? '胜' : '负'}
                  </span>
                  <span className="text-white/80 text-xs">{m.players} 人局 · {m.score} 分</span>
                  <span className="flex-1" />
                  <span className="text-white/35 text-[10px]">{relTime(m.finished_at)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* 排行榜 */}
        {board.length > 0 && (
          <>
            <div className="text-white/60 text-xs font-bold mb-1.5 flex items-center gap-1"><Trophy size={11} /> 排行榜</div>
            <div className="space-y-1.5">
              {board.slice(0, 10).map((r, i) => (
                <div key={r.player_key}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-1.5 ${r.player_key === playerKey ? 'bg-amber-400/20 ring-1 ring-amber-300/40' : 'bg-white/[.05]'}`}>
                  <span className={`w-5 text-center text-xs font-black ${i < 3 ? 'text-amber-300' : 'text-white/40'}`}>{i + 1}</span>
                  <Avatar name={r.name ?? r.player_key} size={22} />
                  <span className="text-white/85 text-xs font-bold truncate max-w-[8rem]">{r.name ?? '无名'}</span>
                  <span className="flex-1" />
                  <span className="text-white/50 text-[10px]">{r.games_won} 胜 / {r.games_played} 局</span>
                  <span className="text-amber-300/90 text-xs font-black">{r.points}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {stats && stats.games_played === 0 && recent.length === 0 && board.length === 0 && (
          <div className="text-white/40 text-sm text-center py-6">还没有战绩 — 去开一局吧</div>
        )}
      </motion.div>
    </motion.div>
  );
}
