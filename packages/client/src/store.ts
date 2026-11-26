import { create } from 'zustand';
import type { RoomSettings, PlayerView } from '@uno-pro/shared';
import { request, socket } from './socket';

type Theme = 'night' | 'green' | 'violet';
interface Seat { index: number; key: string; name: string; isBot: boolean; ready: boolean; connected: boolean; difficulty?: string }
interface Snapshot { code: string; ownerKey: string; settings: RoomSettings; status: 'waiting' | 'playing' | 'finished'; seats: (Seat | { index: number; empty: true })[] }
interface ChatMsg { seq: number; seat: number; kind: 'emoji' | 'phrase'; value: string; t: number }
interface PublicRoom { code: string; gameName: string; players: number; maxPlayers: number }
interface State {
  connected: boolean;
  identity: { key: string; name: string } | null;
  lobby: PublicRoom[];
  room: Snapshot | null;
  view: PlayerView | null;
  error: string | null;
  route: 'lobby' | 'room' | 'game';
  chat: ChatMsg[];
  theme: Theme;
  muted: boolean;
  showColorblind: boolean;
  init(): void;
  leaveRoom(): Promise<void>;
  setMuted(on: boolean): void;
  setColorblind(on: boolean): void;
  setTheme(theme: Theme): void;
  toast(msg: string): void;
}
let started = false;
let toastTimer: ReturnType<typeof setTimeout>;
export const useStore = create<State>((set, get) => ({
  connected: false, identity: null, room: null, view: null, error: null, route: 'lobby', chat: [], lobby: [],
  theme: (['night', 'green', 'violet'] as const).find(t => t === localStorage.getItem('uno-theme')) ?? 'night',
  muted: localStorage.getItem('uno-muted') !== '0', showColorblind: localStorage.getItem('uno-colorblind') === '1',
  init() {
    if (started) return;
    started = true;
    socket.on('guest:ready', ({ key }) => set({ connected: true, identity: { key, name: localStorage.getItem('uno-name') || '访客' }, room: null, view: null, route: 'lobby', chat: [] }));
    socket.on('disconnect', () => set({ connected: false }));
    socket.on('lobby:list', lobby => set({ lobby }));
    socket.on('game:state', (view: PlayerView) => set({ view, route: 'game' }));
    socket.on('room:snapshot', (room: Snapshot) => {
      const seat = room.seats.find((s): s is Seat => 'key' in s && s.key === get().identity?.key);
      set({ room, ...(seat ? { identity: { key: seat.key, name: seat.name } } : {}),
        ...(room.status === 'waiting' ? { route: 'room', view: null } : {}) });
    });
    socket.on('chat', (msg: ChatMsg) => set(state => ({ chat: [...state.chat.slice(-39), msg] })));
    socket.on('error:msg', p => get().toast(p.error || '操作未成功'));
    socket.connect();
  },
  async leaveRoom() {
    const result = await request('room:leave');
    if (!result.ok) { get().toast(result.error || '未能离开'); return; }
    history.replaceState(null, '', location.pathname);
    set({ room: null, view: null, route: 'lobby', chat: [] });
  },
  setMuted(on) { localStorage.setItem('uno-muted', on ? '1' : '0'); set({ muted: on }); },
  setColorblind(on) { localStorage.setItem('uno-colorblind', on ? '1' : '0'); set({ showColorblind: on }); },
  setTheme(theme) { localStorage.setItem('uno-theme', theme); set({ theme }); },
  toast(msg) {
    clearTimeout(toastTimer);
    set({ error: msg });
    toastTimer = setTimeout(() => set({ error: null }), 2900);
  },
}));
let context: AudioContext | undefined;
const tones = { play: 400, draw: 240, uno: 620, win: 790, chat: 340, deal: 200, catch: 285, turn: 520 };
export function playSnd(kind: keyof typeof tones, muted: boolean) {
  if (muted || !window.AudioContext) return;
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume().catch(() => {});
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.connect(gain).connect(context.destination);
  osc.frequency.value = tones[kind];
  const start = context.currentTime;
  gain.gain.setValueAtTime(0.045, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + 0.14);
  osc.start(start);
  osc.stop(start + 0.15);
}
