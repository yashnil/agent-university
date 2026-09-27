// WebAudio-synthesized retro SFX. Browser only at call time; safe to import on the server.

export type SfxKind = "hit" | "miss" | "special" | "ko" | "round" | "fight" | "win" | "select" | "judge";

export function createSfx(): { play(kind: SfxKind): void; setMuted(m: boolean): void } {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let muted = false;
  let noiseBuf: AudioBuffer | null = null;

  function ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!ctx) {
      const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      try {
        ctx = new AC();
      } catch {
        return null;
      }
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      const len = Math.floor(ctx.sampleRate * 1);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    return ctx;
  }

  function tone(c: AudioContext, type: OscillatorType, f0: number, f1: number, t: number, dur: number, vol: number) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise(c: AudioContext, t: number, dur: number, vol: number, filt: BiquadFilterType, f0: number, f1 = f0) {
    const s = c.createBufferSource();
    s.buffer = noiseBuf;
    const bq = c.createBiquadFilter();
    bq.type = filt;
    bq.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) bq.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bq).connect(g).connect(master!);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  function play(kind: SfxKind): void {
    if (muted) return;
    const c = ensure();
    if (!c || !master) return;
    const t = c.currentTime + 0.01;
    try {
      switch (kind) {
        case "hit":
          noise(c, t, 0.12, 0.9, "bandpass", 1800, 600);
          tone(c, "sine", 160, 45, t, 0.18, 0.9);
          break;
        case "miss":
          noise(c, t, 0.3, 0.5, "bandpass", 2400, 300);
          break;
        case "special":
          [0, 4, 7, 12, 16].forEach((st, i) => tone(c, "square", 330 * Math.pow(2, st / 12), 330 * Math.pow(2, st / 12), t + i * 0.05, 0.09, 0.25));
          noise(c, t + 0.25, 0.35, 0.6, "highpass", 1200, 4000);
          tone(c, "sawtooth", 110, 55, t + 0.25, 0.35, 0.4);
          break;
        case "ko":
          noise(c, t, 1.2, 1, "lowpass", 1200, 60);
          tone(c, "sine", 120, 25, t, 1.4, 1);
          tone(c, "square", 440, 55, t, 1.6, 0.18);
          break;
        case "round":
          [880, 1320].forEach((f) => tone(c, "triangle", f, f, t, 1.2, 0.35));
          tone(c, "sine", 2640, 2640, t, 0.6, 0.12);
          break;
        case "fight":
          tone(c, "square", 392, 392, t, 0.1, 0.3);
          tone(c, "square", 523, 523, t + 0.1, 0.1, 0.3);
          tone(c, "square", 784, 784, t + 0.2, 0.3, 0.35);
          noise(c, t + 0.2, 0.2, 0.3, "highpass", 3000);
          break;
        case "win": {
          const notes: [number, number][] = [[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.24], [784, 0.12], [1047, 0.5]];
          let at = t;
          for (const [f, d] of notes) {
            tone(c, "square", f, f, at, d * 0.95, 0.28);
            tone(c, "triangle", f / 2, f / 2, at, d * 0.95, 0.3);
            at += d;
          }
          break;
        }
        case "select":
          tone(c, "square", 880, 1320, t, 0.06, 0.25);
          break;
        case "judge":
          tone(c, "sine", 220, 90, t, 0.1, 0.9);
          noise(c, t, 0.05, 0.6, "lowpass", 900);
          break;
      }
    } catch {
      /* ignore audio errors */
    }
  }

  return {
    play,
    setMuted(m: boolean) {
      muted = m;
      if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.35, ctx.currentTime, 0.02);
    },
  };
}
