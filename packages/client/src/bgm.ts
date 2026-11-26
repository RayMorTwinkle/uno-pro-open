let enabled = localStorage.getItem('uno-bgm') !== '0';
let mutedNow = true;
let audio: AudioContext | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let step = 0;
const notes = [174.61, 220, 261.63, 329.63, 196, 246.94, 293.66, 369.99];
export const bgmEnabled = () => enabled;
export function setBgmEnabled(on: boolean) {
  enabled = on;
  localStorage.setItem('uno-bgm', on ? '1' : '0');
  syncBgm(mutedNow);
}
function note() {
  if (!audio || audio.state !== 'running') return;
  const osc = audio.createOscillator(), gain = audio.createGain();
  osc.connect(gain).connect(audio.destination);
  osc.frequency.value = notes[step++ % notes.length];
  const t = audio.currentTime;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.014, t + 0.08);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
  osc.start(t); osc.stop(t + 1.16);
}
export function stopBgm() {
  clearInterval(timer);
  timer = undefined;
  if (audio?.state === 'running') void audio.suspend().catch(() => {});
}
export function syncBgm(muted: boolean) {
  mutedNow = muted;
  if (muted || !enabled) { stopBgm(); return; }
  if (timer || !window.AudioContext) return;
  audio ??= new AudioContext();
  void audio.resume().then(note).catch(() => {});
  timer = setInterval(note, 780);
}
