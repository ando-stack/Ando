# Simulador de baloncesto · NBA, EuroLiga y Liga Endesa

Simulador Monte Carlo de partidos de la **NBA**, la **EuroLiga** y la **Liga Endesa (ACB)**,
**posesión a posesión y jugador a jugador**. Eliges la competición, el equipo local y el
visitante, revisas (y editas) sus quintetos, minutos y bajas, eliges el número de simulaciones
(5.000 por defecto, de 1.000 a 100.000) y obtienes la distribución completa de resultados:
victoria, prórroga, marcadores exactos, márgenes, over/under de puntos (total y por equipo),
hándicaps, cuartos y mitades, estadísticas de equipo y de cada jugador (incluidas combinadas,
dobles-dobles, triples-dobles, eliminación por faltas y máximos del partido), siempre ordenadas de
mayor a menor frecuencia, con buscador, filtro por equipo, exportación a CSV y gráficos.

> Los resultados son **probabilidades simuladas**, no predicciones seguras. Herramienta de **uso
> personal y no comercial**. Si activas la «cuota justa» (1/probabilidad) verás un aviso: no es
> asesoramiento de apuestas; juego responsable, solo mayores de 18 años.

<!-- RESUMEN-VALIDACION:INICIO -->
<!-- RESUMEN-VALIDACION:FIN -->

## Fuentes de datos y condiciones

Detalle completo en [`docs/fuentes.md`](docs/fuentes.md).

| Competición | Fuente | Condiciones |
|---|---|---|
| NBA | [PBP Stats API](https://api.pbpstats.com/docs) (datos del jugada a jugada oficial de NBA.com) | API pública sin clave. Las estadísticas NBA solo pueden usarse con fines privados y no comerciales, con atribución a NBA.com, y no en relación con apuestas ni en bases de datos públicas. Las APIs oficiales (stats.nba.com) bloquean el acceso desde centros de datos. |
| EuroLiga | API oficial de Euroleague Basketball (`api-live.euroleague.net`, `live.euroleague.net`) | Pública sin clave. Sus condiciones no se han podido leer (la web bloquea los accesos automatizados): uso personal citando la fuente; revísalas antes de cualquier uso público. |
| Liga Endesa | Páginas públicas de `acb.com` y `live.acb.com` | `robots.txt` permite el acceso; el aviso legal autoriza la descarga para uso personal citando a la ACB y prohíbe la redistribución sin permiso. |

La ingesta usa un User-Agent identificativo, respeta un intervalo entre peticiones por dominio,
guarda todo en caché y no intenta eludir ningún bloqueo. No se usa ningún servicio de pago.
**Lesiones**: ninguna fuente accesible publica un parte de lesiones, así que se infieren
*ausencias recientes* (no estar en el acta / no jugar en los últimos partidos) y puedes añadir bajas
con su fuente en `data/manual/bajas.json` o marcarlas en la interfaz. **Quintetos**: se calculan
como «probables» (más titularidades recientes) y se muestra siempre su base, su fuente y su fecha.

## Cómo se actualizan los datos

```
npm run ingest            # las tres competiciones (o ingest:nba / ingest:euroleague / ingest:acb)
npm run calibrate         # recalibra el motor con las medias de cada liga
npm run ingest:upload     # sube los snapshots a Supabase (si hay claves en .env)
```

1. Se descargan los box scores de cada partido terminado (temporada actual y anterior) y las
   plantillas → `data/games/`.
2. Se calculan estadísticas de equipo y jugador, patrones de minutos por cuarto, quintetos
   probables, rotaciones, ausencias y medias de la liga, se validan y se guardan en
   `data/snapshot/<competición>.json`.
3. La interfaz usa ese snapshot (copiado a `public/data` al compilar) o lo lee de Supabase.

Hay un flujo de GitHub Actions (`.github/workflows/simulador-ingesta.yml`) que lo hace cada día y
vuelve a desplegar. Si una fuente falla se conservan los últimos datos válidos y se registra el
error en `data/data_updates.json`; la interfaz muestra siempre la fecha de los datos.

## El modelo, en sencillo

Cada simulación juega el partido entero, posesión a posesión (detalle en
[`docs/modelo.md`](docs/modelo.md)):

1. **Ritmo**: el número de posesiones sale del ritmo de los dos equipos, con algo de azar.
2. **Rotaciones**: cada jugador tiene unos minutos previstos repartidos por cuartos según su
   patrón real; en cada balón muerto entra quien más minutos «debe». Los problemas de faltas le
   sientan y con 5 (FIBA) o 6 (NBA) faltas queda eliminado.
3. **Cada posesión** la termina uno de los cinco en pista, más probablemente los que más balón usan:
   pérdida (a veces con robo de un rival), falta en el tiro (tiros libres), tiro de 2 o de 3, con el
   porcentaje del jugador ajustado por la defensa rival (y regularizado si tiene pocos tiros).
4. Las **canastas** pueden ser asistidas; los **fallos de 2** pueden ser tapones; cada **fallo**
   da un rebote ofensivo (sigue la posesión) o defensivo, que se asigna a un jugador en pista.
5. **Faltas y bonus** según el reglamento de cada competición, **prórrogas** de 5 minutos si hay
   empate y una lógica sencilla de **final de partido** (faltas intencionadas, agotar o acelerar).
6. Repetido miles de veces en paralelo (Web Workers) da la distribución de todo.

El motor está **calibrado** por competición para que las medias simuladas (ritmo, puntos,
porcentajes, rebotes, asistencias, robos, tapones, pérdidas, faltas, tiros libres, ventaja de campo
y dispersión del margen) coincidan con las reales.

## Diferencias de reglas NBA / FIBA (`config/reglas.ts`)

| | NBA | EuroLiga y ACB (FIBA) |
|---|---|---|
| Duración | 4 × 12 min | 4 × 10 min |
| Prórroga | 5 min | 5 min |
| Eliminación | 6 faltas | 5 faltas |
| Reloj de posesión | 24 s (14 s tras rebote ofensivo) | 24 s (14 s tras rebote ofensivo) |
| Línea de triple | 7,24 m (6,71 m en esquinas) | 6,75 m (6,60 m en esquinas) |
| Bonus | 2 TL desde la 5.ª falta de equipo del periodo (4.ª en prórroga) y la 2.ª en los dos últimos minutos | 2 TL desde la 5.ª falta de equipo del cuarto; la prórroga suma a las del 4.º cuarto |
| Faltas en ataque | no cuentan como falta de equipo | cuentan como falta de equipo |
| Jugadores en acta | 13 | 12 |

## Validación

Backtest de la temporada 2025-26 simulando cada partido solo con los datos disponibles antes de
su fecha: resultados completos en [`docs/validacion.md`](docs/validacion.md) (y resumen al principio
de este README).

## Editar quintetos y minutos

En la página **Simulador**, tras elegir los equipos, cada equipo muestra su plantilla con el
quinteto probable marcado y los minutos previstos:

- **Tit.**: marca o desmarca titulares (deben ser 5).
- **Min. previstos**: cambia los minutos; al simular se reescalan para sumar 240 (NBA) o 200 (FIBA).
  «Ajustar minutos» lo hace en el momento.
- **Baja**: el jugador no juega. Las ausencias recientes vienen marcadas por defecto.
- **Restablecer** vuelve al quinteto y la rotación probables.

Las etiquetas indican si un jugador tiene datos **estimados** (pocos minutos o fichaje reciente) o
si está **ausente** (con la fuente y la fecha al pasar el ratón). En **Resultados** puedes guardar
la simulación y en **Historial** comparar dos (por ejemplo, con y sin un jugador lesionado).

## Configuración de Supabase (opcional)

1. Crea un proyecto en [Supabase](https://supabase.com) (plan gratuito).
2. Ejecuta la migración `supabase/migrations/20261023000000_esquema_inicial.sql` (SQL Editor o
   `supabase db push`). Crea las tablas `competitions, seasons, teams, players, team_stats,
   team_quarter_stats, player_stats, player_minutes_patterns, injuries, lineups, rotations,
   data_updates, saved_simulations` con **RLS activo**: lectura pública y ninguna política de
   escritura (solo escribe la clave de servicio).
3. Copia `.env.example` como `.env` y rellena `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` (solo para
   la ingesta) y ejecuta `npm run ingest:upload`.
4. En Netlify define `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` como variables
   del sitio (las usan las funciones en el servidor) y `VITE_DATA_MODE=supabase`.

Ninguna clave va en el código ni llega al navegador. `.env` está en `.gitignore`.

## Desarrollo local

Requisitos: **Node.js 18+** (probado con Node 22).

```
cd simulador-baloncesto
npm install
npm run dev          # http://localhost:5173 (usa data/snapshot copiado a public/data)
npm test             # tests del motor, la agregación y coherencia con datos reales
npm run build        # typecheck + build de producción en dist/
npm run backtest     # validación de la temporada pasada (tarda varios minutos)
npm run bench        # rendimiento de 5.000 simulaciones
npm run verify       # verificación de datos contra la fuente
npm run report       # regenera docs/validacion.md y el resumen del README
```

Antes de `npm run dev` por primera vez, copia los snapshots con `npm run data:copy` (el build lo
hace solo).

## Despliegue en Netlify

1. Conecta el repositorio en Netlify y pon como **directorio base** `simulador-baloncesto`.
2. Comando de build `npm run build` y carpeta de publicación `dist` (ya están en `netlify.toml`,
   junto con las funciones y las redirecciones `/api/*`).
3. (Opcional) Variables de entorno de Supabase del apartado anterior.
4. Para mantener los datos al día, activa el flujo de GitHub Actions (añade los secretos
   `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` si usas Supabase).

> Ten en cuenta las condiciones de las fuentes: publicar la web con los datos en abierto puede
> requerir permiso de la NBA, Euroleague Basketball y la ACB. Para uso personal, protege el sitio
> (por ejemplo, con la protección por contraseña de Netlify) o úsalo en local.
