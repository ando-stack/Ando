import {interpolate, useCurrentFrame} from 'remotion';
import {C} from './theme';

// Búho original y simplificado (no es el logo oficial).
export const Owl: React.FC<{size?: number; happy?: boolean}> = ({size = 500, happy}) => {
  const f = useCurrentFrame();
  // Parpadeo cada ~2.5 s
  const t = f % 75;
  const blink = t > 68 ? interpolate(t, [68, 71, 75], [1, 0.1, 1], {extrapolateRight: 'clamp'}) : 1;
  const bob = Math.sin(f / 8) * 8;
  const wing = Math.sin(f / 5) * 10;
  return (
    <svg width={size} height={size} viewBox="0 0 400 400" style={{transform: `translateY(${bob}px)`, overflow: 'visible'}}>
      {/* sombra */}
      <ellipse cx="200" cy="385" rx="120" ry="14" fill="rgba(0,0,0,0.15)" />
      {/* alas */}
      <g transform={`rotate(${-wing} 85 230)`}>
        <ellipse cx="70" cy="240" rx="40" ry="80" fill={C.greenDark} />
      </g>
      <g transform={`rotate(${wing} 315 230)`}>
        <ellipse cx="330" cy="240" rx="40" ry="80" fill={C.greenDark} />
      </g>
      {/* cuerpo */}
      <rect x="80" y="70" width="240" height="300" rx="120" fill={C.green} />
      {/* orejas */}
      <path d="M95 110 L110 40 L160 85 Z" fill={C.green} />
      <path d="M305 110 L290 40 L240 85 Z" fill={C.green} />
      {/* panza */}
      <ellipse cx="200" cy="285" rx="85" ry="75" fill="#89E219" />
      {/* ojos */}
      {[150, 250].map((x) => (
        <g key={x}>
          <circle cx={x} cy="165" r="50" fill={C.white} />
          <g transform={`translate(0 ${165 * (1 - blink)}) scale(1 ${blink})`}>
            <circle cx={x + 5} cy="170" r="24" fill={C.ink} />
            <circle cx={x + 13} cy="160" r="8" fill={C.white} />
          </g>
        </g>
      ))}
      {/* pico */}
      <path d="M180 210 Q200 200 220 210 L200 245 Z" fill={C.orange} />
      {happy && <path d="M170 255 Q200 280 230 255" stroke={C.greenDark} strokeWidth="8" fill="none" strokeLinecap="round" />}
      {/* patas */}
      <rect x="150" y="360" width="30" height="18" rx="9" fill={C.orange} />
      <rect x="220" y="360" width="30" height="18" rx="9" fill={C.orange} />
    </svg>
  );
};
