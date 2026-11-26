import { io } from 'socket.io-client';

function guestId() {
  let id = localStorage.getItem('uno-local-guest');
  if (!id || !/^[a-f0-9]{48}$/.test(id)) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('uno-local-guest', id);
  }
  return id;
}
export const socket = io({ autoConnect: false, auth: { guestId: guestId() } });

export async function request(event: string, payload: unknown = {}) {
  try {
    return await socket.timeout(5000).emitWithAck(event, payload) as { ok: boolean; error?: string };
  } catch {
    return { ok: false, error: '牌桌连接超时，请稍后重试' };
  }
}
