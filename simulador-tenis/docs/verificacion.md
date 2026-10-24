# Verificación de datos

Generado por `npm run verificar` el 2026-10-24 02:17 UTC. Cada dato publicado se compara con una descarga nueva (sin caché) de la fuente original o con una fuente independiente.

| # | Dato | Publicado en la web | Fuente de contraste | Valor en la fuente | ¿Coincide? |
|---|---|---|---|---|---|
| 1 | Ranking WTA nº 1 y puntos | Elena Rybakina, 9196 pts | api.wtatennis.com (ranking) | Elena Rybakina, 9196 pts | Sí |
| 2 | Ranking WTA nº 10 y puntos | Marta Kostyuk, 3920 pts | api.wtatennis.com (ranking) | Marta Kostyuk, 3920 pts | Sí |
| 3 | Ranking ATP nº 1 y puntos | Jannik Sinner, 10950 pts | ESPN (ranking ATP) | Jannik Sinner, 10950 pts | Sí |
| 4 | Fecha de nacimiento de Aryna Sabalenka | 1998-05-05 | api.wtatennis.com (independiente de Sackmann) | 1998-05-05 | Sí |
| 5 | Superficie, pista y fecha de inicio de Valle D'Aosta Ladies Open | dura, cubierta, 2026-10-26 | api.wtatennis.com (torneo) | Hard, cubierta, 2026-10-26 | Sí |
| 6 | Hora y pista de Nikoloz Basilashvili – Stefanos Tsitsipas (Almaty Open) | 2026-10-24 12:00 (Madrid), Center Court | ESPN (scoreboard), hora UTC convertida a mano | 2026-10-24T10:00Z UTC = 2026-10-24 12:00 (Madrid), Center Court | Sí |
| 7 | Final de Roland Garros 2025: marcador, aces y dobles faltas del ganador | 4-6 6-7(4) 6-4 7-6(3) 7-6(2); 7 aces, 7 DF | CSV original de Sackmann | 4-6 6-7(4) 6-4 7-6(3) 7-6(2); 7 aces, 7 DF (Carlos Alcaraz) | Sí |
| 8 | Final de Lisboa Belem Open (WTA, 2026-10-18): aces y dobles faltas | aces 2/0, DF 1/3 (ganadora/perdedora) | api.wtatennis.com (stats del partido) | aces 2/0, DF 1/3 (A/B) | Sí |
| 9 | Cuadro de Cali Open: R32 Gustavo Heide – Alex Hernandez | 6-4 3-6 6-3, gana Gustavo Heide | Wikipedia (página del cuadro, revisada a mano) | jugador presente en el cuadro de Wikipedia; marcador comprobado a mano (ver docs) | Sí |
| 10 | Partidos computados en el Elo de Alexander Zverev (2020→hoy) | 471 | Recuento independiente sobre el histórico validado | 471 | Sí |

Resultado: 10 de 10 coinciden.

## Comprobaciones manuales

- Dato 9 (cuadro de un Challenger): el script sólo comprueba que el jugador aparece en la página; el marcador se revisó a mano en el wikitexto de «2026 Cali Open – Singles» (23-10-2026): `RD1-team01 = G Heide` (cabeza de serie 1) con 6, 3, 6 y `RD1-team02 = A Hernández` (LL) con 4, 6, 3 → 6-4 3-6 6-3 para Heide, igual que lo publicado.
- Dato 6: la hora UTC de ESPN (10:00Z) se pasó a mano a la hora de Madrid (CEST, UTC+2 hasta el 25-10-2026) → 12:00, igual que en la web.
