/** Quiet, optional PC fireworks audio; only instantiated after a user click. */
export interface FestivalFireworkSound {
  resume(): Promise<void>;
  launch(index: number): void;
  burst(index: number): void;
  stop(): void;
}

export function createFestivalFireworkSound(): FestivalFireworkSound | null {
  if (typeof window === 'undefined' || !window.AudioContext) return null;
  let ctx: AudioContext;
  try { ctx = new window.AudioContext(); } catch { return null; }
  const master = ctx.createGain();
  // Keep overlapping bursts modest, without external sound files or any network calls.
  master.gain.value = 0.16;
  master.connect(ctx.destination);
  let stopped = false;
  const noise = ctx.createBuffer(1, Math.max(1, Math.round(ctx.sampleRate * .7)), ctx.sampleRate);
  const samples = noise.getChannelData(0);
  let seed = 123456789;
  for (let i = 0; i < samples.length; i += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    samples[i] = ((seed >>> 0) / 2147483648) - 1;
  }

  const launch = (index: number) => {
    if (stopped || ctx.state !== 'running') return;
    const at = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(310 + index * 21, at);
    oscillator.frequency.exponentialRampToValueAtTime(950 + index * 31, at + 1.45);
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(.055, at + .08);
    gain.gain.exponentialRampToValueAtTime(.0001, at + 1.7);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(at);
    oscillator.stop(at + 1.72);
  };

  const burst = (index: number) => {
    if (stopped || ctx.state !== 'running') return;
    const at = ctx.currentTime;
    const crack = ctx.createBufferSource();
    crack.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1900 + index * 65, at);
    filter.frequency.exponentialRampToValueAtTime(380, at + .5);
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(.0001, at);
    crackGain.gain.exponentialRampToValueAtTime(.22, at + .012);
    crackGain.gain.exponentialRampToValueAtTime(.0001, at + .57);
    crack.connect(filter);
    filter.connect(crackGain);
    crackGain.connect(master);
    crack.start(at);
    crack.stop(at + .58);

    const boom = ctx.createOscillator();
    const boomGain = ctx.createGain();
    boom.type = 'triangle';
    boom.frequency.setValueAtTime(105 + index * 3, at);
    boom.frequency.exponentialRampToValueAtTime(47, at + .32);
    boomGain.gain.setValueAtTime(.0001, at);
    boomGain.gain.exponentialRampToValueAtTime(.13, at + .025);
    boomGain.gain.exponentialRampToValueAtTime(.0001, at + .35);
    boom.connect(boomGain);
    boomGain.connect(master);
    boom.start(at);
    boom.stop(at + .36);

    for (let j = 0; j < 3; j += 1) {
      const t = at + .16 + j * .12;
      const sparkle = ctx.createOscillator();
      const volume = ctx.createGain();
      sparkle.type = 'triangle';
      sparkle.frequency.setValueAtTime(950 + ((index * 71 + j * 137) % 800), t);
      sparkle.frequency.exponentialRampToValueAtTime(400 + j * 80, t + .075);
      volume.gain.setValueAtTime(.0001, t);
      volume.gain.exponentialRampToValueAtTime(.027, t + .008);
      volume.gain.exponentialRampToValueAtTime(.0001, t + .09);
      sparkle.connect(volume);
      volume.connect(master);
      sparkle.start(t);
      sparkle.stop(t + .095);
    }
  };

  return {
    resume: () => stopped ? Promise.reject(new Error('Audio has been stopped')) : ctx.resume(),
    launch,
    burst,
    stop: () => {
      if (stopped) return;
      stopped = true;
      master.disconnect();
      void ctx.close().catch(() => {});
    },
  };
}
