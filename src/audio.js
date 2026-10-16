// Web Audio: synthesized cues and generated looping background sounds.
// No audio files are shipped; buffers are generated once and reused.

let ctx = null;
let master = null;
let bg = null; // { type, src, gain }
let wanted = 'off';
let volume = 0.5;
let suspendTimer = 0;
const buffers = new Map();

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC({ latencyHint: 'playback' });
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
  }
  clearTimeout(suspendTimer);
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** Call from any user gesture so autoplay policies let us start sound. */
export function unlock() {
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  if (wanted !== 'off' && (!bg || bg.type !== wanted)) setBackground(wanted);
}

function idleSuspend() {
  clearTimeout(suspendTimer);
  suspendTimer = setTimeout(() => {
    if (ctx && !bg && ctx.state === 'running') ctx.suspend().catch(() => {});
  }, 4000);
}

// ---- background loops ------------------------------------------------------
function makeBuffer(type) {
  if (buffers.has(type)) return buffers.get(type);
  const sr = ctx.sampleRate;
  const secs = type === 'ticking' ? 2 : 8;
  const fade = type === 'ticking' ? 0 : Math.floor(sr * 0.5);
  const len = sr * secs;
  const tmp = new Float32Array(len + fade);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  const pink = () => {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const o = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    return o * 0.11;
  };
  if (type === 'ticking') {
    const click = (at, f, g) => {
      const n = Math.floor(sr * 0.03);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        tmp[at + i] += Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 260) * g + (Math.random() * 2 - 1) * Math.exp(-t * 900) * g * 0.35;
      }
    };
    click(0, 3100, 0.5);
    click(sr, 2500, 0.42);
  } else {
    let lp = 0;
    for (let i = 0; i < tmp.length; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'white') tmp[i] = w * 0.25;
      else if (type === 'pink') tmp[i] = pink();
      else if (type === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        tmp[i] = last * 3.2;
      } else if (type === 'rain') {
        lp += (pink() - lp) * 0.35; // soften the hiss
        const swell = 0.75 + 0.25 * Math.sin((i / sr) * 0.7) * Math.sin((i / sr) * 0.23 + 1);
        tmp[i] = lp * 1.6 * swell;
        if (Math.random() < 9 / sr) {
          // a droplet: tiny decaying blip
          const f = 1800 + Math.random() * 2600;
          const n = Math.floor(sr * 0.018);
          const g = 0.04 + Math.random() * 0.08;
          for (let k = 0; k < n && i + k < tmp.length; k++) {
            tmp[i + k] += Math.sin((2 * Math.PI * f * k) / sr) * Math.exp(-k / (sr * 0.003)) * g;
          }
        }
      }
    }
  }
  // Fold the tail into the head so the loop is seamless.
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    tmp[i] = tmp[i] * t + tmp[len + i] * (1 - t);
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(tmp[i]));
  const k = peak > 0 ? 0.6 / peak : 1;
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = tmp[i] * k;
  buffers.set(type, buf);
  return buf;
}

const LEVEL = { brown: 0.55, pink: 0.32, white: 0.16, rain: 0.42, ticking: 0.5 };

export function setBackground(type) {
  wanted = type || 'off';
  if (bg && bg.type === wanted) return;
  if (!ctx && wanted === 'off') return;
  if (!ac()) return;
  const now = ctx.currentTime;
  if (bg) {
    const old = bg;
    old.gain.gain.cancelScheduledValues(now);
    old.gain.gain.setValueAtTime(old.gain.gain.value, now);
    old.gain.gain.linearRampToValueAtTime(0, now + 0.9);
    old.src.stop(now + 1);
    old.src.onended = () => old.gain.disconnect();
    bg = null;
  }
  if (wanted === 'off') return idleSuspend();
  if (ctx.state !== 'running') return; // retried on next unlock()
  const src = ctx.createBufferSource();
  src.buffer = makeBuffer(wanted);
  src.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(gain).connect(master);
  src.start();
  gain.gain.linearRampToValueAtTime(volume * (LEVEL[wanted] || 0.4), now + 1.4);
  bg = { type: wanted, src, gain };
}

export function setVolume(v) {
  volume = v;
  if (bg && ctx) bg.gain.gain.setTargetAtTime(volume * (LEVEL[bg.type] || 0.4), ctx.currentTime, 0.1);
}

// ---- cues --------------------------------------------------------------------
function bell(freq, at, { len = 1.6, gain = 0.18, type = 'sine' } = {}) {
  const t0 = ctx.currentTime + at;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
  g.connect(master);
  for (const [mult, amp] of [[1, 1], [2.76, 0.22], [5.4, 0.06]]) {
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = type;
    o.frequency.value = freq * mult;
    og.gain.value = amp;
    o.connect(og).connect(g);
    o.start(t0);
    o.stop(t0 + len + 0.05);
  }
}

const CUES = {
  start: [[523.25, 0], [783.99, 0.14]],
  end: [[783.99, 0], [659.25, 0.18], [1046.5, 0.36]],
  soon: [[880, 0, { gain: 0.11 }]],
  presence: [[659.25, 0, { gain: 0.07, len: 1.2 }]],
  breakEnd: [[587.33, 0], [880, 0.2]],
  tooLong: [[440, 0, { gain: 0.12 }], [440, 0.35, { gain: 0.1 }]],
  breathIn: [[392, 0, { gain: 0.035, len: 2.4 }]],
  breathOut: [[329.63, 0, { gain: 0.03, len: 2.4 }]],
};

let enabled = true;
export const setCuesEnabled = (v) => (enabled = !!v);

export function cue(name) {
  if (!enabled || !CUES[name] || !ac()) return;
  for (const [f, at, opt] of CUES[name]) bell(f, at, opt);
  if (!bg) idleSuspend();
}

/** Warm up the audio context during a gesture (e.g. dial drag start). */
export function prime() {
  if (!enabled || !ac()) return;
  if (!bg) idleSuspend();
}

/** Tiny tactile click for dial snapping. */
export function click() {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(2400, t0);
  o.frequency.exponentialRampToValueAtTime(900, t0 + 0.02);
  g.gain.setValueAtTime(0.05, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + 0.04);
  if (!bg) idleSuspend();
}
