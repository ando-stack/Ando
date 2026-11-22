# Fantasy A1 · Cadete Masculino (La Rioja)

Juego fantasy de la [Liga A1 Cadete Masculino](https://competicionesfrb.owbasket.com/competicion/?id=629).
Todos los jugadores, entrenadores y estadísticas salen de las plantillas y las actas oficiales publicadas.

- `index.html` + `data.json`: el juego (abre `index.html` con un servidor local, p. ej. `python3 -m http.server`).
- `scraper/`: cómo se generan los datos.

## Reglas
- Presupuesto inicial 65 M. Plantilla: 5 titulares + 5 suplentes + 1 entrenador. Máximo 3 jugadores por equipo.
- Titulares ×1, capitán ×2, banquillo ×0,5.
- Puntos de jugador: +1 por punto, +0,5 extra por triple, −0,5 por tiro fallado (campo o TL), −0,5 por falta,
  −3 si le eliminan, +1 titular, +1 cada 10 min, ±1 cada 5 de +/− (tope ±4), +2 si gana su equipo.
- Entrenador: +10 victoria, −2 derrota, ±1 cada 5 puntos de margen (tope ±6).
- Precio jugador = 0,5 + 0,33·media + 0,0045·media² (mínimo 0,5 M), con media = puntos fantasy ÷ partidos de su equipo.

## Actualizar tras cada jornada
```bash
fantasy_basket/scraper/actualizar.sh
```
Descarga la competición, los equipos y las actas nuevas, recalcula puntos y precios y escribe `data.json`. Las fotos no se descargan: se mantienen las que hay en `fotos/`. Los nombres corregidos a mano están en `scraper/nombres.json`.
Solo cuentan los partidos terminados (estado 1 y sin directo): un partido en juego no suma.
Hay tareas programadas que lo ejecutan los sábados a las 11:00, 12:30 y 16:00 (hora de España) y publican el juego si hay cambios.

## Ligas privadas
En "Mis ligas" cada persona crea ligas con nombre o se une con un código de 6 letras, y tiene un equipo distinto en cada liga
(además del modo práctica, que se guarda solo en su navegador). Los equipos de las ligas se guardan en la base de datos del artifact:
`ligas/<CODIGO>` y `equipos/<id de usuario>`. Cada persona solo puede modificar su propio equipo.
Un cambio de plantilla cuenta a partir de la primera jornada que aún no ha empezado.
