import {
  AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing,
} from 'remotion';
import {TransitionSeries, linearTiming, springTiming} from '@remotion/transitions';
import {slide} from '@remotion/transitions/slide';
import {wipe} from '@remotion/transitions/wipe';
import {fade} from '@remotion/transitions/fade';
import {C, fontFamily} from './theme';
import {Owl} from './Owl';

const T = 15; // frames de cada transición
const D = {intro: 90, words: 110, lesson: 150, streak: 110, outro: 120};
export const TOTAL_FRAMES = D.intro + D.words + D.lesson + D.streak + D.outro - 4 * T;

const base: React.CSSProperties = {fontFamily, fontWeight: 900, color: C.white, textAlign: 'center'};

const usePop = (delay = 0, damping = 10) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({frame: f - delay, fps, config: {damping, stiffness: 160}});
};

// Texto que entra palabra por palabra con rebote
const BounceText: React.FC<{text: string; delay?: number; size?: number; color?: string}> = ({
  text, delay = 0, size = 110, color = C.white,
}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  return (
    <div style={{...base, fontSize: size, color, lineHeight: 1.05, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0 0.25em', padding: '0 60px'}}>
      {text.split(' ').map((w, i) => {
        const s = spring({frame: f - delay - i * 4, fps, config: {damping: 9, stiffness: 180}});
        return (
          <span key={i} style={{display: 'inline-block', transform: `translateY(${(1 - s) * 80}px) scale(${s})`, opacity: Math.min(1, s * 2)}}>
            {w}
          </span>
        );
      })}
    </div>
  );
};

// Círculos que se expanden de fondo
const Bursts: React.FC<{color: string}> = ({color}) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
      {[0, 10, 20].map((d) => {
        const p = interpolate(f - d, [0, 40], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
        return (
          <div key={d} style={{position: 'absolute', width: 2400 * p, height: 2400 * p, borderRadius: '50%', border: `40px solid ${color}`, opacity: 1 - p}} />
        );
      })}
    </AbsoluteFill>
  );
};

// Botón estilo 3D (borde inferior más oscuro)
const Button3D: React.FC<{label: string; bg: string; shade: string; color?: string; width?: number; size?: number}> = ({
  label, bg, shade, color = C.white, width = 820, size = 56,
}) => (
  <div style={{...base, color, fontSize: size, width, padding: '34px 0', borderRadius: 32, background: bg, boxShadow: `0 14px 0 ${shade}`, letterSpacing: 2}}>
    {label}
  </div>
);

/* ---------- Escena 1: intro ---------- */
const Intro: React.FC = () => {
  const owl = usePop(8, 8);
  const f = useCurrentFrame();
  const rot = interpolate(owl, [0, 1], [-25, 0]);
  return (
    <AbsoluteFill style={{background: C.green}}>
      <Bursts color="#89E219" />
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 60}}>
        <div style={{transform: `scale(${owl}) rotate(${rot}deg)`}}>
          <Owl size={620} />
        </div>
        <BounceText text="¡Hola!" delay={25} size={190} />
        <div style={{...base, fontSize: 54, opacity: interpolate(f, [45, 60], [0, 1], {extrapolateRight: 'clamp', extrapolateLeft: 'clamp'})}}>
          ¿Listo para aprender?
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ---------- Escena 2: idiomas ---------- */
const WORDS = [
  {w: 'Hello', c: C.blue, x: 200, y: 380},
  {w: 'Bonjour', c: C.purple, x: 830, y: 330},
  {w: 'Ciao', c: C.red, x: 170, y: 1450},
  {w: 'Hallo', c: C.orange, x: 900, y: 1420},
  {w: 'Olá', c: C.yellow, x: 270, y: 1720},
  {w: 'こんにちは', c: C.blue, x: 760, y: 1770},
  {w: '안녕', c: C.red, x: 560, y: 220},
];
const Words: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  return (
    <AbsoluteFill style={{background: C.white}}>
      {WORDS.map((it, i) => {
        const s = spring({frame: f - 6 - i * 5, fps, config: {damping: 8, stiffness: 170}});
        const float = Math.sin((f + i * 20) / 12) * 14;
        return (
          <div key={it.w} style={{
            position: 'absolute', left: it.x, top: it.y + float, transform: `translate(-50%,-50%) scale(${s}) rotate(${(i % 2 ? 1 : -1) * 6}deg)`,
            ...base, fontSize: 64, background: it.c, padding: '22px 42px', borderRadius: 40, whiteSpace: 'nowrap',
            boxShadow: '0 10px 0 rgba(0,0,0,0.15)',
          }}>
            {it.w}
          </div>
        );
      })}
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 30}}>
        <Owl size={420} />
        <BounceText text="Aprende más de 40 idiomas" delay={12} size={100} color={C.ink} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ---------- Escena 3: lección ---------- */
const OPTIONS = ['El perro come pan', 'El gato bebe leche', 'La niña lee un libro'];
const CORRECT = 1;
const Lesson: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const pick = 60; // momento en que se elige la respuesta
  const progress = interpolate(f, [pick + 10, pick + 30], [0.45, 0.7], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const banner = spring({frame: f - pick - 8, fps, config: {damping: 14}});
  const tap = spring({frame: f - pick, fps, config: {damping: 6, stiffness: 300}});
  return (
    <AbsoluteFill style={{background: C.white, padding: 70, flexDirection: 'column', gap: 50}}>
      {/* barra de progreso */}
      <div style={{marginTop: 60, height: 40, borderRadius: 20, background: C.gray, overflow: 'hidden'}}>
        <div style={{width: `${progress * 100}%`, height: '100%', borderRadius: 20, background: C.green}} />
      </div>
      <div style={{...base, color: C.ink, fontSize: 70, textAlign: 'left', opacity: interpolate(f, [0, 12], [0, 1])}}>
        Traduce esta frase
      </div>
      <div style={{display: 'flex', alignItems: 'center', gap: 30}}>
        <div style={{transform: `scale(${spring({frame: f - 4, fps, config: {damping: 10}})})`}}>
          <Owl size={260} />
        </div>
        <div style={{...base, color: C.ink, fontSize: 58, border: `5px solid ${C.gray}`, borderRadius: 36, padding: '36px 40px', transform: `scale(${spring({frame: f - 10, fps, config: {damping: 10}})})`}}>
          “The cat drinks milk”
        </div>
      </div>
      <div style={{display: 'flex', flexDirection: 'column', gap: 34, marginTop: 40}}>
        {OPTIONS.map((o, i) => {
          const s = spring({frame: f - 18 - i * 6, fps, config: {damping: 12}});
          const chosen = i === CORRECT && f >= pick;
          const scale = chosen ? 1 + 0.06 * Math.sin(tap * Math.PI) : 1;
          return (
            <div key={o} style={{
              ...base, fontSize: 56, color: chosen ? C.greenDark : C.ink, padding: '40px 0', borderRadius: 32,
              background: chosen ? '#D7FFB8' : C.white, border: `5px solid ${chosen ? C.green : C.gray}`,
              boxShadow: `0 10px 0 ${chosen ? C.green : C.gray}`,
              transform: `translateX(${(1 - s) * 1100}px) scale(${scale})`,
            }}>
              {o}
            </div>
          );
        })}
      </div>
      {/* banner de correcto */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: 420, background: '#D7FFB8',
        transform: `translateY(${(1 - banner) * 440}px)`, padding: '50px 70px', display: 'flex', flexDirection: 'column', gap: 40,
      }}>
        <div style={{display: 'flex', alignItems: 'center', gap: 30}}>
          <div style={{width: 100, height: 100, borderRadius: 50, background: C.white, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
            <svg width="60" height="60" viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5" stroke={C.green} strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="30" strokeDashoffset={30 * (1 - banner)} /></svg>
          </div>
          <div style={{...base, color: C.greenDark, fontSize: 80}}>¡Excelente!</div>
        </div>
        <Button3D label="CONTINUAR" bg={C.green} shade={C.greenDark} width={940} />
      </div>
    </AbsoluteFill>
  );
};

/* ---------- Escena 4: racha ---------- */
const Flame: React.FC<{size: number}> = ({size}) => {
  const f = useCurrentFrame();
  const flick = 1 + Math.sin(f / 3) * 0.04;
  return (
    <svg width={size} height={size} viewBox="0 0 200 240" style={{transform: `scaleY(${flick})`, transformOrigin: 'bottom'}}>
      <path d="M100 10 C130 60 180 90 180 150 A80 80 0 0 1 20 150 C20 110 50 90 60 50 C75 80 85 90 95 95 C95 60 90 40 100 10 Z" fill={C.yellow} />
      <path d="M100 100 C115 130 140 145 140 175 A40 40 0 0 1 60 175 C60 150 85 135 100 100 Z" fill={C.white} />
    </svg>
  );
};
const Streak: React.FC = () => {
  const f = useCurrentFrame();
  const fl = usePop(0, 7);
  const n = Math.round(interpolate(f, [10, 70], [0, 365], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad)}));
  const xp = interpolate(f, [20, 80], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  return (
    <AbsoluteFill style={{background: C.orange}}>
      <Bursts color={C.yellow} />
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 30}}>
        <div style={{transform: `scale(${fl})`}}><Flame size={460} /></div>
        <div style={{...base, fontSize: 260, lineHeight: 1, textShadow: '0 12px 0 rgba(0,0,0,0.12)'}}>{n}</div>
        <div style={{...base, fontSize: 80}}>días de racha</div>
        <div style={{width: 820, height: 56, borderRadius: 28, background: 'rgba(255,255,255,0.35)', marginTop: 50, overflow: 'hidden'}}>
          <div style={{width: `${xp * 100}%`, height: '100%', background: C.yellow, borderRadius: 28}} />
        </div>
        <div style={{...base, fontSize: 52}}>+{Math.round(xp * 50)} XP</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ---------- Escena 5: cierre ---------- */
const Outro: React.FC = () => {
  const f = useCurrentFrame();
  const owl = usePop(0, 8);
  const btn = usePop(50, 10);
  const pulse = 1 + Math.max(0, Math.sin((f - 60) / 6)) * 0.04 * (f > 60 ? 1 : 0);
  return (
    <AbsoluteFill style={{background: C.green}}>
      <Bursts color="#89E219" />
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 50}}>
        <div style={{transform: `scale(${owl})`}}><Owl size={520} happy /></div>
        <BounceText text="Solo 5 minutos al día" delay={10} size={96} />
        <BounceText text="duolingo" delay={30} size={170} />
        <div style={{transform: `scale(${btn * pulse})`, marginTop: 30}}>
          <Button3D label="EMPIEZA GRATIS" bg={C.white} shade="#D0D0D0" color={C.green} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const DuolingoPromo: React.FC = () => (
  <TransitionSeries>
    <TransitionSeries.Sequence durationInFrames={D.intro}><Intro /></TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={wipe({direction: 'from-bottom'})} timing={linearTiming({durationInFrames: T})} />
    <TransitionSeries.Sequence durationInFrames={D.words}><Words /></TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={slide({direction: 'from-right'})} timing={springTiming({durationInFrames: T, config: {damping: 200}})} />
    <TransitionSeries.Sequence durationInFrames={D.lesson}><Lesson /></TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={wipe({direction: 'from-top-left'})} timing={linearTiming({durationInFrames: T})} />
    <TransitionSeries.Sequence durationInFrames={D.streak}><Streak /></TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: T})} />
    <TransitionSeries.Sequence durationInFrames={D.outro}><Outro /></TransitionSeries.Sequence>
  </TransitionSeries>
);
