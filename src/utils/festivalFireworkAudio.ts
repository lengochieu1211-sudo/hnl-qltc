/**
 * Optional PC-only fireworks sound: two verified CC0 outdoor field recordings.
 * No oscillators or synthetic tones. Files are bundled in public/audio/festival,
 * fetched only after the user presses the sound toggle (OFF by default).
 * No Firestore access, persistence, or third-party runtime network requests.
 */
export interface FestivalFireworkSound {
  resume(): Promise<void>;
  launch(index: number): void;
  burst(index: number): void;
  stop(): void;
}

type RecordedClips = {
  rocket: AudioBuffer;
  crackle: AudioBuffer;
};

export function createFestivalFireworkSound(): FestivalFireworkSound | null {
  if (typeof window === 'undefined' || !window.AudioContext) return null;
  let ctx: AudioContext;
  try { ctx = new window.AudioContext(); } catch { return null; }

  const controller = new AbortController();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -16;
  limiter.ratio.value = 5;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.18;
  const master = ctx.createGain();
  master.gain.value = 0.24; // Quiet, even when several fireworks overlap.
  master.connect(limiter);
  limiter.connect(ctx.destination);

  let stopped = false;
  let clips: RecordedClips | null = null;
  let pending: Promise<void> | null = null;

  const load = async (name: 'rocket-real.mp3' | 'crackle-real.mp3'): Promise<AudioBuffer> => {
    // Vite serves public/ at BASE_URL; EXE and Web use their own same-origin assets.
    const assetUrl = new URL(import.meta.env.BASE_URL + 'audio/festival/' + name, window.location.origin);
    if (assetUrl.origin !== window.location.origin) throw new Error('Fireworks audio must be same-origin');
    const response = await fetch(assetUrl.href, {
      signal: controller.signal,
      credentials: 'same-origin',
      cache: 'force-cache',
    });
    if (!response.ok) throw new Error('Bundled fireworks recording unavailable: ' + response.status);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength < 2000 || bytes.byteLength > 1_000_000) throw new Error('Invalid fireworks recording');
    if (stopped) throw new Error('Fireworks audio stopped');
    return ctx.decodeAudioData(bytes);
  };

  // Trim and fade real recorded segments, with slight variation in speed and depth.
  // No oscillator/noise generator: every audible sample originates in the recordings.
  const play = (
    buffer: AudioBuffer, offset: number, limit: number, volume: number,
    rate: number, delay = 0, lowpass = 5500,
  ) => {
    if (stopped || ctx.state !== 'running') return;
    const length = Math.min(limit, buffer.duration - offset);
    if (length <= 0.08) return;
    const start = ctx.currentTime + delay;
    const duration = length / rate;
    const source = ctx.createBufferSource();
    const eq = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    eq.type = 'lowpass';
    eq.frequency.value = lowpass;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(volume, start + Math.min(0.018, duration * 0.12));
    gain.gain.setValueAtTime(volume, start + Math.max(0.025, duration - 0.095));
    gain.gain.linearRampToValueAtTime(0.0001, start + duration);
    source.connect(eq);
    eq.connect(gain);
    gain.connect(master);
    source.start(start, offset, length);
    source.stop(start + duration + 0.02);
    source.onended = () => {
      source.disconnect();
      eq.disconnect();
      gain.disconnect();
    };
  };

  return {
    resume: () => {
      if (stopped) return Promise.reject(new Error('Fireworks audio stopped'));
      if (!pending) {
        // Resume while still inside the click's user-activation flow.
        pending = ctx.resume().then(async () => {
          const [rocket, crackle] = await Promise.all([
            load('rocket-real.mp3'),
            load('crackle-real.mp3'),
          ]);
          if (stopped) throw new Error('Fireworks audio stopped');
          clips = { rocket, crackle };
        });
      }
      return pending;
    },
    launch: (index: number) => {
      if (!clips || stopped) return;
      const rate = 0.82 + (index % 5) * 0.025;
      // Original recorded rocket whistle occupies the first ~1.13 seconds.
      play(clips.rocket, 0, 1.12, 0.64, rate, 0, 4300);
    },
    burst: (index: number) => {
      if (!clips || stopped) return;
      const rate = 0.91 + (index % 4) * 0.026;
      const distance = index % 3;
      // Recorded firework impact, tail and natural ambience (not an electronic boom).
      play(clips.rocket, 1.13, 2.0, distance === 0 ? 0.75 : 0.62, rate, 0, distance === 0 ? 6000 : 3800);
      // An occasional outdoor firecracker tail gives a natural multi-pop, never a chirp.
      if (index % 3 === 0) {
        play(clips.crackle, 0.15, 1.75, 0.23, 0.94 + (index % 2) * 0.035, 0.18, 4000);
      }
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      controller.abort();
      clips = null;
      master.disconnect();
      limiter.disconnect();
      void ctx.close().catch(() => {});
    },
  };
}
