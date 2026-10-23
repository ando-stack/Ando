# Bajas manuales

`bajas.json` permite añadir bajas o dudas confirmadas por una fuente fiable (club, liga o medio
reconocido), que la ingesta combina con las ausencias inferidas de los box scores. Formato:

```json
[
  {
    "comp": "acb",
    "teamId": "9",
    "playerId": "20209407",
    "playerName": "Walter Tavares",
    "status": "baja",
    "detail": "Lesión en el tobillo derecho, baja de 2-3 semanas",
    "source": "Real Madrid (comunicado oficial)",
    "sourceUrl": "https://…",
    "updatedAt": "2026-10-23T10:00:00Z"
  }
]
```

- `comp`: `nba`, `euroleague` o `acb`. `status`: `baja`, `duda` o `probable`.
- `playerId` es opcional (si falta, se busca por nombre en la plantilla).
- Los identificadores de equipo y jugador son los de cada fuente (ver `data/snapshot/<comp>.json`).
- Tras editarlo: `npx tsx ingest/run.ts <comp> --build-only`.
