import React, { useEffect, useState } from 'react';
import { isFestivalPcRuntime, type FestivalEffectMode } from '../utils/festivalEffectMode';
import '../styles/festivalEffects.css';

/** Decorative-only layer. No user input, timers, assets, or application data writes. */
const SNOW = Array.from({ length: 24 }, (_, index) => ({
  left: (index * 37 + 11) % 100,
  delay: -(index * 1.19) % 15,
  duration: 11 + (index * 7) % 9,
  size: 3 + (index * 3) % 5,
}));
const BLOSSOMS = Array.from({ length: 15 }, (_, index) => ({
  left: (index * 37 + 7) % 100,
  delay: -(index * 1.65) % 18,
  duration: 13 + (index * 5) % 9,
  size: 15 + (index * 3) % 9,
  apricot: index % 2 === 0,
}));
const BURSTS = Array.from({ length: 5 }, (_, index) => ({
  left: 14 + (index * 19) % 73,
  top: 13 + (index * 17) % 38,
  delay: -(index * 1.4),
}));

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
      {mode === 'snow' && SNOW.map((p, index) => (
        <span key={index} className="hnl-festival-snow" style={{
          left: `${p.left}%`, width: p.size, height: p.size,
          animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s`,
        }} />
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
          left: `${burst.left}%`, top: `${burst.top}%`, animationDelay: `${burst.delay}s`,
        }}>
          {Array.from({ length: 10 }, (_, ray) => (
            <span key={ray} className="hnl-festival-ray" style={{
              transform: `rotate(${ray * 36}deg)`,
              background: index % 2 ? '#f9b44b' : ray % 2 ? '#83dcff' : '#f49bc5',
            }} />
          ))}
        </span>
      ))}
    </div>
  );
};
