# Cuota Justa

Web para analizar **todos los partidos de la temporada 2026/27** de LaLiga EA Sports, Premier League,
Serie A, Bundesliga, Ligue 1, Champions League, Europa League y Conference League, y encontrar
**errores de cuota**: apuestas en las que nuestra probabilidad es mayor que la que paga la casa.

## Qué hace

- **Calendario completo** por competición y jornada (2.148 partidos), con resultados de los ya jugados.
- Entras **partido a partido** y ves:
  - **1 solo pick**: el mejor que encuentra, con *nuestra probabilidad*, la *probabilidad de la casa*
    (1/cuota), la *ventaja* (valor esperado) y un *stake* sugerido (¼ de Kelly, máx. 3% del bank).
  - Todos los mercados con su **probabilidad** y su **cuota justa**: 1X2, doble oportunidad, empate no
    válido, más/menos goles, ambos marcan, goles por equipo, hándicap asiático, resultado exacto,
    **córners** (totales, por equipo y quién saca más), **tarjetas**, **faltas** y **tiros a puerta**.
  - Una casilla "Tu cuota" en cada mercado: escribe la cuota de tu casa y te dice al momento si tiene valor.
    Si supera al resto, pasa a ser el pick del partido.
  - Lo que espera el modelo (goles, córners, tarjetas, faltas, tiros), estadísticas de la temporada y forma.
- **Mejores picks**: ranking de los próximos partidos con más valor.
- **Rendimiento**: simulación honesta sobre los partidos ya jugados (cada uno predicho solo con datos
  anteriores, contra las cuotas de cierre).

## Cómo usarla

```bash
cd apuestas
./iniciar_apuestas.sh        # Windows: iniciar_apuestas.bat
```

Actualiza los datos (unos 30 s) y abre http://localhost:8000. Solo necesita Python 3, sin instalar nada.

Para tenerla online y actualizada sola: activa GitHub Pages (Settings → Pages → Source: *GitHub Actions*).
El flujo `.github/workflows/apuestas.yml` descarga datos tres veces al día y publica la web.
GitHub solo ejecuta las tareas programadas desde la rama principal, así que hay que fusionar esta rama antes.

## De dónde salen los datos

| Fuente | Qué aporta |
|---|---|
| fixturedownload.com | Calendario completo con jornadas y resultados de las 8 competiciones |
| football-data.co.uk | Resultados con xG, córners, faltas, tarjetas, tiros y cuotas (Bet365, media y mejor cuota) de los partidos jugados y de los de esta semana. También ligas de Portugal, Países Bajos, Bélgica, Turquía, Escocia, Grecia, Austria, Suiza, Dinamarca, Noruega, Suecia, Polonia y Rumanía para valorar a los equipos europeos |
| The Odds API (opcional) | Cuotas en vivo de muchas casas, también Champions/Europa/Conference, ambos marcan, córners y tarjetas. Clave gratis en the-odds-api.com, se pega en Ajustes |

## El modelo

- **Goles**: Poisson con corrección Dixon-Coles. Cada equipo tiene ataque y defensa, ajustados con goles y
  xG (60% xG), dando más peso a los partidos recientes (un partido de hace 120 días pesa la mitad) y con
  la fuerza de su liga como punto de partida, para poder comparar equipos de ligas distintas en Europa.
- **Córners, tarjetas, faltas y tiros a puerta**: binomial negativa con lo que cada equipo genera y concede,
  ventaja de campo y nivel de cada liga.
- **Nuestra probabilidad** mezcla el modelo (20% por defecto) con el consenso del mercado sin margen cuando
  existe. Las pruebas con esta temporada muestran que el modelo solo es algo menos preciso que el mercado de
  cierre; mezclado, sirve para detectar casas que se desvían. Para mercados sin consenso (por ejemplo, una
  cuota de córners que escribes tú) se usa el modelo puro.
- El pick elegido es la apuesta con mayor criterio de Kelly entre las que superan la ventaja mínima (4%),
  con cuota entre 1,30 y 6 y sin una diferencia exagerada con el mercado (que suele indicar lesiones o
  rotaciones que el modelo no conoce). Todo esto se cambia en Ajustes.

## Importante

Ningún modelo garantiza ganancias. En la simulación de esta temporada el resultado frente a las cuotas de
cierre está entre −9% y +3% según los ajustes: la muestra es pequeña y no demuestra una ventaja. Donde más
valor aparece es comparando casas y apostando en la que mejor paga. El modelo tampoco sabe de lesiones,
alineaciones ni motivación. Solo mayores de 18 años; juega con responsabilidad.
