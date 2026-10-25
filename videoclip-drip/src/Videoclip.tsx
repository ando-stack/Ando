import {
  AbsoluteFill, Img, interpolate, random, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig, Easing,
} from 'remotion';
import {anton, inter, BAR, BEAT, GOLD, ICE, MONEY, PINK, PURPLE} from './theme';
import {Car, MoneyRain, Person, Rack, Sparkles, usePunch} from './props';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

// Escenas medidas en compases (1 compás = 4 beats)
const S = {intro: 2, car: 2, ice: 2, racks: 2, cuts: 2, final: 2};
export const TOTAL_FRAMES = Object.values(S).reduce((a, b) => a + b, 0) * BAR;

/* ---------- Piezas comunes ---------- */

// Texto cromado
const Chrome: React.FC<{children: React.ReactNode; size: number; style?: React.CSSProperties}> = ({children, size, style}) => (
  <div style={{
    fontFamily: anton, fontSize: size, lineHeight: 1, letterSpacing: 4,
    background: 'linear-gradient(180deg,#ffffff 0%,#d9dde3 40%,#5b6068 50%,#e8ecf0 62%,#9aa0a8 100%)',
    WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
    filter: `drop-shadow(0 0 2px #fff) drop-shadow(0 0 30px ${PURPLE}) drop-shadow(0 8px 0 #000)`, ...style,
  }}>
    {children}
  </div>
);

// Texto que cae de golpe
const Slam: React.FC<{at: number; children: React.ReactNode; style?: React.CSSProperties}> = ({at, children, style}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = spring({frame: f - at, fps, config: {damping: 13, stiffness: 240}});
  return (
    <div style={{opacity: f >= at ? 1 : 0, transform: `scale(${interpolate(s, [0, 1], [2.6, 1])})`, filter: `blur(${(1 - s) * 10}px)`, ...style}}>
      {children}
    </div>
  );
};

const Flash: React.FC<{at: number; len?: number; color?: string}> = ({at, len = 8, color = 'white'}) => {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{background: color, opacity: interpolate(f - at, [0, 1, len], [0, 0.85, 0], clamp)}} />;
};

// Fondo nocturno con neón y luces desenfocadas (bokeh)
const Night: React.FC<{a?: string; b?: string; photo?: string}> = ({a = PURPLE, b = PINK, photo}) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{background: '#05030a', overflow: 'hidden'}}>
      {photo && (
        <Img src={staticFile(photo)} style={{
          position: 'absolute', inset: -80, width: 'calc(100% + 160px)', height: 'calc(100% + 160px)', objectFit: 'cover',
          filter: 'blur(28px) brightness(0.35) saturate(1.4)', transform: `scale(${1.1 + f * 0.0006})`,
        }} />
      )}
      <AbsoluteFill style={{background: `radial-gradient(ellipse at 20% 30%, ${a}55 0%, transparent 55%), radial-gradient(ellipse at 85% 70%, ${b}44 0%, transparent 55%)`}} />
      {Array.from({length: 18}).map((_, i) => {
        const s = 40 + random(`bs${i}`) * 140;
        return (
          <div key={i} style={{
            position: 'absolute', width: s, height: s, borderRadius: '50%',
            left: ((random(`bx${i}`) * 2100 + f * (0.3 + random(`bv${i}`))) % 2100) - 100, top: random(`by${i}`) * 1000,
            background: i % 2 ? a : b, opacity: 0.12 + random(`bo${i}`) * 0.15, filter: 'blur(14px)',
          }} />
        );
      })}
    </AbsoluteFill>
  );
};

// Suelo brillante con reflejo
const Floor: React.FC<{color?: string}> = ({color = PURPLE}) => (
  <div style={{
    position: 'absolute', left: 0, right: 0, bottom: 0, height: 260,
    background: `linear-gradient(180deg, ${color}30 0%, #000 100%)`, borderTop: `2px solid ${color}88`,
  }} />
);

// Líneas de velocidad
const Speed: React.FC<{strength?: number}> = ({strength = 1}) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{opacity: strength, pointerEvents: 'none'}}>
      {Array.from({length: 26}).map((_, i) => (
        <div key={i} style={{
          position: 'absolute', top: random(`sy${i}`) * 1080, height: 2 + random(`sh${i}`) * 3,
          left: 2000 - ((f * (60 + random(`sv${i}`) * 60) + random(`sx${i}`) * 3000) % 3000), width: 200 + random(`sw${i}`) * 400,
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.7))',
        }} />
      ))}
    </AbsoluteFill>
  );
};

/* ---------- 1. Intro: faros en la oscuridad + título ---------- */
const Intro: React.FC = () => {
  const f = useCurrentFrame();
  const flick = (at: number) => interpolate(f - at, [0, 2, 4, 6, 8], [0, 1, 0.2, 1, 1], clamp);
  const on = Math.max(flick(BEAT * 2), 0) * 0.5 + flick(BEAT * 3) * 0.5;
  return (
    <AbsoluteFill style={{background: '#000'}}>
      {/* dos faros encendiéndose */}
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', opacity: f < BAR ? 1 : interpolate(f, [BAR, BAR + 10], [1, 0.25], clamp)}}>
        <div style={{display: 'flex', gap: 380, transform: `scale(${1 + f * 0.003})`}}>
          {[0, 1].map((i) => (
            <div key={i} style={{width: 200, height: 70, borderRadius: '50%', background: '#fffbe6', opacity: on, boxShadow: '0 0 80px 40px rgba(255,245,200,0.6), 0 0 300px 120px rgba(255,245,200,0.25)'}} />
          ))}
        </div>
      </AbsoluteFill>
      {f >= BAR && <MoneyRain count={18} speed={0.6} seed="intro" />}
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10}}>
        <Slam at={BAR}><Chrome size={300}>PEREIRA7</Chrome></Slam>
        <div style={{fontFamily: inter, fontWeight: 900, fontSize: 34, color: 'white', letterSpacing: interpolate(f, [BAR + 8, 2 * BAR], [6, 26], clamp), opacity: interpolate(f, [BAR + 8, BAR + 18], [0, 1], clamp)}}>
          VIDEOCLIP
        </div>
      </AbsoluteFill>
      <Flash at={BAR} len={12} />
    </AbsoluteFill>
  );
};

/* ---------- 2. El coche llega y aparece Pereira ---------- */
const CarScene: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const arrive = interpolate(f, [0, BEAT * 2], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
  const carX = interpolate(arrive, [0, 1], [-1400, 640]);
  const brake = Math.sin(interpolate(f, [BEAT * 1.6, BEAT * 2.6], [0, Math.PI], clamp)) * 2; // cabeceo al frenar
  const pere = spring({frame: f - BEAT * 3, fps, config: {damping: 15}});
  const camera = interpolate(f, [0, BAR * 2], [1.05, 1.12]);
  return (
    <AbsoluteFill style={{transform: `scale(${camera})`}}>
      <Night a={PINK} b={PURPLE} />
      <Floor color={PINK} />
      <Speed strength={1 - arrive * 0.85} />
      <div style={{position: 'absolute', left: carX, bottom: 120, transform: `rotate(${brake}deg)`, transformOrigin: '80% 100%'}}>
        <Car width={1150} spin={(1 - arrive) * 2000 + f * (1 - arrive) * 8} lights={1} />
      </div>
      {/* reflejo del coche en el suelo */}
      <div style={{position: 'absolute', left: carX, bottom: -250, transform: 'scaleY(-1)', opacity: 0.2, filter: 'blur(4px)'}}>
        <Car width={1150} spin={0} lights={0.3} />
      </div>
      <Person src="cut3.png" height={980} left={110} bottom={-10} rim={PINK} enter={pere} sheenAt={BEAT * 4} />
      {f > BEAT * 4 && <MoneyRain count={22} seed="car" />}
      <div style={{position: 'absolute', right: 90, top: 90}}>
        <Slam at={BEAT * 4}><Chrome size={150}>NO PARAMOS</Chrome></Slam>
      </div>
      <Flash at={BEAT * 3} len={8} />
    </AbsoluteFill>
  );
};

/* ---------- 3. Todo ice: primer plano con la cadena ---------- */
const IceScene: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame: f, fps, config: {damping: 18}});
  const zoom = interpolate(f, [0, BAR * 2], [1, 1.12]);
  const punch = usePunch(6);
  return (
    <AbsoluteFill>
      <Night a={ICE} b={PURPLE} photo="foto7.jpg" />
      <div style={{position: 'absolute', inset: 0, transform: `scale(${zoom + punch * 0.015})`, transformOrigin: '70% 40%'}}>
        <div style={{position: 'absolute', right: 120, bottom: 0, height: 1060, width: 1060 * (1078 / 1416), transform: `translateX(${(1 - enter) * 700}px)`}}>
          <Person src="cut7.png" height={1060} left={0} rim={ICE} sheenAt={10} />
          {/* destellos en la cadena */}
          <Sparkles count={10} area={[220, 640, 420, 260]} seed="chain" size={70} />
        </div>
      </div>
      <Sparkles count={16} seed="ice" size={50} />
      <div style={{position: 'absolute', left: 110, top: 300}}>
        <Slam at={BEAT}><Chrome size={210} style={{filter: `drop-shadow(0 0 2px #fff) drop-shadow(0 0 40px ${ICE}) drop-shadow(0 8px 0 #000)`}}>TODO</Chrome></Slam>
        <Slam at={BEAT * 2}><Chrome size={260} style={{filter: `drop-shadow(0 0 2px #fff) drop-shadow(0 0 40px ${ICE}) drop-shadow(0 8px 0 #000)`}}>ICE</Chrome></Slam>
      </div>
      <Flash at={0} len={8} color={ICE} />
    </AbsoluteFill>
  );
};

/* ---------- 4. Racks: fajos de dinero apilándose ---------- */
const RacksScene: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const money = Math.round(interpolate(f, [0, BAR * 1.6], [0, 1000000], {...clamp, easing: Easing.out(Easing.quad)}));
  const enter = spring({frame: f - 4, fps, config: {damping: 16}});
  return (
    <AbsoluteFill>
      <Night a={MONEY} b={GOLD} photo="foto6.jpg" />
      <Floor color={MONEY} />
      <Person src="cut6.png" height={900} left={40} bottom={0} rim={MONEY} enter={enter} sheenAt={20} />
      {/* mesa con fajos */}
      <div style={{position: 'absolute', right: 80, bottom: 150, display: 'grid', gridTemplateColumns: 'repeat(3, 280px)', gap: '30px 20px', alignItems: 'end'}}>
        {Array.from({length: 6}).map((_, i) => {
          const s = spring({frame: f - BEAT * (i + 1), fps, config: {damping: 9, stiffness: 220}});
          return (
            <div key={i} style={{transform: `translateY(${(1 - s) * -700}px)`, opacity: f >= BEAT * (i + 1) ? 1 : 0}}>
              <Rack w={260} layers={18 + (i % 3) * 6} />
            </div>
          );
        })}
      </div>
      <div style={{position: 'absolute', right: 80, top: 100, textAlign: 'right'}}>
        <div style={{fontFamily: anton, fontSize: 170, color: MONEY, textShadow: `0 0 40px ${MONEY}, 0 8px 0 #000`, lineHeight: 1}}>
          ${money.toLocaleString('es-ES')}
        </div>
        <Slam at={BEAT * 2}><Chrome size={110}>RACKS ENCIMA</Chrome></Slam>
      </div>
      <MoneyRain count={34} speed={1.2} seed="racks" />
      {Array.from({length: 6}).map((_, i) => <Flash key={i} at={BEAT * (i + 1)} len={5} color={i % 2 ? 'white' : MONEY} />)}
    </AbsoluteFill>
  );
};

/* ---------- 5. Cortes rápidos al beat ---------- */
const CUTS = [
  {src: 'cut8.png', h: 1000, word: 'DRIP', bg: PURPLE},
  {src: 'cut1.png', h: 900, word: 'FLOW', bg: '#E10600'},
  {src: 'cut7.png', h: 1000, word: 'ICE', bg: '#0a5c7a'},
  {src: 'cut5.png', h: 1000, word: 'CAMPEÓN', bg: '#111'},
  {src: 'cut6.png', h: 860, word: 'CASH', bg: '#1f5c2a'},
  {src: 'cut2.png', h: 900, word: 'LUJO', bg: PINK},
  {src: 'cut3.png', h: 1000, word: 'FAMA', bg: '#3a1a6b'},
  {src: 'cut8.png', h: 1000, word: 'MÁS', bg: '#000'},
];
const CutsScene: React.FC = () => {
  const f = useCurrentFrame();
  const i = Math.min(CUTS.length - 1, Math.floor(f / BEAT));
  const c = CUTS[i];
  const local = f - i * BEAT;
  const zoom = interpolate(local, [0, BEAT], [1.12, 1]);
  const ab = interpolate(local, [0, 6], [14, 0], clamp); // aberración cromática al cortar
  return (
    <AbsoluteFill style={{background: c.bg, overflow: 'hidden'}}>
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
        <div style={{fontFamily: anton, fontSize: 560, color: 'rgba(0,0,0,0.35)', lineHeight: 1, transform: `scale(${zoom * 1.05})`, whiteSpace: 'nowrap'}}>{c.word}</div>
      </AbsoluteFill>
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'flex-end', transform: `scale(${zoom})`, transformOrigin: 'center bottom'}}>
        <Img src={staticFile(c.src)} style={{
          height: c.h, filter: `drop-shadow(${ab}px 0 0 rgba(255,0,80,0.8)) drop-shadow(${-ab}px 0 0 rgba(0,255,255,0.8)) drop-shadow(0 30px 40px rgba(0,0,0,0.7))`,
        }} />
      </AbsoluteFill>
      <div style={{position: 'absolute', left: 90, bottom: 90}}>
        <Chrome size={170} style={{transform: `rotate(-4deg) scale(${interpolate(local, [0, 4], [1.6, 1], clamp)})`}}>{c.word}</Chrome>
      </div>
      <Flash at={i * BEAT} len={5} />
    </AbsoluteFill>
  );
};

/* ---------- 6. Final: todos juntos delante del coche ---------- */
const CREW = [
  {src: 'cut8.png', h: 780, left: 0, d: 1},
  {src: 'cut7.png', h: 660, left: 340, d: 2},
  {src: 'cut6.png', h: 620, left: 1150, d: 3},
];
const Final: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const boss = spring({frame: f - BEAT * 4, fps, config: {damping: 14}});
  const out = interpolate(f, [BAR * 2 - BEAT, BAR * 2], [0, 1], clamp);
  return (
    <AbsoluteFill>
      <Night a={PURPLE} b={GOLD} />
      <Floor color={GOLD} />
      <div style={{position: 'absolute', left: 330, bottom: 150, opacity: 0.9}}>
        <Car width={1260} spin={0} lights={0.6 + 0.4 * Math.abs(Math.sin(f / 9))} color="#1a1a1a" />
      </div>
      {CREW.map((p) => (
        <Person key={p.src} src={p.src} height={p.h} left={p.left} bottom={0} rim={PURPLE}
          enter={spring({frame: f - BEAT * p.d, fps, config: {damping: 15}})} sheenAt={BEAT * p.d} />
      ))}
      {/* Pereira en el centro, con el cinturón */}
      <Person src="cut5.png" height={800} left={750} bottom={0} rim={GOLD} enter={boss} sheenAt={BEAT * 4} />
      <MoneyRain count={40} speed={1} seed="final" />
      <Sparkles count={18} seed="fin" />
      <div style={{position: 'absolute', left: 0, right: 0, top: 70, display: 'flex', justifyContent: 'center'}}>
        <Slam at={BEAT * 4}><Chrome size={160}>PEREIRA7</Chrome></Slam>
      </div>
      {[1, 2, 3].map((d) => <Flash key={d} at={BEAT * d} len={5} />)}
      <Flash at={BEAT * 4} len={12} color={GOLD} />
      <AbsoluteFill style={{background: '#000', opacity: out}} />
    </AbsoluteFill>
  );
};

/* ---------- Capa global: grano, viñeta, franjas de cine y golpe de zoom en cada beat ---------- */
const Overlay: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <svg width="100%" height="100%" style={{opacity: 0.1, mixBlendMode: 'overlay'}}>
        <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={f % 8} /></filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
      <AbsoluteFill style={{background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.75) 100%)'}} />
      <div style={{position: 'absolute', top: 0, left: 0, right: 0, height: 54, background: '#000'}} />
      <div style={{position: 'absolute', bottom: 0, left: 0, right: 0, height: 54, background: '#000'}} />
    </AbsoluteFill>
  );
};

export const Videoclip: React.FC = () => {
  const punch = usePunch(8);
  const scenes: [number, React.FC][] = [
    [S.intro, Intro], [S.car, CarScene], [S.ice, IceScene], [S.racks, RacksScene], [S.cuts, CutsScene], [S.final, Final],
  ];
  let t = 0;
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <AbsoluteFill style={{transform: `scale(${1 + punch * 0.012})`}}>
        {scenes.map(([bars, Comp], i) => {
          const from = t;
          t += bars * BAR;
          return <Sequence key={i} from={from} durationInFrames={bars * BAR}><Comp /></Sequence>;
        })}
      </AbsoluteFill>
      <Overlay />
    </AbsoluteFill>
  );
};
