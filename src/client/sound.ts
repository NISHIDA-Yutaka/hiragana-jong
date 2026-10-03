// 効果音（WebAudioで合成）と発声（音声合成）
import { lsGet, lsSet } from "./net";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

export const prefs = {
  sound: lsGet("sound", true),
  voice: lsGet("voice", true),
};
export function setPref(k: "sound" | "voice", v: boolean) {
  prefs[k] = v;
  lsSet(k, v);
}

function ac(): AudioContext | null {
  if (!prefs.sound) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** 牌を置く「カチッ」 */
export function clack(strength = 1) {
  const c = ac();
  if (!c || !master) return;
  const t = c.currentTime;
  const len = 0.06;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 6);
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2400 + Math.random() * 400;
  bp.Q.value = 1.4;
  const g = c.createGain();
  g.gain.setValueAtTime(0.9 * strength, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + len);
  src.connect(bp).connect(g).connect(master);
  src.start(t);
  // 低い「コトッ」
  const o = c.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(420, t);
  o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.25 * strength, t);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  o.connect(g2).connect(master);
  o.start(t);
  o.stop(t + 0.12);
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = "triangle", vol = 0.2) {
  const c = ac();
  if (!c || !master) return;
  const t = c.currentTime + start;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export function chime() {
  tone(880, 0, 0.25, "sine", 0.15);
  tone(1320, 0.08, 0.35, "sine", 0.12);
}

export function tick() {
  tone(1500, 0, 0.05, "square", 0.05);
}

/** アガリのファンファーレ */
export function fanfare(big = false) {
  const notes = big ? [523, 659, 784, 1047, 1319, 1568] : [523, 659, 784, 1047];
  notes.forEach((f, i) => tone(f, i * 0.09, 0.5, "triangle", 0.16));
  tone(big ? 2093 : 1568, notes.length * 0.09, 0.9, "sine", 0.12);
}

export function riichiSound() {
  tone(392, 0, 0.18, "sawtooth", 0.08);
  tone(784, 0.06, 0.5, "triangle", 0.18);
}

export function callSound() {
  tone(660, 0, 0.12, "square", 0.08);
  tone(990, 0.05, 0.25, "triangle", 0.14);
}

let jpVoice: SpeechSynthesisVoice | null = null;
function pickVoice() {
  const vs = window.speechSynthesis?.getVoices() ?? [];
  jpVoice = vs.find((v) => v.lang.startsWith("ja")) ?? null;
}
if (typeof window !== "undefined" && window.speechSynthesis) {
  pickVoice();
  window.speechSynthesis.onvoiceschanged = pickVoice;
}

/** 「ポン」「ロン」などを読み上げる */
export function say(text: string) {
  if (!prefs.voice || !window.speechSynthesis) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    if (jpVoice) u.voice = jpVoice;
    u.rate = 1.15;
    u.pitch = 1.1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    /* 無視 */
  }
}
