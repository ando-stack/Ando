import {
  AbsoluteFill, Img, interpolate, random, spring, staticFile, useCurrentFrame, useVideoConfig, Easing, Sequence,
} from 'remotion';
import {loadFont as loadAnton} from '@remotion/google-fonts/Anton';
import {loadFont as loadInter} from '@remotion/google-fonts/Inter';

const {fontFamily: anton} = loadAnton();
const {fontFamily: inter} = loadInter('normal', {weights: ['700', '900']});

const RED = '#E10600';
const GOLD = '#F5C518';
const BLACK = '#0A0A0A';
const NICK = 'PEREIRA7';
const REAL = 'PABLO PEREIRA RAMOS';

// Duración de cada escena (frames a 30 fps)
const D = {intro: 75, hero: 120, roles: 120, collage: 120, outro: 150};
export const TOTAL_FRAMES = D.intro + D.hero + D.roles + D.collage + D.outro;

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

/* ---------- Utilidades visuales ---------- */

// Temblor de cámara que se apaga solo
const useShake = (at: number, power = 25, len = 12) => {
  const f = useCurrentFrame();
  const k = interpolate(f - at, [0, len], [1, 0], clamp) * (f >= at ? 1 : 0);
  return `translate(${(random(`x${f}`) - 0.5) * power * k}px, ${(random(`y${f}`) - 0.5) * power * k}px)`;
};

// Destello blanco
const Flash: React.FC<{at: number; len?: number}> = ({at, len = 8}) => {
  const f = useCurrentFrame();
  const o = interpolate(f - at, [0, 1, len], [0, 0.9, 0], clamp);
  return <AbsoluteFill style={{background: 'white', opacity: o, pointerEvents: 'none'}} />;
};

// Grano de película + viñeta, encima de todo
const Grain: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <svg width="100%" height="100%" style={{opacity: 0.12, mixBlendMode: 'overlay'}}>
        <filter id="n">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={f % 10} />
        </filter>
        <rect width="100%" height="100%" filter="url(#n)" />
      </svg>
      <AbsoluteFill style={{background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.7) 100%)'}} />
    </AbsoluteFill>
  );
};

// Rayos que giran detrás del personaje
const Rays: React.FC<{color: string; opacity?: number}> = ({color, opacity = 0.25}) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', opacity}}>
      <div style={{
        width: 3000, height: 3000, transform: `rotate(${f * 0.4}deg)`,
        background: `repeating-conic-gradient(${color} 0deg 6deg, transparent 6deg 18deg)`,
        maskImage: 'radial-gradient(circle, black 0%, transparent 60%)',
        WebkitMaskImage: 'radial-gradient(circle, black 0%, transparent 60%)',
      }} />
    </AbsoluteFill>
  );
};

// Texto gigante que se desplaza en bucle
const Marquee: React.FC<{text: string; y: number; speed: number; size?: number; outline?: boolean; color?: string; rotate?: number}> = ({
  text, y, speed, size = 260, outline, color = 'white', rotate = 0,
}) => {
  const f = useCurrentFrame();
  const line = Array(8).fill(text).join('  ·  ');
  return (
    <div style={{
      position: 'absolute', top: y, left: -400, whiteSpace: 'nowrap', fontFamily: anton, fontSize: size, lineHeight: 1,
      transform: `rotate(${rotate}deg) translateX(${(f * speed) % 2000 - 1000}px)`,
      color: outline ? 'transparent' : color, WebkitTextStroke: outline ? `3px ${color}` : undefined,
    }}>
      {line}
    </div>
  );
};

// Franjas diagonales que barren la pantalla
const Slashes: React.FC<{at?: number}> = ({at = 0}) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      {[RED, GOLD, 'white'].map((c, i) => {
        const p = interpolate(f - at - i * 3, [0, 14], [-1, 1.2], {...clamp, easing: Easing.inOut(Easing.cubic)});
        return (
          <div key={c} style={{
            position: 'absolute', top: -300, left: `${p * 140}%`, width: 120 - i * 30, height: 1700,
            background: c, transform: 'rotate(25deg)',
          }} />
        );
      })}
    </AbsoluteFill>
  );
};

// Texto que cae de golpe (escala grande -> normal)
const Slam: React.FC<{children: React.ReactNode; at: number; style?: React.CSSProperties}> = ({children, at, style}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = spring({frame: f - at, fps, config: {damping: 14, stiffness: 220}});
  return (
    <div style={{
      transform: `scale(${interpolate(s, [0, 1], [3, 1])})`, opacity: interpolate(f - at, [0, 3], [0, 1], clamp),
      filter: `blur(${interpolate(s, [0, 1], [12, 0])}px)`, ...style,
    }}>
      {children}
    </div>
  );
};

/* ---------- Escena 1: intro ---------- */
const Intro: React.FC = () => {
  const f = useCurrentFrame();
  const shake = useShake(20, 40, 14);
  const glitch = f > 50 && f < 58 ? (random(`g${f}`) - 0.5) * 40 : 0;
  const redPulse = interpolate(f, [0, 20, 30], [0, 0.6, 0.15], clamp);
  return (
    <AbsoluteFill style={{background: BLACK, transform: shake}}>
      <AbsoluteFill style={{background: `radial-gradient(circle, ${RED} 0%, transparent 60%)`, opacity: redPulse}} />
      <Slashes at={2} />
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', flexDirection: 'column'}}>
        <Slam at={20}>
          <div style={{position: 'relative', fontFamily: anton, fontSize: 330, color: 'white', letterSpacing: 6, lineHeight: 1}}>
            <span style={{position: 'absolute', left: glitch, color: RED, mixBlendMode: 'screen', opacity: glitch ? 1 : 0}}>{NICK}</span>
            <span style={{position: 'absolute', left: -glitch, color: '#00E5FF', mixBlendMode: 'screen', opacity: glitch ? 1 : 0}}>{NICK}</span>
            {NICK}
          </div>
        </Slam>
        <div style={{
          fontFamily: inter, fontWeight: 900, fontSize: 40, color: GOLD, letterSpacing: interpolate(f, [30, 70], [4, 22], clamp),
          opacity: interpolate(f, [32, 42], [0, 1], clamp), marginTop: 20,
        }}>
          LLEGA EL MOMENTO
        </div>
      </AbsoluteFill>
      <Flash at={20} />
    </AbsoluteFill>
  );
};

/* ---------- Escena 2: héroe con cinturón ---------- */
const Hero: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const rise = spring({frame: f - 4, fps, config: {damping: 16, stiffness: 90}});
  const zoom = interpolate(f, [0, D.hero], [1, 1.08]);
  const plate = spring({frame: f - 30, fps, config: {damping: 18}});
  return (
    <AbsoluteFill style={{background: `linear-gradient(180deg, #1a0000 0%, ${BLACK} 70%)`, overflow: 'hidden'}}>
      <Rays color={GOLD} opacity={0.18} />
      <Marquee text={NICK} y={120} speed={-6} outline color="rgba(255,255,255,0.35)" />
      <Marquee text={NICK} y={600} speed={6} outline color={RED} />
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'flex-end', transform: `scale(${zoom})`}}>
        <Img src={staticFile('cut5.png')} style={{
          height: 1020, transform: `translateY(${(1 - rise) * 900}px)`,
          filter: `drop-shadow(0 0 40px ${RED}) drop-shadow(0 0 4px ${GOLD})`,
        }} />
      </AbsoluteFill>
      {/* Placa con el nombre real */}
      <div style={{position: 'absolute', left: 90, bottom: 110, transform: `translateX(${(1 - plate) * -900}px)`}}>
        <div style={{background: RED, padding: '14px 34px', fontFamily: anton, fontSize: 96, color: 'white', lineHeight: 1}}>{NICK}</div>
        <div style={{background: 'white', padding: '10px 34px', fontFamily: inter, fontWeight: 900, fontSize: 34, color: BLACK, display: 'inline-block', letterSpacing: 3}}>
          {REAL}
        </div>
      </div>
      {/* Esquina con texto dorado */}
      <div style={{
        position: 'absolute', right: 90, top: 90, fontFamily: anton, fontSize: 70, color: GOLD, textAlign: 'right', lineHeight: 1,
        opacity: interpolate(f, [40, 55], [0, 1], clamp), transform: `translateY(${interpolate(f, [40, 55], [-30, 0], clamp)}px)`,
      }}>
        EL CINTURÓN<br /><span style={{color: 'white'}}>SE QUEDA EN CASA</span>
      </div>
      <Flash at={0} len={10} />
    </AbsoluteFill>
  );
};

/* ---------- Escena 3: facetas ---------- */
const ROLES = ['STREAMER', 'LUCHADOR', 'SHOWMAN'];
const Roles: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame: f, fps, config: {damping: 15}});
  const idx = Math.min(ROLES.length - 1, Math.floor(f / 30));
  const local = f - idx * 30;
  const shake = useShake(idx * 30, 30, 8);
  return (
    <AbsoluteFill style={{background: RED, overflow: 'hidden', transform: shake}}>
      <Marquee text={ROLES.join('  ')} y={-40} speed={-10} size={300} color="rgba(0,0,0,0.18)" />
      <Marquee text={ROLES.join('  ')} y={760} speed={10} size={300} color="rgba(0,0,0,0.18)" />
      {/* Bloque negro diagonal a la izquierda */}
      <div style={{position: 'absolute', left: -300, top: -200, width: 1300, height: 1600, background: BLACK, transform: `rotate(12deg) translateX(${(1 - enter) * -1400}px)`}} />
      <Img src={staticFile('cut3.png')} style={{
        position: 'absolute', left: 120, bottom: 0, height: 1000, transform: `translateX(${(1 - enter) * -900}px)`,
        filter: 'drop-shadow(0 0 30px rgba(0,0,0,0.8))',
      }} />
      <div style={{position: 'absolute', right: 110, top: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-end'}}>
        {ROLES.map((r, i) => {
          const s = spring({frame: f - i * 30, fps, config: {damping: 12, stiffness: 200}});
          const active = i === idx;
          return (
            <div key={r} style={{
              fontFamily: anton, fontSize: active ? 200 : 120, lineHeight: 1.05, color: active ? 'white' : 'transparent',
              WebkitTextStroke: active ? undefined : '3px white', opacity: f >= i * 30 ? 1 : 0,
              transform: `translateX(${(1 - s) * 600}px) skewX(-8deg)`,
            }}>
              {r}
            </div>
          );
        })}
        <div style={{height: 14, background: GOLD, marginTop: 30, width: interpolate(local, [0, 20], [0, 620], clamp)}} />
      </div>
      <Flash at={idx * 30} len={6} />
    </AbsoluteFill>
  );
};

/* ---------- Escena 4: collage de fotos ---------- */
const CARDS = [
  {src: 'foto1.jpg', x: 260, y: 300, w: 420, r: -8, d: 0},
  {src: 'foto2.jpg', x: 960, y: 230, w: 640, r: 4, d: 10},
  {src: 'foto4.jpg', x: 1640, y: 330, w: 340, r: 9, d: 20},
];
const Collage: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const pan = interpolate(f, [0, D.collage], [20, -20]);
  const title = spring({frame: f - 35, fps, config: {damping: 13}});
  return (
    <AbsoluteFill style={{background: BLACK, overflow: 'hidden'}}>
      <AbsoluteFill style={{background: `radial-gradient(circle at 50% 40%, #3a0000 0%, ${BLACK} 60%)`}} />
      <div style={{position: 'absolute', inset: 0, transform: `translateX(${pan}px)`}}>
        {CARDS.map((c) => {
          const s = spring({frame: f - c.d, fps, config: {damping: 12, stiffness: 140}});
          return (
            <div key={c.src} style={{
              position: 'absolute', left: c.x, top: c.y, width: c.w, padding: 14, paddingBottom: 50, background: 'white',
              transform: `translate(-50%, ${(1 - s) * 1200}px) rotate(${c.r * s + (1 - s) * 30}deg)`,
              boxShadow: '0 30px 60px rgba(0,0,0,0.6)',
            }}>
              <Img src={staticFile(c.src)} style={{width: '100%', display: 'block'}} />
            </div>
          );
        })}
      </div>
      {CARDS.map((c) => <Flash key={c.src} at={c.d + 6} len={5} />)}
      <div style={{position: 'absolute', left: 0, right: 0, bottom: 90, textAlign: 'center', transform: `scale(${title})`}}>
        <span style={{fontFamily: anton, fontSize: 130, color: 'white', background: RED, padding: '0 40px', lineHeight: 1.15}}>
          DENTRO Y FUERA <span style={{color: GOLD}}>DEL RING</span>
        </span>
      </div>
    </AbsoluteFill>
  );
};

/* ---------- Escena 5: cierre ---------- */
const Outro: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const left = spring({frame: f - 2, fps, config: {damping: 16}});
  const right = spring({frame: f - 8, fps, config: {damping: 16}});
  const shake = useShake(24, 35, 12);
  const live = Math.sin(f / 4) > 0;
  const cta = spring({frame: f - 50, fps, config: {damping: 11}});
  return (
    <AbsoluteFill style={{background: BLACK, overflow: 'hidden', transform: shake}}>
      <Rays color={RED} opacity={0.3} />
      {/* Fotos a ambos lados */}
      <Img src={staticFile('cut1.png')} style={{
        position: 'absolute', left: -40, bottom: 0, height: 760, transform: `translateX(${(1 - left) * -800}px)`,
        maskImage: 'linear-gradient(to right, black 70%, transparent)', WebkitMaskImage: 'linear-gradient(to right, black 70%, transparent)',
      }} />
      <Img src={staticFile('cut2.png')} style={{
        position: 'absolute', right: -120, bottom: 0, height: 900, transform: `translateX(${(1 - right) * 900}px)`,
        maskImage: 'linear-gradient(to bottom, black 75%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, black 75%, transparent)',
      }} />
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', flexDirection: 'column'}}>
        <Slam at={24}>
          <div style={{fontFamily: anton, fontSize: 290, color: 'white', lineHeight: 1, textShadow: `0 0 60px ${RED}, 8px 8px 0 ${RED}`}}>{NICK}</div>
        </Slam>
        <div style={{fontFamily: inter, fontWeight: 900, fontSize: 38, color: GOLD, letterSpacing: 12, opacity: interpolate(f, [34, 44], [0, 1], clamp)}}>
          {REAL}
        </div>
        <div style={{
          marginTop: 50, display: 'flex', alignItems: 'center', gap: 22, background: 'white', padding: '22px 48px', borderRadius: 999,
          transform: `scale(${cta})`, boxShadow: `0 0 0 ${8 + Math.sin(f / 5) * 6}px rgba(225,6,0,0.5)`,
        }}>
          <div style={{width: 34, height: 34, borderRadius: 17, background: RED, opacity: live ? 1 : 0.35}} />
          <span style={{fontFamily: anton, fontSize: 60, color: BLACK, letterSpacing: 2}}>SÍGUELO EN DIRECTO</span>
        </div>
      </AbsoluteFill>
      <Flash at={24} len={10} />
      {/* Fundido final a negro */}
      <AbsoluteFill style={{background: 'black', opacity: interpolate(f, [D.outro - 15, D.outro], [0, 1], clamp)}} />
    </AbsoluteFill>
  );
};

export const Pereira7: React.FC = () => {
  let t = 0;
  const scenes: [number, React.ReactNode][] = [
    [D.intro, <Intro key="i" />], [D.hero, <Hero key="h" />], [D.roles, <Roles key="r" />],
    [D.collage, <Collage key="c" />], [D.outro, <Outro key="o" />],
  ];
  return (
    <AbsoluteFill style={{background: BLACK}}>
      {scenes.map(([len, node], i) => {
        const from = t;
        t += len;
        return <Sequence key={i} from={from} durationInFrames={len}>{node}</Sequence>;
      })}
      <Grain />
    </AbsoluteFill>
  );
};
