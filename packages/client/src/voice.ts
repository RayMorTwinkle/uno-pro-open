export type VoiceLang = 'zh' | 'en';
export const voiceLang = (): VoiceLang => localStorage.getItem('uno-voice-lang') === 'en' ? 'en' : 'zh';
export const setVoiceLang = (lang: VoiceLang) => localStorage.setItem('uno-voice-lang', lang);
export const voiceEnabled = () => localStorage.getItem('uno-voice') !== 'off';
export function setVoiceEnabled(on: boolean) {
  localStorage.setItem('uno-voice', on ? 'on' : 'off');
  if (!on) window.speechSynthesis?.cancel();
}
const phrases: Record<string, [string, string]> = {
  start: ['开局！', 'Game on!'], turn: ['轮到你了', 'Your turn'], win: ['你赢了！', 'You won!'],
  lose: ['下次再来', 'Good game'], out: ['出完了！', 'Finished!'], reverse: ['反转', 'Reverse'],
  skip: ['跳过', 'Skip'], draw_two: ['加二', 'Draw two'], draw_four: ['加四', 'Draw four'],
  wild: ['换色', 'Wild'], uno: ['优诺！', 'Uno!'], uno_caught: ['抓到了', 'Caught!'],
};
let lastAt = 0;
export function playVoice(seatKey: string, event: string, muted: boolean) {
  const text = phrases[event];
  if (muted || !voiceEnabled() || !text || !window.speechSynthesis || Date.now() - lastAt < 600) return;
  lastAt = Date.now();
  const zh = voiceLang() === 'zh';
  const voice = new SpeechSynthesisUtterance(text[zh ? 0 : 1]);
  voice.lang = zh ? 'zh-CN' : 'en-US';
  const voices = window.speechSynthesis.getVoices().filter(v => v.localService && v.lang.startsWith(zh ? 'zh' : 'en'));
  if (!voices.length) return;
  voice.voice = voices[Array.from(seatKey).reduce((n, c) => n + c.charCodeAt(0), 0) % voices.length];
  speechSynthesis.cancel();
  speechSynthesis.speak(voice);
}
