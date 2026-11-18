import React, { useEffect, useState, type CSSProperties } from 'react';
import { isFestivalPcRuntime, type FestivalEffectMode } from '../utils/festivalEffectMode';
import '../styles/festivalEffects.css';

/** Decorative-only PC layer. All particles are deterministic; no timers, assets or data writes. */
const variation = (index: number, salt: number): number => {
  const value = Math.sin((index + 1) * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
};

type ParticleStyle = CSSProperties & Record<`--${string}`, string>;

// Three visual depths: distant powder, mid-distance flakes and a few nearby flakes.
// One compositor-friendly transform/opacity animation per particle, and no JS animation loop.
const SNOW = Array.from({ length: 56 }, (_, index) => {
  const depth = index % 5 < 2 ? 0 : index % 5 < 4 ? 1 : 2;
  const duration = (depth === 0 ? 19 : depth === 1 ? 13 : 9) + variation(index, 2) * (depth === 0 ? 9 : depth === 1 ? 7 : 5);
  const drift = (variation(index, 3) - 0.5) * (depth === 0 ? 95 : 150);
  const sway = (variation(index, 4) - 0.5) * (depth === 0 ? 24 : 46);
  return {
    depth,
    left: 1 + variation(index, 1) * 98,
    size: (depth === 0 ? 2.1 : depth === 1 ? 4.2 : 7.2) + variation(index, 5) * (depth === 0 ? 2.3 : depth === 1 ? 2.8 : 3.7),
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

// More frequent, overlapping fireworks, but only eight parent transforms are animated.
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
  if (!ready || !enabled || mode === 'off') return null;
  const isBloom = ['apricot', 'peach', 'blossoms'].includes(mode);
  return (
    <div className="hnl-festival-overlay" data-hnl-festival={mode} aria-hidden="true">
      {mode === 'snow' && SNOW.map((flake, index) => (
        <span key={index} className={`hnl-festival-snow hnl-festival-snow--depth-${flake.depth}`} style={{
          left: `${flake.left}%`, width: flake.size, height: flake.size,
          animationDelay: `${flake.delay}s`, animationDuration: `${flake.duration}s`,
          '--snow-x25': `${flake.drift25}px`, '--snow-x50': `${flake.drift50}px`,
          '--snow-x75': `${flake.drift75}px`, '--snow-x100': `${flake.drift100}px`,
        } as ParticleStyle} />
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
          animationDelay: `${burst.delay}s`, animationDuration: `${burst.duration}s`,
          '--firework-scale': `${burst.scale}`, '--firework-main': burst.colors.main,
          '--firework-shine': burst.colors.shine,
        } as ParticleStyle}>
          <span className="hnl-festival-firework-flash" />
          {FIREWORK_RAYS.map((ray, rayIndex) => (
            <span key={rayIndex} className="hnl-festival-ray" style={{
              '--ray-angle': `${(ray.angle + variation(index * 29 + rayIndex, 29) * 19) % 360}deg`,
              '--ray-distance': `${ray.distance * burst.scale}px`, '--ray-length': `${ray.length}px`,
              '--ray-width': `${ray.width}px`,
            } as ParticleStyle} />
          ))}
          {FIREWORK_EMBERS.map((ember, emberIndex) => (
            <span key={emberIndex} className="hnl-festival-ember" style={{
              '--ember-x': `${ember.x}px`, '--ember-y': `${ember.y}px`,
              width: ember.size, height: ember.size,
            } as ParticleStyle} />
          ))}
        </span>
      ))}
    </div>
  );
};
