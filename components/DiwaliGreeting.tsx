import React, { useEffect, useRef } from 'react';

/** How long the greeting stays, fade out included. */
export const DIWALI_GREETING_MS = 5000;

const TITLE = 'Happy Diwali';
const DIYAS = 7;
const COLORS = ['#fde047', '#fb923c', '#f472b6', '#fef3c7', '#facc15', '#c084fc'];
/** Rockets: x and burst height as parts of the window, launch second. */
const ROCKETS: [number, number, number][] = [
  [0.35, 0.22, 0.2],
  [0.72, 0.18, 0.75],
  [0.18, 0.3, 1.4],
  [0.55, 0.12, 1.9],
  [0.85, 0.32, 2.5],
  [0.3, 0.15, 3.0],
  [0.65, 0.26, 3.4],
];

interface Spark { x: number; y: number; vx: number; vy: number; life: number; c: string }
interface Rocket { x: number; y: number; ty: number; vy: number }

/** Fireworks on a canvas behind the words; nothing when the user asks for less motion. */
function useFireworks(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const size = () => {
      const dpr = window.devicePixelRatio || 1;
      cv.width = cv.clientWidth * dpr;
      cv.height = cv.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    window.addEventListener('resize', size);
    let sparks: Spark[] = [];
    let rockets: Rocket[] = [];
    const fired = ROCKETS.map(() => false);
    const start = performance.now();
    let raf = 0;
    const burst = (x: number, y: number) => {
      const c = COLORS[Math.floor(Math.random() * COLORS.length)];
      const c2 = COLORS[Math.floor(Math.random() * COLORS.length)];
      const n = 64;
      const sp = Math.max(cv.clientWidth, 600) / 260;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const v = sp * (0.6 + Math.random() * 0.6);
        sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, c: i % 3 ? c : c2 });
      }
    };
    const frame = (t: number) => {
      const el = (t - start) / 1000;
      const W = cv.clientWidth;
      const H = cv.clientHeight;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      ROCKETS.forEach(([x, y, at], i) => {
        if (!fired[i] && el >= at) {
          fired[i] = true;
          rockets.push({ x: x * W, y: H * 0.88, ty: y * H, vy: -H / 38 });
        }
      });
      rockets = rockets.filter((r) => {
        r.y += r.vy;
        r.vy *= 0.965;
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fde68a';
        ctx.beginPath();
        ctx.arc(r.x, r.y, 1.8, 0, 7);
        ctx.fill();
        if (r.y <= r.ty || r.vy > -1) {
          burst(r.x, r.y);
          return false;
        }
        return true;
      });
      sparks = sparks.filter((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.965;
        p.vy = p.vy * 0.965 + 0.035;
        p.life -= 0.014;
        if (p.life <= 0) return false;
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, 7);
        ctx.fill();
        return true;
      });
      ctx.globalAlpha = 1;
      if (el < DIWALI_GREETING_MS / 1000) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', size);
    };
  }, [canvasRef]);
}

/**
 * Happy Diwali over the whole window when a new project opens: night sky,
 * fireworks, a row of diyas lighting up. Gone after five seconds; a click or Esc ends it sooner.
 */
export const DiwaliGreeting: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useFireworks(canvasRef);

  useEffect(() => {
    const timer = window.setTimeout(() => doneRef.current(), DIWALI_GREETING_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Esc only ends the greeting; nothing behind it closes.
      e.preventDefault();
      e.stopPropagation();
      doneRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  return (
    <div className="diwali-greeting" role="status" aria-label="Happy Diwali" onClick={() => doneRef.current()}>
      <canvas ref={canvasRef} className="diwali-sky" aria-hidden="true" />
      <div className="diwali-words">
        <div className="diwali-title" aria-hidden="true">
          {[...TITLE].map((ch, i) => (
            <span key={i} style={{ '--i': i } as React.CSSProperties}>
              {ch === ' ' ? ' ' : ch}
            </span>
          ))}
        </div>
        <div className="diwali-sub">
          <em lang="hi">शुभ दीपावली</em> · may your new project shine
        </div>
      </div>
      <div className="diwali-row" aria-hidden="true">
        <svg width="0" height="0" style={{ position: 'absolute' }}>
          <defs>
            <radialGradient id="diwaliFlame" cx=".5" cy=".75" r=".7">
              <stop offset="0" stopColor="#fffbeb" />
              <stop offset=".4" stopColor="#fde047" />
              <stop offset="1" stopColor="#f97316" />
            </radialGradient>
            <radialGradient id="diwaliGlow">
              <stop offset="0" stopColor="#fdba74" stopOpacity=".6" />
              <stop offset="1" stopColor="#fdba74" stopOpacity="0" />
            </radialGradient>
          </defs>
        </svg>
        {Array.from({ length: DIYAS }, (_, i) => (
          <svg key={i} viewBox="0 0 40 40" style={{ '--i': i } as React.CSSProperties}>
            <ellipse className="diwali-glow" cx="20" cy="14" rx="18" ry="16" fill="url(#diwaliGlow)" />
            <path className="diwali-flame" d="M20 2 C24 9 25 14 20 19 C15 14 16 9 20 2 Z" fill="url(#diwaliFlame)" />
            <path d="M4 20 Q20 23 36 20 Q33 34 20 35 Q7 34 4 20 Z" fill="#b45309" />
            <path d="M4 20 Q20 23 36 20 Q20 17 4 20 Z" fill="#7c2d12" />
          </svg>
        ))}
      </div>
      <div className="diwali-skip">Click to skip</div>
    </div>
  );
};
