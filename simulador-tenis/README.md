# Simulador de partidos de tenis (ATP · WTA · ATP Challenger · WTA 125)

Aplicación web que muestra los torneos en curso y próximos de los cuatro circuitos con sus cuadros y órdenes de juego, y simula cualquier partido **punto a punto** (Monte Carlo, 5.000 simulaciones por defecto, de 1.000 a 100.000) para dar la distribución completa de resultados: probabilidad de victoria, resultado en sets, marcadores exactos, over/under y hándicap de juegos, mercados de cada set, tie-breaks, aces, dobles faltas, breaks, puntos de break, porcentajes de saque y otros (set en blanco, remontadas, ganar sin perder el saque), todo ordenado de mayor a menor frecuencia, con buscador, filtro por jugador, exportación a CSV, gráficos y cuotas justas opcionales.

> **Aviso.** Los resultados son probabilidades simuladas, no predicciones seguras. No es asesoramiento de apuestas. Juego responsable, sólo mayores de 18 años.

## Qué hace

1. **Torneos** (`/`): torneos ATP, WTA, Challenger y WTA 125 en curso y de los próximos 14 días, filtrables por circuito, superficie, estado y fechas, con su fuente y hora de actualización.
2. **Torneo** (`/torneo/:id`): orden de juego por día y pista (horas en Europe/Madrid), cuadro final y fase previa por rondas. Cada partido con jugadores conocidos tiene un botón **Simular**.
3. **Simulador** (`/simulador`): también en **modo libre** (dos jugadores cualesquiera del mismo circuito, superficie, cubierta/exterior, formato). Muestra la ficha previa de cada jugador (ranking, Elo general y de superficie, saque y resto en la superficie, forma reciente, enfrentamientos directos) y lo que «piensa» el modelo; al simular, barra de progreso y tiempo de cálculo.
4. **Resultados**: ocho secciones (resumen, sets, marcadores, juegos, sets/por set, tie-breaks, saque y resto, otros). Se pueden **guardar** y **comparar** (`/historial`).
5. **Jugador** (`/jugador/:id`): ficha completa con evolución del ranking y del Elo.
6. **Acerca** (`/acerca`): fuentes, licencias, estado de cada fuente, formatos y validación.

## Fuentes de datos y licencias

| Datos | Fuente | Licencia / condiciones |
|---|---|---|
| Histórico 2020 → junio 2026 con estadísticas, jugadores, rankings | Jeff Sackmann `tennis_atp` / `tennis_wta` (espejo de archivo en Hugging Face) | **CC BY-NC-SA 4.0 — sólo uso no comercial**, atribución, compartir igual |
| WTA y WTA 125: calendario, cuadros, orden de juego, resultados y estadísticas, ranking | API pública de wtatennis.com | Sin términos para terceros: uso no comercial, caché y pocas peticiones |
| ATP Tour: cuadros, orden de juego, resultados, ranking top 150 | ESPN (API pública de espn.com) | No documentada; uso no comercial, caché |
| Challenger (calendario y cuadros) y superficie/categoría del ATP Tour | Wikipedia | CC BY-SA 4.0 |

**Por la licencia de Sackmann, este proyecto y sus despliegues deben ser no comerciales.** No se usa ningún servicio de pago. atptour.com bloquea el acceso automatizado, así que **los Challenger no tienen orden de juego** (sólo cuadro). Detalle, fuentes descartadas y huecos conocidos en [docs/fuentes.md](docs/fuentes.md).

## Cómo se actualizan torneos y cuadros

- `npm run ingesta`: descarga (con caché) el histórico y las fuentes en vivo, valida los datos, recalcula perfiles y Elo y publica `public/data/*.json`; si hay credenciales, sincroniza Supabase. La primera vez tarda 30-40 minutos (estadísticas partido a partido de la WTA); después, unos minutos.
- `npm run ingesta:vivo`: sólo torneos, cuadros, órdenes de juego y rankings.
- **Programado**: `.github/workflows/ingesta-tenis.yml` (en la raíz del repositorio) ejecuta la ingesta 5 veces al día, pasa los tests, compila y despliega en Netlify.
- Si una fuente falla se usan sus últimos datos válidos y la web muestra la fecha; si no responde ninguna, se conservan los torneos anteriores.

## El modelo en pocas palabras

- **Elo por superficie**: cada jugador tiene un Elo general y uno por superficie (dura, tierra, hierba), calculados con todos los partidos desde 2020 (también ITF y previas, para que todos los circuitos estén en la misma escala). Tras cada partido, el ganador sube y el perdedor baja más cuanto más sorprendente fue el resultado y cuantos menos partidos lleva el jugador. Para predecir se mezclan el Elo general y el de la superficie, más un pequeño término de forma reciente.
- **Punto a punto**: de las estadísticas de los últimos tres años (con más peso a lo reciente y ajustadas por la calidad de los rivales) sale la probabilidad de que cada jugador gane un punto con su saque frente a ESE rival en ESA superficie (método de Barnett y Clarke). Esas probabilidades se desplazan lo justo para que la probabilidad de ganar el partido coincida con la del Elo combinado con las estadísticas. Después se juega cada punto: primer saque dentro o fuera, ace, segundo saque, doble falta, punto ganado o perdido; juegos, tie-breaks (con su orden de saque) y sets según el formato del torneo. En cada simulación el nivel de cada jugador varía un poco, como de un día a otro.
- **Pocos datos**: los jugadores con menos de 10 partidos con estadísticas usan una estimación (su Elo o su ranking, la superficie y la media del circuito) y se marcan como **Estimado** junto al número de partidos reales.
- Detalle completo: [docs/modelo.md](docs/modelo.md).

## Formatos

| Torneo | Formato | Referencia |
|---|---|---|
| ATP Tour, ATP Challenger, WTA, WTA 125 | Mejor de 3 sets, tie-break a 7 en todos (también en el tercero) | ATP Rulebook 2025 1.03 B.1 · WTA Rulebook 2026 §39.a y ap. E §40.a |
| Grand Slam, cuadro final masculino | Mejor de 5, tie-break a 10 a 6-6 del quinto set | Grand Slam Rule Book 2026 |
| Grand Slam, femenino y previas | Mejor de 3, tie-break a 10 a 6-6 del tercer set | Grand Slam Rule Book 2026 |
| Next Gen ATP Finals | Mejor de 5 sets a 4 juegos, tie-break a 3-3, sin ventaja | Reglas Next Gen ATP Finals 2025 |

Configurables en [config/formatos.ts](config/formatos.ts) (incluye además mejor de 5 con tie-break a 7 y super tie-break como tercer set para el modo libre).

## Resultados de la validación

Backtest **fuera de muestra** de la temporada **2025** (parámetros calibrados con 2024; cada partido se predice sólo con datos anteriores a él):

| Grupo | Partidos | Log loss modelo | Log loss sólo Elo | Brier | Aciertos |
|---|---:|---:|---:|---:|---:|
| Todos | 19.147 | **0,607** | 0,612 | 0,211 | 66,2 % |
| ATP | 3.755 | 0,613 | 0,619 | 0,213 | 66,4 % |
| ATP Challenger | 9.834 | 0,610 | 0,613 | 0,212 | 65,6 % |
| WTA | 3.707 | 0,603 | 0,609 | 0,209 | 66,8 % |
| WTA 125 | 1.851 | 0,589 | 0,596 | 0,203 | 67,8 % |

Calibración de la probabilidad de victoria: en cada tramo de 10 puntos, la frecuencia real queda a 1-3 puntos de lo predicho (p. ej. 74,6 % predicho → 73,8 % real; 15,5 % → 16,4 %).

Medias simuladas frente a reales (9.823 partidos con estadísticas, 300 simulaciones cada uno): juegos 22,86 / 22,96 · set decisivo 33,3 % / 33,9 % · aces 7,67 / 7,73 · dobles faltas 6,48 / 6,61 · breaks 6,50 / 6,51 · tie-breaks 0,34 / 0,33. Desviaciones conocidas: los Challenger de 2025 tuvieron más aces que los de 2024 (el modelo con parámetros de 2024 se queda un 9 % corto) y los grupos de hierba, con pocos partidos, son más ruidosos. Los parámetros de producción se recalibran con 2025.

Informe completo: [docs/validacion.md](docs/validacion.md). Verificación de 10 datos contra la fuente: [docs/verificacion.md](docs/verificacion.md).

## Rendimiento

Medido en este entorno (contenedor Linux, Node 22 / Chromium headless):

| Prueba | Tiempo |
|---|---|
| 5.000 simulaciones al mejor de 3, un solo hilo (`npm run rendimiento`) | ≈ 0,1 s + 0,03 s de agregación y comprobación de coherencia |
| 5.000 simulaciones en la web (Web Workers en paralelo, de pulsar «Simular» a ver resultados) | **0,19 s** |
| 20.000 simulaciones al mejor de 5 en la web | 0,66 s |
| 100.000 simulaciones al mejor de 5, un solo hilo | ≈ 2,3 s (en la web se reparten entre varios workers) |

En un ordenador normal, 5.000 simulaciones tardan muy por debajo de un segundo y la interfaz no se bloquea en ningún momento.

## Configuración de Supabase

1. Crea un proyecto en Supabase (el plan gratuito basta).
2. Aplica la migración: `supabase db push` con la CLI, o pega `supabase/migrations/20261023000000_esquema_inicial.sql` en el editor SQL. Crea las 12 tablas con **RLS activo y forzado**, sólo con política de lectura pública.
3. En el entorno de la ingesta (o en los *secrets* de GitHub Actions) define `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. **Nunca** pongas la clave service_role en variables `VITE_*` ni en el navegador.
4. Para que la web lea de Supabase, define `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (la clave anónima es pública por diseño; RLS sólo permite leer). Sin ellas, la web usa el snapshot JSON.

Las simulaciones guardadas se guardan en el navegador: la base de datos no acepta escrituras desde la web.

## Desarrollo local

Requisitos: **Node.js 18 o superior** (probado con Node 22).

```bash
cd simulador-tenis
npm install
cp .env.example .env      # opcional: credenciales de Supabase
npm run ingesta           # descarga y prepara los datos (primera vez: 30-40 min)
npm run calibrar          # opcional: recalibra el modelo con la temporada 2024
npm run backtest          # opcional: valida con la temporada 2025 → docs/validacion.md
npm run verificar         # compara 10 datos con las fuentes → docs/verificacion.md
npm run dev               # http://localhost:5173
npm test                  # tests del motor, la agregación y la ingesta
npm run build             # compilación de producción en dist/
npm run rendimiento       # tiempo de 5.000 simulaciones en un hilo
```

## Despliegue en Netlify

1. Conecta el repositorio en Netlify y pon **Base directory = `simulador-tenis`** (el resto lo lee de `netlify.toml`: `npm run build`, publica `dist`, redirección SPA).
2. Variables de entorno de compilación (opcionales): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
3. Para las actualizaciones programadas, añade al repositorio de GitHub los *secrets* `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. El flujo `ingesta-tenis.yml` ingesta, prueba, compila y despliega.

El snapshot de datos (`public/data`) se genera en cada ingesta y se publica con la web.

## Estructura

```
config/formatos.ts        formatos por circuito y torneo
engine/                   motor punto a punto, cálculo exacto, modelo, Elo, perfiles, agregación, coherencia (+ tests)
ingest/                   fuentes (sackmann, wta, espn, wikipedia), histórico, vivo, ajuste, calibrar, backtest, verificar, supabase
src/pages, src/components interfaz React; src/workers: Web Workers de simulación; src/lib: datos, Supabase, tipos, formato
supabase/migrations       esquema con RLS
docs/                     fuentes.md, modelo.md, validacion.md, verificacion.md, arquitectura.md
tests/                    tests de la ingesta (parsers, validación, emparejamiento de jugadores)
```

## Limitaciones conocidas

- Sin orden de juego para los Challenger (atptour.com bloquea el acceso automatizado). Los cuadros de Challenger vienen de Wikipedia y pueden ir con retraso.
- Desde junio de 2026 los partidos del ATP Tour y de los Challenger no tienen estadísticas de saque en las fuentes abiertas: actualizan el Elo y la forma, pero no el perfil de saque/resto.
- Ranking ATP actual sólo para el top 150 (ESPN); para el resto se muestra el último ranking del histórico con su fecha.
- El revés (una o dos manos) no está en ninguna fuente abierta.
- El modelo no distingue pista cubierta de exterior (sólo la superficie), ni modela lesiones, cansancio o condiciones de juego.
- Uso exclusivamente no comercial por la licencia CC BY-NC-SA de los datos de Sackmann.
