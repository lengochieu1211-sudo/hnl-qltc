import React, { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { isFestivalPcRuntime, type FestivalEffectMode } from '../utils/festivalEffectMode';
import { createFestivalFireworkSound, type FestivalFireworkSound } from '../utils/festivalFireworkAudio';
import '../styles/festivalEffects.css';

/** Decorative-only PC layer. All particles are deterministic; no timers, assets or data writes. */
const variation = (index: number, salt: number): number => {
  const value = Math.sin((index + 1) * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
};

type ParticleStyle = CSSProperties & Record<`--${string}`, string>;

// Three visual depths of six-branched snow crystals, legible on light and dark backgrounds.
// One compositor-friendly transform/opacity animation per particle, and no JS animation loop.
const SNOW = Array.from({ length: 56 }, (_, index) => {
  const depth = index % 5 < 2 ? 0 : index % 5 < 4 ? 1 : 2;
  const duration = (depth === 0 ? 19 : depth === 1 ? 13 : 9) + variation(index, 2) * (depth === 0 ? 9 : depth === 1 ? 7 : 5);
  const drift = (variation(index, 3) - 0.5) * (depth === 0 ? 95 : 150);
  const sway = (variation(index, 4) - 0.5) * (depth === 0 ? 24 : 46);
  return {
    depth,
    left: 1 + variation(index, 1) * 98,
    size: (depth === 0 ? 10 : depth === 1 ? 16 : 25) + variation(index, 5) * (depth === 0 ? 4 : depth === 1 ? 6 : 8),
    angle: Math.round(variation(index, 8) * 60),
    duration,
    delay: -variation(index, 6) * duration,
    drift25: Math.round(drift * 0.25 + sway),
    drift50: Math.round(drift * 0.5 - sway),
    drift75: Math.round(drift * 0.75 + sway * 0.6),
    drift100: Math.round(drift),
  };
});

const BLOSSOMS = Array.from({ length: 15 }, (_, index) => ({
  left: (index * 37 + 7) % 100,
  delay: -(index * 1.65) % 18,
  duration: 13 + (index * 5) % 9,
  size: 15 + (index * 3) % 9,
  apricot: index % 2 === 0,
}));

const FIREWORK_COLORS = [
  { main: '#dc3f7d', shine: '#ffd4e6' },
  { main: '#1975d2', shine: '#d7f6ff' },
  { main: '#d97706', shine: '#fff0b5' },
  { main: '#7c3aed', shine: '#eee0ff' },
  { main: '#0f8c81', shine: '#c6fff1' },
  { main: '#d04432', shine: '#ffe1c9' },
  { main: '#be288d', shine: '#ffd9f7' },
  { main: '#2066b4', shine: '#dce8ff' },
] as const;

// Bounded staggered rocket + explosion pairs; the snow and flower renderers are unchanged.
const BURSTS = Array.from({ length: 8 }, (_, index) => ({
  left: 10 + variation(index, 10) * 80,
  top: 12 + variation(index, 11) * 43,
  duration: 7.2,
  delay: -(index * 0.9 + variation(index, 12) * 0.35),
  scale: 0.75 + variation(index, 13) * 0.5,
  colors: FIREWORK_COLORS[index],
}));
const FIREWORK_RAYS = Array.from({ length: 26 }, (_, index) => ({
  // A small seeded angular jitter keeps the burst from looking like a clock face.
  angle: (index * 137.508 + variation(index, 20) * 24) % 360,
  distance: 21 + variation(index, 21) * 65,
  length: 10 + variation(index, 22) * 26,
  width: 1.2 + variation(index, 28) * 1.8,
}));
const FIREWORK_EMBERS = Array.from({ length: 16 }, (_, index) => {
  const angle = (index * 137.5 * Math.PI) / 180;
  const radius = 27 + variation(index, 23) * 78;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    size: 2 + variation(index, 24) * 2.5,
  };
});

/** Six-arm crystal, not a circular particle. SVG ensures consistent ❄ geometry across browsers. */
const SNOW_ARMS = [0, 60, 120, 180, 240, 300] as const;
const SNOW_ARM_PATH = 'M24 24V4 M18.5 10L24 15.5L29.5 10 M20.5 18.5L24 22L27.5 18.5';
function Snowflake() {
  return (
    <svg className="hnl-festival-crystal" viewBox="0 0 48 48" focusable="false" aria-hidden="true">
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {SNOW_ARMS.map(angle => (
          <g key={angle} transform={`rotate(${angle} 24 24)`}>
            <path className="hnl-festival-crystal-outline" d={SNOW_ARM_PATH} />
            <path className="hnl-festival-crystal-core" d={SNOW_ARM_PATH} />
          </g>
        ))}
      </g>
    </svg>
  );
}

function Flower({ yellow }: { yellow: boolean }) {
  return (
    <svg width="100%" height="100%" viewBox="0 0 40 40" focusable="false" aria-hidden="true">
      <g fill={yellow ? '#f8cf4b' : '#f6a2c3'} stroke={yellow ? '#e5a52b' : '#ea7da6'} strokeWidth="0.7">
        {[0, 72, 144, 216, 288].map(degree => (
          <ellipse key={degree} cx="20" cy="11.3" rx="7.1" ry="10" transform={`rotate(${degree} 20 20)`}/>
        ))}
      </g>
      <circle cx="20" cy="20" r="4.0" fill={yellow ? '#a86a19' : '#fbd74e'} />
    </svg>
  );
}

export const FestivalEffects: React.FC<{ mode: FestivalEffectMode; enabled: boolean }> = ({ mode, enabled }) => {
  const [ready, setReady] = useState(false);
  // Per-session, opt-in only. Audio never touches Firestore, storage, or shared UI settings.
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioSupported, setAudioSupported] = useState(true);
  const soundRef = useRef<FestivalFireworkSound | null>(null);
  const timersRef = useRef<Set<number>>(new Set());

  const stopAudio = useCallback(() => {
    timersRef.current.forEach(timeout => window.clearTimeout(timeout));
    timersRef.current.clear();
    soundRef.current?.stop();
    soundRef.current = null;
  }, []);

  useEffect(() => {
    if (!enabled || mode === 'off' || typeof window === 'undefined') { setReady(false); return; }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
      setReady(isFestivalPcRuntime() && !document.hidden && !reducedMotion.matches && !saveData);
    };
    update();
    window.addEventListener('resize', update, { passive: true });
    document.addEventListener('visibilitychange', update);
    reducedMotion.addEventListener?.('change', update);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('visibilitychange', update);
      reducedMotion.removeEventListener?.('change', update);
    };
  }, [mode, enabled]);

  useEffect(() => {
    // Changing mode, hiding a tab, resizing to mobile or reduced-motion must stop all sound.
    if (!ready || !enabled || mode !== 'fireworks') {
      stopAudio();
      setAudioEnabled(false);
    }
  }, [ready, mode, enabled, stopAudio]);
  useEffect(() => () => stopAudio(), [stopAudio]);

  const toggleAudio = () => {
    if (soundRef.current) {
      stopAudio();
      setAudioEnabled(false);
      return;
    }
    // This click is the only place that can create/resume an AudioContext.
    const sound = createFestivalFireworkSound();
    if (!sound) { setAudioSupported(false); return; }
    soundRef.current = sound;
    void sound.resume().then(() => {
      if (soundRef.current === sound) setAudioEnabled(true);
    }).catch(() => {
      if (soundRef.current === sound) {
        stopAudio();
        setAudioEnabled(false);
        setAudioSupported(false);
      }
    });
  };

  const onRocketLoop = (index: number, event: React.AnimationEvent<HTMLSpanElement>) => {
    if (event.target !== event.currentTarget || event.animationName !== 'hnl-firework-flight') return;
    const sound = soundRef.current;
    if (!audioEnabled || !sound || document.hidden) return;
    sound.launch(index);
    // Explosion enters its peak at 30% of the shared 7.2s CSS cycle.
    const timeout = window.setTimeout(() => {
      timersRef.current.delete(timeout);
      if (soundRef.current === sound && !document.hidden) sound.burst(index);
    }, 2160);
    timersRef.current.add(timeout);
  };

  if (!ready || !enabled || mode === 'off') return null;
  const isBloom = ['apricot', 'peach', 'blossoms'].includes(mode);
  return (
    <>
      <div className="hnl-festival-overlay" data-hnl-festival={mode} aria-hidden="true">
        {mode === 'snow' && SNOW.map((flake, index) => (
          <span key={index} className={`hnl-festival-snow hnl-festival-snow--depth-${flake.depth}`} style={{
            left: `${flake.left}%`, width: flake.size, height: flake.size,
            animationDelay: `${flake.delay}s`, animationDuration: `${flake.duration}s`,
            '--snow-x25': `${flake.drift25}px`, '--snow-x50': `${flake.drift50}px`,
            '--snow-x75': `${flake.drift75}px`, '--snow-x100': `${flake.drift100}px`,
            '--snow-turn': `${flake.angle}deg`,
          } as ParticleStyle}><Snowflake /></span>
        ))}
        {isBloom && BLOSSOMS.filter(p => mode === 'blossoms' || (mode === 'apricot' ? p.apricot : !p.apricot))
          .map((p, index) => (
            <span key={index} className="hnl-festival-flower" style={{
              left: `${p.left}%`, width: p.size, height: p.size,
              animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s`,
            }}><Flower yellow={p.apricot} /></span>
          ))}
        {mode === 'fireworks' && BURSTS.map((burst, index) => (
          <span key={index} className="hnl-festival-burst" style={{
            left: `${burst.left}%`, top: `${burst.top}%`,
            '--firework-scale': `${burst.scale}`, '--firework-main': burst.colors.main,
            '--firework-shine': burst.colors.shine,
          } as ParticleStyle}>
            <span className="hnl-festival-rocket" onAnimationIteration={event => onRocketLoop(index, event)} style={{
              animationDelay: `${burst.delay}s`, animationDuration: `${burst.duration}s`,
              '--rocket-sway': `${Math.round((variation(index, 31) - .5) * 30)}px`,
            } as ParticleStyle} />
            <span className="hnl-festival-explosion" style={{
              animationDelay: `${burst.delay}s`, animationDuration: `${burst.duration}s`,
            }}>
              <span className="hnl-festival-firework-flash" style={{
                animationDelay: `${burst.delay}s`, animationDuration: `${burst.duration}s`,
              }} />
              {FIREWORK_RAYS.map((ray, rayIndex) => (
                <span key={rayIndex} className="hnl-festival-ray" style={{
                  '--ray-angle': `${(ray.angle + variation(index * 29 + rayIndex, 29) * 19) % 360}deg`,
                  '--ray-distance': `${ray.distance * burst.scale}px`, '--ray-length': `${ray.length}px`,
                  '--ray-width': `${ray.width}px`,
                } as ParticleStyle} />
              ))}
              <span className="hnl-festival-ember-field" style={{
                animationDelay: `${burst.delay}s`, animationDuration: `${burst.duration}s`,
              }}>
                {FIREWORK_EMBERS.map((ember, emberIndex) => (
                  <span key={emberIndex} className="hnl-festival-ember" style={{
                    '--ember-x': `${ember.x}px`, '--ember-y': `${ember.y}px`,
                    width: ember.size, height: ember.size,
                  } as ParticleStyle} />
                ))}
              </span>
            </span>
          </span>
        ))}
      </div>
      {mode === 'fireworks' && (
        <div className="hnl-festival-audio-control" data-hnl-fireworks-audio="true">
          <button type="button" className="hnl-festival-audio-toggle" aria-pressed={audioEnabled}
            aria-label={audioSupported ? `Âm thanh pháo hoa: ${audioEnabled ? 'Bật' : 'Tắt'}` : 'Trình duyệt không hỗ trợ âm thanh pháo hoa'}
            title="Âm thanh pháo hoa chỉ bật khi bạn nhấn nút"
            disabled={!audioSupported} onClick={toggleAudio}>
            <span aria-hidden="true">{audioEnabled ? '🔊' : '🔇'}</span>
            <span>{audioSupported ? `Âm thanh: ${audioEnabled ? 'Bật' : 'Tắt'}` : 'Âm thanh không khả dụng'}</span>
          </button>
        </div>
      )}
    </>
  );
};
