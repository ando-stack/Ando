/**
 * Escena 3D del inicio: una esfera de partículas que respira con ruido,
 * se deforma hacia el ratón y se expande al hacer scroll.
 * Se carga de forma diferida desde src/lib/scene.ts.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
} from 'three';

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uScroll;
  uniform vec2 uMouse;
  uniform float uPixelRatio;
  uniform float uSize;
  attribute float aRandom;
  varying float vMix;
  varying float vAlpha;

  // Ruido simplex 3D (Ashima Arts / Stefan Gustavson, licencia MIT)
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }

  void main(){
    vec3 dir = normalize(position);
    float n = snoise(dir * 1.6 + vec3(uTime * 0.18));
    // Abombamiento hacia la posición del ratón
    float toward = max(dot(dir, normalize(vec3(uMouse * 1.4, 1.0))), 0.0);
    float bulge = pow(toward, 6.0) * 0.45;
    float radius = 1.0 + n * 0.22 + bulge + uScroll * (0.8 + aRandom * 1.6);
    vec3 pos = dir * radius * 1.65;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.6 + aRandom * 0.9) * uPixelRatio * (1.0 / -mv.z);
    vMix = clamp(n * 0.9 + 0.5 + bulge, 0.0, 1.0);
    vAlpha = (0.35 + aRandom * 0.65) * (1.0 - uScroll * 0.85);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;
  varying float vMix;
  varying float vAlpha;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float strength = smoothstep(0.5, 0.0, d);
    vec3 color = mix(uColorB, uColorA, vMix);
    gl_FragColor = vec4(color, strength * vAlpha * uOpacity);
  }
`;

function readColor(name: string, fallback: string): Color {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  try {
    return new Color(value || fallback);
  } catch {
    return new Color(fallback);
  }
}

export function createHeroScene(host: HTMLElement): () => void {
  const isSmall = window.matchMedia('(max-width: 767px)').matches;
  const count = isSmall ? 2600 : 7000;

  const renderer = new WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'low-power' });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'hero-scene__canvas';
  host.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 1, 0.1, 50);
  camera.position.set(0, 0, 6.5);

  // Esfera de Fibonacci: puntos repartidos de forma uniforme.
  const positions = new Float32Array(count * 3);
  const randoms = new Float32Array(count);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    positions[i * 3] = Math.cos(theta) * r;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(theta) * r;
    randoms[i] = Math.random();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aRandom', new BufferAttribute(randoms, 1));

  const isLight = () => document.documentElement.dataset.theme === 'light';
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: isLight() ? NormalBlending : AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uMouse: { value: new Vector2() },
      uPixelRatio: { value: pixelRatio },
      uSize: { value: isSmall ? 34 : 40 },
      uOpacity: { value: 0 },
      uColorA: { value: readColor('--aam-scene-a', '#c8ff2e') },
      uColorB: { value: readColor('--aam-scene-b', '#6d5dfc') },
    },
  });
  const points = new Points(geometry, material);
  scene.add(points);

  // ---------- Tamaño ----------
  const resize = () => {
    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // En pantallas anchas la esfera se desplaza a la derecha para dejar sitio al texto.
    points.position.x = w > 900 ? 1.6 : 0;
    points.position.y = w > 900 ? 0 : 0.9;
    // En pantallas estrechas se aleja la cámara para que la esfera quepa.
    camera.position.z = w / h < 0.8 ? 9.5 : 6.5;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  // ---------- Interacción ----------
  const target = new Vector2();
  const onPointer = (e: PointerEvent) => {
    target.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  };
  let scrollTarget = 0;
  const onScroll = () => {
    const h = host.clientHeight || window.innerHeight;
    scrollTarget = Math.min(1, Math.max(0, window.scrollY / h));
  };
  const onTheme = () => {
    material.uniforms.uColorA.value = readColor('--aam-scene-a', '#c8ff2e');
    material.uniforms.uColorB.value = readColor('--aam-scene-b', '#6d5dfc');
    material.blending = isLight() ? NormalBlending : AdditiveBlending;
    material.needsUpdate = true;
  };
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('aam:theme', onTheme);
  onScroll();

  // ---------- Bucle: solo se renderiza si el inicio es visible y la pestaña está activa ----------
  let visible = true;
  let running = false;
  let last = performance.now();
  let elapsed = 0;
  const tick = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    elapsed += dt;
    const u = material.uniforms;
    u.uTime.value = elapsed;
    u.uMouse.value.lerp(target, 0.05);
    u.uScroll.value += (scrollTarget - u.uScroll.value) * 0.08;
    u.uOpacity.value = Math.min(1, u.uOpacity.value + dt * 0.8);
    points.rotation.y += dt * (0.08 + u.uScroll.value * 0.4);
    points.rotation.x += (u.uMouse.value.y * 0.3 - points.rotation.x) * 0.05;
    renderer.render(scene, camera);
  };
  const update = () => {
    const shouldRun = visible && !document.hidden;
    if (shouldRun === running) return;
    running = shouldRun;
    last = performance.now();
    renderer.setAnimationLoop(shouldRun ? tick : null);
  };
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    update();
  });
  io.observe(host);
  document.addEventListener('visibilitychange', update);

  const onLost = (e: Event) => {
    e.preventDefault();
    renderer.setAnimationLoop(null);
    host.classList.remove('is-ready');
  };
  canvas.addEventListener('webglcontextlost', onLost);
  update();

  // ---------- Limpieza ----------
  return () => {
    renderer.setAnimationLoop(null);
    io.disconnect();
    ro.disconnect();
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('aam:theme', onTheme);
    document.removeEventListener('visibilitychange', update);
    canvas.removeEventListener('webglcontextlost', onLost);
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  };
}
