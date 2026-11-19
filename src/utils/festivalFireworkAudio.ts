/**
 * Optional PC-only fireworks audio. A click is required to create/resume Web Audio.
 * Procedural short sounds have no external downloads, permissions or persistence.
 */
export interface FestivalFireworkSound {
  resume(): Promise<void>;
  launch(index: number): void;
  burst(index: number): void;
  stop(): void;
}

export function createFestivalFireworkSound(): FestivalFireworkSound | null {
  if (typeof window === 'undefined' || !window.AudioContext) return null;
  const ctx = new window.AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0.24; // Deliberately quiet by default.
  master.connect(ctx.destination);
  let stopped = false;

  // Reused deterministic broadband noise: a short boom/crackle, no MP3 or network.
  const noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.75), ctx.sampleRate);
  const samples = noise.getChannelData(0);
  let seed = 123456789;
  for (let i = 0; i < samples.length; i += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    samples[i] = ((seed >>> 0) / 2147483648) - 1;
  }

  const launch = (index: number) => {
    if (stopped || ctx.state !== 'running') return;
    const start = ctx.currentTime;
    const whistle = ctx.createOscillator();
    const volume = ctx.createGain();
    whistle.type = 'sine';
    whistle.frequency.setValueAtTime(300 + index * 27, start);
    whistle.frequency.exponentialRampToValueAtTime(1000 + index * 35, start + 0.5);
    volume.gain.setValueAtTime(0.0001, start);
    volume.gain.exponentialRampToValueAtTime(0.06, start + 0.1);
    volume.gain.exponentialRampToValueAtTime(0.0001, start + 0.58);
    whistle.connect(volume);
    volume.connect(master);
    whistle.start(start);
    whistle.stop(start + 0.6);
  };

  const burst = (index: number) => {
    if (stopped || ctx.state !== 'running') return;
    const start = ctx.currentTime;
    const noiseSource = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const noiseGain = ctx.createGain();
    noiseSource.buffer = noise;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200 + index * 65, start);
    filter.frequency.exponentialRampToValueAtTime(420, start + 0.57);
    noiseGain.gain.setValueAtTime(0.0001, start);
    noiseGain.gain.exponentialRampToValueAtTime(0.29, start + 0.015);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.57);
    noiseSource.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(master);
    noiseSource.start(start);
    noiseSource.stop(start + 0.58);

    // Soft low boom under the initial bright crack.
    const boom = ctx.createOscillator();
    const boomGain = ctx.createGain();
    boom.type = 'triangle';
    boom.frequency.setValueAtTime(115 + index * 3, start);
    boom.frequency.exponentialRampToValueAtTime(48, start + 0.32);
    boomGain.gain.setValueAtTime(0.0001, start);
    boomGain.gain.exponentialRampToValueAtTime(0.21, start + 0.02);
    boomGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.34);
    boom.connect(boomGain);
    boomGain.connect(master);
    boom.start(start);
    boom.stop(start + 0.35);

    // Three staggered little crackles for the falling embers.
    for (let j = 0; j < 3; j += 1) {
      const at = start + 0.16 + j * 0.12;
      const sparkle = ctx.createOscillator();
      const sparkleGain = ctx.createGain();
      sparkle.type = 'triangle';
      sparkle.frequency.setValueAtTime(1050 + ((index * 71 + j * 137) % 800), at);
      sparkle.frequency.exponentialRampToValueAtTime(420 + j * 90, at + 0.075);
      sparkleGain.gain.setValueAtTime(0.0001, at);
      sparkleGain.gain.exponentialRampToValueAtTime(0.042, at + 0.008);
      sparkleGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
      sparkle.connect(sparkleGain);
      sparkleGain.connect(master);
      sparkle.start(at);
      sparkle.stop(at + 0.095);
    }
  };

  return {
    resume: () => ctx.resume(),
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
