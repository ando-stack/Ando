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
cd fantasy_basket/scraper
node crawl.js 629   # visita la competición, los 10 equipos y las actas nuevas
python3 build.py    # une actas y plantillas -> dataset.json
python3 price.py    # puntos fantasy y precios -> ../data.json
```
