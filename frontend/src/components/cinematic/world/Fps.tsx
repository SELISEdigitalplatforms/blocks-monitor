import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';

/** Dev-only frame counter: writes into #fps twice a second (no React re-renders). */
export function Fps() {
  const acc = useRef({ n: 0, t: 0 });
  useFrame((_, dt) => {
    const a = acc.current;
    a.n++;
    a.t += dt;
    if (a.t >= 0.5) {
      const el = document.getElementById('fps');
      if (el) el.textContent = `${Math.round(a.n / a.t)} fps`;
      (window as unknown as { __fps: number }).__fps = Math.round(a.n / a.t);
      a.n = 0;
      a.t = 0;
    }
  });
  return null;
}
