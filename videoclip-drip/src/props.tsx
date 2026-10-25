import {AbsoluteFill, Img, interpolate, random, staticFile, useCurrentFrame} from 'remotion';
import {anton, BEAT, MONEY} from './theme';

/* Fase del beat: 1 justo en el golpe y cae a 0 */
export const usePunch = (k = 6) => {
  const f = useCurrentFrame();
  return Math.exp(-((f % BEAT) / BEAT) * k);
};

/* ---------- Coche deportivo (vista lateral, mira a la derecha) ---------- */
const Wheel: React.FC<{cx: number; spin: number}> = ({cx, spin}) => (
  <g transform={`translate(${cx} 262)`}>
    <circle r="64" fill="#0b0b0b" />
    <circle r="46" fill="url(#rim)" />
    <g transform={`rotate(${spin})`}>
      {[0, 72, 144, 216, 288].map((a) => (
        <rect key={a} x="-5" y="-44" width="10" height="40" rx="4" fill="#2a2a2a" transform={`rotate(${a})`} />
      ))}
    </g>
    <circle r="10" fill="#c9c9c9" />
    <circle r="54" fill="none" stroke="#D11" strokeWidth="5" strokeDasharray="30 310" transform="rotate(-40)" />
  </g>
);

export const Car: React.FC<{width: number; spin?: number; lights?: number; color?: string}> = ({
  width, spin = 0, lights = 1, color = '#121212',
}) => (
  <svg width={width} height={width * 0.34} viewBox="0 0 1000 340" style={{overflow: 'visible'}}>
    <defs>
      <linearGradient id="paint" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#6b6b6b" />
        <stop offset="0.25" stopColor={color} />
        <stop offset="0.6" stopColor={color} />
        <stop offset="1" stopColor="#000" />
      </linearGradient>
      <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#3b4a66" />
        <stop offset="0.5" stopColor="#0d1220" />
        <stop offset="1" stopColor="#2a3550" />
      </linearGradient>
      <radialGradient id="rim">
        <stop offset="0" stopColor="#f2f2f2" />
        <stop offset="0.7" stopColor="#8d8d8d" />
        <stop offset="1" stopColor="#d0d0d0" />
      </radialGradient>
      <radialGradient id="beam">
        <stop offset="0" stopColor="rgba(255,250,220,0.9)" />
        <stop offset="1" stopColor="rgba(255,250,220,0)" />
      </radialGradient>
    </defs>
    <ellipse cx="500" cy="318" rx="470" ry="20" fill="rgba(0,0,0,0.7)" />
    {/* haz de luz de los faros */}
    <ellipse cx="1150" cy="230" rx="260" ry="60" fill="url(#beam)" opacity={0.6 * lights} />
    <path
      d="M30 245 C30 215 50 200 90 195 L250 180 C300 150 370 110 450 95 C540 80 640 82 720 110 C770 128 810 160 850 175 L940 190 C965 195 975 215 975 235 L975 255 C975 265 965 272 955 272 L45 272 C35 272 30 262 30 255 Z"
      fill="url(#paint)"
    />
    <path d="M300 178 C360 140 420 112 480 104 C560 95 640 98 700 122 L760 172 Z" fill="url(#glass)" />
    <path d="M520 100 L510 176" stroke={color} strokeWidth="10" />
    <path d="M90 214 C300 205 700 200 935 207" stroke="rgba(255,255,255,0.35)" strokeWidth="3" fill="none" />
    <path d="M520 180 L515 262" stroke="rgba(0,0,0,0.6)" strokeWidth="3" />
    <path d="M380 112 C480 92 600 92 690 115" stroke="rgba(255,255,255,0.5)" strokeWidth="3" fill="none" />
    {/* pasos de rueda */}
    <circle cx="215" cy="262" r="74" fill="#050505" />
    <circle cx="790" cy="262" r="74" fill="#050505" />
    <rect x="100" y="262" width="800" height="12" fill={color} />
    <Wheel cx={215} spin={spin} />
    <Wheel cx={790} spin={spin} />
    {/* faro y piloto */}
    <path d="M905 198 L962 206 L958 222 L915 216 Z" fill={`rgba(255,250,225,${0.3 + 0.7 * lights})`} />
    <circle cx="945" cy="212" r="26" fill="rgba(255,250,220,0.5)" opacity={lights} style={{filter: 'blur(8px)'}} />
    <path d="M32 222 L70 214 L72 228 L34 236 Z" fill="#ff1a2d" />
    <circle cx="45" cy="226" r="20" fill="rgba(255,30,50,0.6)" style={{filter: 'blur(8px)'}} />
  </svg>
);

/* ---------- Billete ---------- */
export const Bill: React.FC<{w?: number}> = ({w = 220}) => (
  <svg width={w} height={w * 0.45} viewBox="0 0 220 100">
    <rect width="220" height="100" rx="6" fill={MONEY} />
    <rect x="6" y="6" width="208" height="88" rx="4" fill="none" stroke="#2F5D2A" strokeWidth="3" />
    <ellipse cx="110" cy="50" rx="30" ry="36" fill="#5A8F48" stroke="#2F5D2A" strokeWidth="2" />
    <text x="110" y="64" fontSize="42" textAnchor="middle" fill="#1f3f1c" fontFamily={anton}>$</text>
    <text x="20" y="34" fontSize="22" fill="#1f3f1c" fontFamily={anton}>100</text>
    <text x="200" y="86" fontSize="22" fill="#1f3f1c" fontFamily={anton} textAnchor="end">100</text>
  </svg>
);

/* Lluvia de billetes que giran en 3D */
export const MoneyRain: React.FC<{count?: number; speed?: number; seed?: string}> = ({count = 30, speed = 1, seed = 'm'}) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{pointerEvents: 'none', overflow: 'hidden'}}>
      {Array.from({length: count}).map((_, i) => {
        const r = (k: string) => random(`${seed}${i}${k}`);
        const v = (3 + r('v') * 5) * speed;
        const y = ((r('y') * 1400 + f * v) % 1400) - 200;
        const x = r('x') * 2000 - 40 + Math.sin(f / 15 + i) * 40;
        const flip = Math.cos(f / (6 + r('f') * 8) + i);
        const size = 90 + r('s') * 110;
        return (
          <div key={i} style={{
            position: 'absolute', left: x, top: y, transform: `rotate(${r('r') * 360 + f * (r('d') - 0.5) * 4}deg) scaleY(${flip})`,
            filter: r('b') > 0.7 ? 'blur(3px)' : undefined, opacity: 0.95,
          }}>
            <Bill w={size} />
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

/* Fajo de billetes con faja "$10K" (racks), en perspectiva */
export const Rack: React.FC<{w?: number; layers?: number}> = ({w = 260, layers = 22}) => {
  const top = w * 0.45 * 0.42; // billete de arriba visto en perspectiva
  const side = layers * 7;
  return (
    <div style={{position: 'relative', width: w, height: top + side, filter: 'drop-shadow(0 20px 20px rgba(0,0,0,0.6))'}}>
      {/* cara lateral: cantos de los billetes */}
      <div style={{
        position: 'absolute', left: 0, top: top, width: w, height: side, borderRadius: 4,
        background: 'repeating-linear-gradient(180deg, #8fc87b 0px, #8fc87b 4px, #4f7f42 4px, #4f7f42 7px)',
      }} />
      {/* cara superior */}
      <div style={{position: 'absolute', left: 0, top: 0, height: top, overflow: 'visible'}}>
        <div style={{transform: `scaleY(0.42)`, transformOrigin: 'top left'}}><Bill w={w} /></div>
      </div>
      {/* faja */}
      <div style={{
        position: 'absolute', left: w * 0.4, top: 0, width: w * 0.2, height: top + side,
        background: 'linear-gradient(90deg,#c8a94f,#fff1b8,#c8a94f)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{fontFamily: anton, fontSize: w * 0.1, color: '#3a2a00'}}>$10K</span>
      </div>
    </div>
  );
};

/* Destellos tipo diamante */
export const Sparkles: React.FC<{count?: number; area?: [number, number, number, number]; seed?: string; size?: number}> = ({
  count = 14, area = [0, 0, 1920, 1080], seed = 's', size = 60,
}) => {
  const f = useCurrentFrame();
  const [x0, y0, w, h] = area;
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {Array.from({length: count}).map((_, i) => {
        const period = 20 + Math.floor(random(`${seed}p${i}`) * 25);
        const t = ((f + random(`${seed}o${i}`) * period) % period) / period;
        const s = Math.sin(t * Math.PI) ** 3;
        const sz = size * (0.5 + random(`${seed}z${i}`));
        return (
          <svg key={i} width={sz} height={sz} viewBox="-50 -50 100 100" style={{
            position: 'absolute', left: x0 + random(`${seed}x${i}`) * w - sz / 2, top: y0 + random(`${seed}y${i}`) * h - sz / 2,
            transform: `scale(${s}) rotate(${t * 90}deg)`, filter: 'drop-shadow(0 0 8px white)',
          }}>
            <path d="M0 -50 L8 -8 L50 0 L8 8 L0 50 L-8 8 L-50 0 L-8 -8 Z" fill="white" />
          </svg>
        );
      })}
    </AbsoluteFill>
  );
};

/* Persona recortada con efecto 2.5D: respiración, golpe en el beat, luz de borde y brillo que la recorre */
export const Person: React.FC<{
  src: string; height: number; left?: number; right?: number; bottom?: number; rim?: string; enter?: number; sheenAt?: number; mirror?: boolean;
}> = ({src, height, left, right, bottom = 0, rim = '#B14CFF', enter = 1, sheenAt = 0, mirror}) => {
  const f = useCurrentFrame();
  const punch = usePunch(7);
  const breathe = 1 + Math.sin(f / 14) * 0.008;
  const sway = Math.sin(f / 40) * 1.2;
  const sheen = interpolate((f - sheenAt) % 90, [0, 30], [-60, 160], {extrapolateRight: 'clamp'});
  const url = staticFile(src);
  return (
    <div style={{
      position: 'absolute', left, right, bottom, height,
      transform: `translateY(${(1 - enter) * height}px) translateY(${-punch * 8}px) rotate(${sway}deg) scale(${(mirror ? -1 : 1) * breathe}, ${breathe + punch * 0.01})`,
      transformOrigin: 'bottom center', opacity: Math.min(1, enter * 1.5),
    }}>
      <Img src={url} style={{height: '100%', display: 'block', filter: `drop-shadow(0 0 2px ${rim}) drop-shadow(0 0 30px ${rim}) drop-shadow(0 40px 40px rgba(0,0,0,0.8))`}} />
      {/* brillo que barre la figura */}
      <div style={{
        position: 'absolute', inset: 0, mixBlendMode: 'overlay',
        background: `linear-gradient(105deg, transparent ${sheen - 20}%, rgba(255,255,255,0.8) ${sheen}%, transparent ${sheen + 20}%)`,
        maskImage: `url(${url})`, WebkitMaskImage: `url(${url})`, maskSize: '100% 100%', WebkitMaskSize: '100% 100%',
      }} />
    </div>
  );
};
