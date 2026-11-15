// Every sound in the game is synthesised with WebAudio at the moment it is
// needed: no audio files, nothing fetched. Gunfire is a filtered noise burst
// with a body thump, the charge beeps on a square wave, the explosion is noise
// through a falling low-pass with a sine drop under it. Sounds are placed by
// ear alone: each call takes a volume already scaled by distance in main.js
// and bots.js. The context starts on the first user gesture (the Play click),
// as browsers require; before that every call is a no-op.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return false;
    ctx = new AudioCtor();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    return true;
  }

  function noiseBuffer(seconds) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst({ at = 0, dur = 0.12, freq = 1800, q = 0.8, gain = 0.5, type = 'lowpass' }) {
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur + 0.05);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.25), t + dur);
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  function tone({ at = 0, dur = 0.1, freq = 880, end = null, gain = 0.2, type = 'square' }) {
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (end) osc.frequency.exponentialRampToValueAtTime(end, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function shot(kind, volume = 1) {
    if (!ctx || volume <= 0.01) return;
    if (kind === 'dmr') {
      burst({ dur: 0.22, freq: 2600, gain: 0.65 * volume });
      tone({ dur: 0.14, freq: 160, end: 55, gain: 0.5 * volume, type: 'sine' });
    } else if (kind === 'smg') {
      burst({ dur: 0.09, freq: 2100, gain: 0.4 * volume });
      tone({ dur: 0.07, freq: 210, end: 80, gain: 0.3 * volume, type: 'sine' });
    } else if (kind === 'sidearm') {
      burst({ dur: 0.11, freq: 1900, gain: 0.45 * volume });
      tone({ dur: 0.08, freq: 190, end: 70, gain: 0.32 * volume, type: 'sine' });
    } else {
      burst({ dur: 0.16, freq: 2300, gain: 0.55 * volume });
      tone({ dur: 0.1, freq: 175, end: 60, gain: 0.42 * volume, type: 'sine' });
    }
  }

  return {
    unlock() {
      ensure();
    },
    shot,
    dryFire(volume = 1) {
      if (!ctx) return;
      tone({ dur: 0.04, freq: 1400, gain: 0.12 * volume, type: 'square' });
    },
    reload(volume = 1) {
      if (!ctx) return;
      tone({ dur: 0.05, freq: 700, gain: 0.15 * volume, type: 'square' });
      tone({ at: 0.16, dur: 0.05, freq: 500, gain: 0.15 * volume, type: 'square' });
      tone({ at: 0.34, dur: 0.06, freq: 950, gain: 0.18 * volume, type: 'square' });
    },
    hit(killed, volume = 1) {
      if (!ctx) return;
      tone({ dur: 0.05, freq: killed ? 1560 : 1180, gain: 0.16 * volume, type: 'sine' });
      if (killed) tone({ at: 0.06, dur: 0.09, freq: 780, gain: 0.14 * volume, type: 'sine' });
    },
    hurt(volume = 1) {
      if (!ctx) return;
      burst({ dur: 0.1, freq: 500, gain: 0.3 * volume });
    },
    throwIt(volume = 1) {
      if (!ctx) return;
      burst({ dur: 0.08, freq: 900, gain: 0.1 * volume, type: 'bandpass' });
    },
    bounce(volume = 1) {
      if (!ctx) return;
      tone({ dur: 0.04, freq: 320, gain: 0.12 * volume, type: 'sine' });
    },
    explosion(volume = 1) {
      if (!ctx) return;
      burst({ dur: 0.9, freq: 3200, gain: 0.9 * volume });
      tone({ dur: 0.8, freq: 120, end: 34, gain: 0.8 * volume, type: 'sine' });
    },
    flashbang(volume = 1) {
      if (!ctx) return;
      burst({ dur: 0.3, freq: 4000, gain: 0.5 * volume, type: 'highpass' });
      tone({ dur: 0.5, freq: 3400, gain: 0.1 * volume, type: 'sine' });
    },
    beep(final = false, volume = 1) {
      if (!ctx) return;
      tone({ dur: final ? 0.3 : 0.07, freq: final ? 1320 : 990, gain: 0.14 * volume, type: 'square' });
    },
    plantDone(volume = 1) {
      if (!ctx) return;
      tone({ dur: 0.07, freq: 990, gain: 0.14 * volume, type: 'square' });
      tone({ at: 0.1, dur: 0.12, freq: 1320, gain: 0.14 * volume, type: 'square' });
    },
    buy(volume = 1) {
      if (!ctx) return;
      tone({ dur: 0.06, freq: 1040, gain: 0.12 * volume, type: 'sine' });
      tone({ at: 0.07, dur: 0.08, freq: 1560, gain: 0.1 * volume, type: 'sine' });
    },
    roundEnd(won, volume = 1) {
      if (!ctx) return;
      const base = won ? 660 : 392;
      tone({ dur: 0.14, freq: base, gain: 0.16 * volume, type: 'triangle' });
      tone({ at: 0.15, dur: 0.22, freq: won ? 990 : 330, gain: 0.16 * volume, type: 'triangle' });
    },
  };
}
