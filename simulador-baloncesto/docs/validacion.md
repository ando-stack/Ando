# Validación del modelo

Informe generado el 2026-10-23 con `npx tsx engine/report.ts` a partir de los resultados del backtest (`npm run backtest`), la calibración (`npm run calibrate`), la verificación de datos (`npx tsx ingest/verify.ts`) y la prueba de rendimiento (`npm run bench`).

## 1. Backtest de la temporada 2025-26

**Método.** Cada partido de la temporada 2025-26 se simula con un snapshot construido *solo con los partidos anteriores a su fecha* (temporada 2025-26 hasta ese día, más la 2024-25 como temporada previa, con los mismos pesos y regularización que en producción). Se evalúan los partidos en los que ambos equipos llevan al menos 5 partidos. Jugadores disponibles = los que jugaron ese partido (aproxima el parte de bajas, que se conoce antes del salto inicial); titulares = los reales (se confirman antes del partido); minutos = previsión con los partidos anteriores, no los reales. Los factores globales del motor se **recalibran dentro del backtest cada 28 días** con el snapshot de esa fecha (sin información futura).

| | EuroLiga | Liga Endesa (ACB) | NBA |
|---|---:|---:|---:|
| Partidos evaluados | 352 | 282 | 866 |
| Simulaciones por partido | 500 | 500 | 300 |
| Acierto del ganador (modelo) | 62,2 % | 63,8 % | 65,4 % |
| Acierto «gana el local» | 64,8 % | 55,7 % | 52,9 % |
| Acierto «gana el de mejor balance» | 58,0 % | 64,9 % | 65,5 % |
| Brier ganador (modelo) | 0,221 | 0,217 | 0,220 |
| Brier «tasa de victorias locales» | 0,231 | 0,251 | 0,250 |
| Brier «balance + factor campo» (log5) | 0,228 | 0,217 | 0,225 |
| Log loss ganador | 0,632 | 0,622 | 0,633 |
| Error absoluto medio del total de puntos | 14,1 | 13,7 | 15,4 |
| Sesgo del total (simulado − real) | -2,1 | -4,2 | -0,3 |
| Error absoluto medio del margen | 9,2 | 10,3 | 11,3 |
| Sesgo del margen (simulado − real) | -0,5 | 0,4 | 0,5 |
| Correlación margen previsto/real | 0,31 | 0,42 | 0,42 |
| Pendiente real ~ previsto (1 = bien escalado) | 1,03 | 1,13 | 1,01 |
| Total real dentro del intervalo central 50 % / 80 % | 49 % / 79 % | 54 % / 80 % | 53 % / 82 % |
| Margen real dentro del intervalo central 50 % / 80 % | 56 % / 82 % | 55 % / 82 % | 54 % / 80 % |
| Prórrogas: prevista / real | 2,7 % / 4,8 % | 2,2 % / 4,3 % | 2,3 % / 4,4 % |
| Error medio por jugador: puntos / rebotes / asistencias | 4,08 / 1,53 / 1,13 | 4,02 / 1,55 / 1,05 | 4,66 / 1,96 / 1,38 |
| Tiempo del backtest | 282 s | 240 s | 462 s |

Lectura: en Brier (calidad de las probabilidades de victoria): en EuroLiga, el modelo mejora a la mejor referencia (0,221 frente a 0,228); en Liga Endesa (ACB), el modelo iguala a la mejor referencia (0,217 frente a 0,217); en NBA, el modelo mejora a la mejor referencia (0,220 frente a 0,225). El acierto «a ganador» depende mucho de la ventaja de campo de cada temporada (en la EuroLiga 2025-26 ganó el local el 65 % de las veces, lo que hace muy difícil batir a «gana el local»). Las predicciones de margen y total están bien escaladas (pendiente ≈ 1) y los intervalos cubren aproximadamente lo que deben (50 % y 80 %).

## 2. Calibración de probabilidades (over/under, hándicaps y jugadores)

Para cada partido se calcula la probabilidad simulada de superar varias líneas alrededor de la media (total de puntos: media ±0, 3, 6, 10, 15; hándicap: ±0, 4, 8, 12; jugadores: 0,5×, 0,8×, 1×, 1,25× y 1,6× su media en puntos, rebotes, asistencias y triples) y se compara con la frecuencia real. *ECE* = error de calibración esperado (media ponderada de |previsto − observado| por tramos de 10 puntos porcentuales; 0 = perfecto).

| Mercado | EuroLiga: n · ECE · Brier | Liga Endesa (ACB): n · ECE · Brier | NBA: n · ECE · Brier |
|---|---:|---:|---:|
| Ganador | 352 · 0,057 · 0,221 | 282 · 0,056 · 0,217 | 866 · 0,029 · 0,220 |
| Over/under del total | 3168 · 0,037 · 0,215 | 2538 · 0,092 · 0,210 | 7794 · 0,007 · 0,220 |
| Hándicap | 2464 · 0,019 · 0,192 | 1974 · 0,021 · 0,200 | 6062 · 0,011 · 0,207 |
| Puntos de jugador | 36.959 · 0,013 · 0,208 | 30.743 · 0,013 · 0,208 | 90.191 · 0,010 · 0,198 |
| Rebotes de jugador | 28.808 · 0,015 · 0,200 | 24.141 · 0,014 · 0,200 | 79.718 · 0,037 · 0,194 |
| Asistencias de jugador | 21.024 · 0,016 · 0,203 | 16.516 · 0,021 · 0,201 | 62.731 · 0,021 · 0,200 |
| Triples de jugador | 14.385 · 0,011 · 0,192 | 12.001 · 0,015 · 0,189 | 43.038 · 0,014 · 0,197 |

<details><summary>Tablas de fiabilidad · EuroLiga</summary>

**Ganador** (previsto → observado, n):

26 % → 50 % (2) · 36 % → 39 % (18) · 46 % → 65 % (48) · 55 % → 55 % (83) · 65 % → 63 % (119) · 75 % → 85 % (71) · 82 % → 73 % (11)

**Over/under del total** (previsto → observado, n):

18 % → 23 % (323) · 26 % → 30 % (375) · 35 % → 42 % (401) · 45 % → 48 % (569) · 55 % → 58 % (454) · 64 % → 69 % (383) · 73 % → 74 % (382) · 82 % → 85 % (281)

**Hándicap** (previsto → observado, n):

15 % → 16 % (351) · 25 % → 24 % (340) · 37 % → 36 % (258) · 44 % → 49 % (187) · 54 % → 56 % (320) · 64 % → 68 % (308) · 74 % → 77 % (351) · 84 % → 84 % (349)

**Puntos de jugador** (previsto → observado, n):

9 % → 7 % (123) · 15 % → 16 % (5781) · 26 % → 28 % (5082) · 33 % → 34 % (4620) · 45 % → 45 % (7095) · 56 % → 54 % (4806) · 64 % → 63 % (3414) · 75 % → 70 % (3420) · 83 % → 84 % (2603) · 90 % → 100 % (15)

**Rebotes de jugador** (previsto → observado, n):

9 % → 10 % (402) · 15 % → 16 % (4894) · 25 % → 27 % (4372) · 35 % → 35 % (3718) · 45 % → 46 % (3508) · 55 % → 54 % (3173) · 65 % → 64 % (3226) · 75 % → 71 % (2770) · 84 % → 82 % (2598) · 91 % → 85 % (147)

**Asistencias de jugador** (previsto → observado, n):

9 % → 16 % (183) · 16 % → 17 % (3616) · 25 % → 26 % (3446) · 35 % → 35 % (2884) · 45 % → 44 % (2585) · 55 % → 53 % (2424) · 65 % → 64 % (2237) · 75 % → 71 % (2117) · 84 % → 81 % (1471) · 91 % → 95 % (61)

**Triples de jugador** (previsto → observado, n):

6 % → 0 % (778) · 16 % → 17 % (2530) · 25 % → 25 % (2696) · 35 % → 37 % (2013) · 45 % → 45 % (1728) · 55 % → 54 % (1720) · 65 % → 66 % (1421) · 75 % → 74 % (1085) · 82 % → 82 % (414)

</details>

<details><summary>Tablas de fiabilidad · Liga Endesa (ACB)</summary>

**Ganador** (previsto → observado, n):

27 % → 0 % (5) · 36 % → 24 % (25) · 45 % → 43 % (42) · 55 % → 51 % (59) · 65 % → 59 % (69) · 74 % → 69 % (55) · 84 % → 88 % (24) · 92 % → 100 % (3)

**Over/under del total** (previsto → observado, n):

18 % → 25 % (239) · 26 % → 31 % (319) · 35 % → 44 % (318) · 45 % → 57 % (462) · 55 % → 66 % (363) · 64 % → 73 % (309) · 73 % → 82 % (306) · 82 % → 91 % (222)

**Hándicap** (previsto → observado, n):

18 % → 18 % (229) · 26 % → 25 % (284) · 36 % → 32 % (211) · 44 % → 41 % (215) · 54 % → 52 % (277) · 65 % → 62 % (258) · 75 % → 74 % (309) · 82 % → 85 % (191)

**Puntos de jugador** (previsto → observado, n):

9 % → 4 % (53) · 16 % → 17 % (5008) · 26 % → 29 % (3959) · 33 % → 34 % (3933) · 45 % → 47 % (5872) · 56 % → 56 % (4244) · 64 % → 63 % (2527) · 75 % → 74 % (3257) · 83 % → 84 % (1884) · 90 % → 83 % (6)

**Rebotes de jugador** (previsto → observado, n):

9 % → 9 % (321) · 15 % → 17 % (4180) · 25 % → 26 % (3602) · 35 % → 35 % (3170) · 45 % → 45 % (2947) · 55 % → 52 % (2693) · 65 % → 65 % (2612) · 75 % → 71 % (2371) · 84 % → 82 % (2146) · 91 % → 91 % (99)

**Asistencias de jugador** (previsto → observado, n):

9 % → 22 % (49) · 16 % → 17 % (2903) · 25 % → 22 % (2722) · 35 % → 34 % (2433) · 45 % → 42 % (2036) · 55 % → 54 % (1953) · 65 % → 62 % (1795) · 75 % → 71 % (1632) · 83 % → 83 % (978) · 91 % → 93 % (15)

**Triples de jugador** (previsto → observado, n):

5 % → 2 % (926) · 16 % → 17 % (1862) · 25 % → 26 % (2187) · 35 % → 32 % (1662) · 45 % → 43 % (1389) · 55 % → 57 % (1412) · 65 % → 65 % (1295) · 75 % → 75 % (938) · 82 % → 81 % (330)

</details>

<details><summary>Tablas de fiabilidad · NBA</summary>

**Ganador** (previsto → observado, n):

15 % → 14 % (21) · 26 % → 30 % (64) · 36 % → 34 % (117) · 45 % → 40 % (155) · 55 % → 54 % (178) · 65 % → 64 % (158) · 74 % → 79 % (109) · 84 % → 83 % (53) · 92 % → 55 % (11)

**Over/under del total** (previsto → observado, n):

19 % → 21 % (95) · 24 % → 26 % (1150) · 35 % → 35 % (1312) · 45 % → 44 % (1502) · 55 % → 55 % (1352) · 65 % → 66 % (1273) · 76 % → 76 % (1049) · 81 % → 80 % (61)

**Hándicap** (previsto → observado, n):

18 % → 20 % (417) · 25 % → 24 % (957) · 35 % → 34 % (783) · 45 % → 41 % (836) · 55 % → 55 % (858) · 65 % → 66 % (818) · 75 % → 74 % (967) · 82 % → 81 % (426)

**Puntos de jugador** (previsto → observado, n):

8 % → 8 % (2247) · 15 % → 14 % (12820) · 26 % → 27 % (13987) · 33 % → 34 % (8970) · 45 % → 45 % (17184) · 56 % → 53 % (9412) · 64 % → 64 % (10180) · 75 % → 70 % (6011) · 85 % → 84 % (8265) · 91 % → 94 % (1115)

**Rebotes de jugador** (previsto → observado, n):

8 % → 7 % (4705) · 14 % → 15 % (10849) · 25 % → 24 % (11867) · 34 % → 31 % (8002) · 45 % → 41 % (10086) · 55 % → 49 % (8070) · 65 % → 58 % (9091) · 75 % → 68 % (6156) · 85 % → 78 % (8008) · 92 % → 87 % (2884)

**Asistencias de jugador** (previsto → observado, n):

8 % → 15 % (1362) · 15 % → 16 % (10330) · 25 % → 25 % (9841) · 35 % → 34 % (7873) · 45 % → 44 % (7487) · 55 % → 52 % (6829) · 65 % → 61 % (6971) · 75 % → 70 % (5659) · 84 % → 81 % (5750) · 91 % → 92 % (629)

**Triples de jugador** (previsto → observado, n):

8 % → 6 % (349) · 16 % → 15 % (7940) · 25 % → 23 % (8106) · 35 % → 34 % (6097) · 45 % → 44 % (5407) · 55 % → 53 % (4729) · 65 % → 63 % (4346) · 75 % → 73 % (4253) · 83 % → 80 % (1810) · 91 % → 0 % (1)

</details>

## 3. Calibración de medias por competición

Medias por equipo y partido reales (temporada actual + anterior ponderada) frente a las simuladas tras calibrar (todos los cruces posibles entre equipos):

| Estadística | EuroLiga real / simulado | Liga Endesa (ACB) real / simulado | NBA real / simulado |
|---|---:|---:|---:|
| Posesiones | 76,0 / 75,8 | 78,6 / 78,3 | 102,0 / 101,9 |
| Puntos | 86,4 / 85,8 | 89,2 / 88,9 | 115,2 / 115,2 |
| T2 intentados | 38,0 / 37,5 | 38,0 / 36,9 | 52,2 / 52,6 |
| T2 anotados | 21,0 / 20,8 | 21,0 / 20,5 | 28,5 / 28,9 |
| T3 intentados | 26,9 / 26,4 | 27,9 / 28,0 | 36,9 / 36,1 |
| T3 anotados | 9,6 / 9,5 | 9,9 / 9,9 | 13,2 / 12,9 |
| TL intentados | 19,8 / 20,3 | 23,1 / 23,8 | 23,7 / 24,0 |
| TL anotados | 15,5 / 15,9 | 17,6 / 18,1 | 18,5 / 18,7 |
| Rebotes ofensivos | 9,5 / 9,5 | 9,6 / 9,7 | 11,5 / 11,4 |
| Rebotes defensivos | 21,9 / 21,9 | 23,0 / 22,9 | 32,5 / 32,4 |
| Asistencias | 19,0 / 18,8 | 17,5 / 17,2 | 26,5 / 26,6 |
| Robos | 6,5 / 6,5 | 7,1 / 7,1 | 8,5 / 8,5 |
| Tapones | 2,6 / 2,6 | 2,8 / 2,7 | 4,9 / 4,9 |
| Pérdidas | 12,0 / 12,1 | 12,2 / 12,2 | 13,9 / 13,9 |
| Faltas | 21,1 / 20,9 | 22,6 / 22,4 | 20,0 / 19,9 |
| Margen medio del local | 3,02 / 3,61 | 4,21 / 4,08 | 1,31 / 0,94 |
| Desv. típica del margen | 12,06 / 12,01 | 14,61 / 14,62 | 16,00 / 15,58 |
| Prórrogas | 0,043 / 0,029 | 0,043 / 0,019 | 0,045 / 0,024 |

Factores resultantes (`config/calibracion.json`):

| Factor | EuroLiga | Liga Endesa (ACB) | NBA |
|---|---:|---:|---:|
| paceFactor | 0,951 | 0,943 | 0,948 |
| fg2Factor | 0,998 | 1,010 | 1,003 |
| fg3Factor | 1,001 | 0,994 | 1,001 |
| ftFactor | 0,997 | 1,000 | 0,996 |
| tovFactor | 1,045 | 1,037 | 1,014 |
| tripFactor | 0,602 | 0,654 | 0,793 |
| orebFactor | 1,062 | 1,041 | 1,051 |
| teamReboundShare | 0,127 | 0,130 | 0,119 |
| astFactor | 1,014 | 0,990 | 1,009 |
| stlFactor | 1,147 | 1,153 | 1,137 |
| blkFactor | 1,046 | 1,055 | 1,008 |
| nonShootingFoulRate | 0,133 | 0,133 | 0,063 |
| homeShootingEdge | 0,052 | 0,069 | 0,015 |
| scoreEffect | 0,049 | 0,015 | 0,020 |
| minutesSd | 0,210 | 0,210 | 0,210 |

## 4. Verificación de datos contra la fuente

Valores calculados a partir de nuestros box scores frente a las estadísticas agregadas que publica cada fuente por otra vía (2026-10-23 16:18 UTC): **16 de 16 coinciden**.

| Competición | Dato | Nuestro | Fuente | ¿Coincide? |
|---|---|---:|---:|:---:|
| EuroLiga | Puntos totales 2026-27 de JONES, CARLIK | 115 | 115 | sí |
| EuroLiga | Partidos jugados 2026-27 de JONES, CARLIK | 7 | 7 | sí |
| EuroLiga | Puntos totales 2026-27 de WILBEKIN, SCOTTIE | 112 | 112 | sí |
| EuroLiga | Partidos jugados 2026-27 de WILBEKIN, SCOTTIE | 7 | 7 | sí |
| EuroLiga | Puntos totales 2026-27 de PUNTER, KEVIN | 109 | 109 | sí |
| EuroLiga | Partidos jugados 2026-27 de PUNTER, KEVIN | 7 | 7 | sí |
| EuroLiga | Asistencias totales de Paris Basketball | 122 | 122 | sí |
| ACB | Puntos totales 2026-27 de Theo Maledon | 65 | 65 | sí |
| ACB | Asistencias totales 2026-27 de Theo Maledon | 20 | 20 | sí |
| ACB | Puntos totales 2026-27 de Timoti Shorts | 69 | 69 | sí |
| ACB | Asistencias totales 2026-27 de Timoti Shorts | 19 | 19 | sí |
| NBA | Puntos totales 2026-27 de Tyrese Maxey | 60 | 60 | sí |
| NBA | Rebotes totales 2026-27 de Tyrese Maxey | 7 | 7 | sí |
| NBA | Puntos totales 2026-27 de Shai Gilgeous-Alexander | 49 | 49 | sí |
| NBA | Rebotes totales 2026-27 de Shai Gilgeous-Alexander | 8 | 8 | sí |
| NBA | Resultado del partido 0022600001 (2026-10-20) | 121-113 | 121-113 | sí |

Comprobación independiente adicional (prensa): el partido inaugural de la NBA 2026-27, Detroit Pistons 121-113 Boston Celtics (20/10/2026), con 38 puntos de Paul George y 13 de Jayson Tatum según la crónica de AP, coincide con nuestros datos (fuente: [ClickOnDetroit](https://www.clickondetroit.com/sports/2026/10/20/detroit-pistons-rally-from-22-point-deficit-to-beat-boston-celtics-in-season-opener/), [Flashscore](https://www.flashscore.com/news/pistons-complete-22-point-comeback-to-defeat-celtics-in-nba-season-opener/ETZ502nQ/)).

## 5. Coherencia y rendimiento

- **Coherencia en cada simulación** (tests `engine/simulate.test.ts` y `tests/coherencia.test.ts`, este último con los datos reales de las tres competiciones): los puntos de cada jugador son 2·T2 + 3·T3 + TL; los puntos de los jugadores suman el resultado del equipo; los cuartos (y prórrogas) suman el resultado final; los segundos jugados suman exactamente 5 × la duración del partido; ningún jugador supera el límite de faltas; no hay empates finales; en el agregado, todas las estadísticas de los jugadores suman las del equipo.
- **Supabase y RLS** (test `tests/rls.test.ts`): la migración se ejecuta en un PostgreSQL embebido (PGlite); RLS está activo en las 13 tablas, el rol anónimo lee pero no puede insertar, actualizar ni borrar (aunque tenga permisos de tabla, como en Supabase), y la clave de servicio sí escribe. El mapeo snapshot ↔ tablas se comprueba de ida y vuelta sin pérdida (`tests/supabase-map.test.ts`).
- **Rendimiento** (2026-10-23, Node.js, CPU de 4 núcleos):
  - nba: 5.000 simulaciones en 1,88 s con un hilo y 1,09 s con 3 workers.
  - euroleague: 5.000 simulaciones en 1,54 s con un hilo y 0,99 s con 3 workers.
  - acb: 5.000 simulaciones en 1,39 s con un hilo y 1,04 s con 3 workers.
  - En el navegador (Chromium, mismo equipo, 3 Web Workers, incluida su creación): 5.000 simulaciones en 1,3 s (NBA y EuroLiga) y 1,4 s (ACB); 100.000 simulaciones en 16,5 s (NBA), 14,5 s (EuroLiga) y 14,8 s (ACB), sin bloquear la interfaz (barra de progreso activa).

## 6. Ajustes hechos al modelo a partir de la validación

1. **Rebotes de equipo**: los rebotes de jugador simulados salían un 15 % altos; en las actas una parte de los fallos son rebotes «de equipo». Se añadió `teamReboundShare` (calibrado ≈ 13 %).
2. **Efecto marcador**: la desviación típica del margen simulado (14,8) superaba la real (12,1). Se añadió un efecto marcador; primero penalizaba la ventaja absoluta, lo que comprimía las probabilidades hacia el 50 % (backtest EuroLiga: acierto 65,3 % pero predicciones demasiado cercanas a 50/50). Se cambió para actuar solo sobre la **desviación respecto a la ventaja esperada** (simulación piloto), y la pendiente real/previsto quedó ≈ 1.
3. **Faltas intencionadas**: la regla inicial era demasiado agresiva (y se activaba al revés perdiendo de 1-2); se reescribió según la diferencia y el tiempo (ver `docs/modelo.md`).
4. **Variabilidad de minutos**: el CV de minutos simulado (0,19 titulares / 0,33 suplentes) era menor que el real (0,21 / 0,38 en la EuroLiga 2025-26); `minutesSd` pasó de 0,15 a 0,21, lo que redujo la sobreconfianza en las líneas altas de jugadores.
5. **Peso de la temporada anterior y regularización**: probados K = 8, 16 y 30 y *prior* de 60, 150 y 300 minutos en el backtest de la EuroLiga; se eligió K = 16 y 150 minutos (Brier 0,218 frente a 0,223 del valor inicial).
6. **Temporada previa en el backtest**: sin la 2024-25 los primeros partidos se simulaban casi sin datos; se descargó la 2024-25 (partido a partido en EuroLiga y ACB; totales agregados en la NBA) para que el backtest use la misma información que tendría el modelo en producción.
7. **Calibración sin información futura**: el backtest usaba los factores de calibración actuales, calibrados con datos posteriores. Se cambió a una recalibración cada 28 días con los datos disponibles en esa fecha. Además, como la anotación sube de una temporada a otra (ACB: 172 → 176 → 186 puntos por partido en 2024-25, 2025-26 y el inicio de 2026-27), las medias de la liga que sirven de objetivo de calibración dan a la temporada anterior un peso que decae rápido (1 / (1 + partidos de la temporada / 30)). El sesgo del total en la ACB pasó de −6,9 a −4,2 puntos.
8. **Final de partido**: con 2-4 puntos de diferencia a falta de un minuto, en la EuroLiga 2025-26 real se llegaba al empate el 10-20 % de las veces y en la simulación solo el 5-7 %. Se aceleraron los ataques del equipo que pierde en el último minuto y se le hizo buscar más triples perdiendo de 3 a 6; la tasa de prórrogas simulada subió de ≈ 2,2 % a ≈ 3,2 % (real ≈ 4,5 %).
9. **Uso del día**: las líneas de puntos de jugador eran demasiado estrechas (las probabilidades altas se cumplían menos y las bajas más de lo previsto). Se añadió una variabilidad lognormal del uso de cada jugador por partido; probados 0, 0,2 y 0,35 en el backtest de la EuroLiga (ECE de puntos 0,024 / 0,018 / 0,013, sin empeorar el Brier del ganador); se eligió 0,3 porque valores mayores ensanchan en exceso el total del partido.
10. **Forma del día** (acierto correlacionado por equipo y partido): probada para mejorar la tasa de prórrogas, sin efecto; desactivada.

## 7. Limitaciones conocidas

- **Prórrogas infraestimadas**: ≈ 2-3 % simuladas frente a ≈ 4-5 % reales. La proporción de partidos ajustados (|margen| ≤ 3 al final del tiempo reglamentario) sí coincide (≈ 18 %), pero los finales reales acumulan más empates exactos de los que reproduce la lógica de final de partido.
- **Tendencia de anotación dentro de la temporada**: en la ACB 2025-26 la anotación subió de ≈ 171 puntos por partido en noviembre a ≈ 182 en mayo; el modelo solo usa lo ocurrido hasta cada fecha y va por detrás (sesgo del total de −5 a −7 puntos en los últimos meses, ECE del over/under del total más alta en la ACB). En producción conviene recalibrar a menudo (`npm run calibrate`).
- La ventaja de campo es la media de la liga (no específica de cada equipo) y la defensa es a nivel de equipo.
- El backtest supone conocidos los jugadores disponibles y los titulares (como ocurre poco antes del salto inicial); con quintetos solo «probables» la precisión sería algo menor.
- Líneas de jugador: puntos, triples y asistencias bien calibrados (ECE ≈ 0,01-0,02); los **rebotes de jugador en la NBA** salen algo sobreestimados en las líneas altas (por ejemplo, se prevé 65 % y ocurre 58 %; ECE 0,037), y en general las probabilidades altas (≥ 75 %) se cumplen algo menos de lo previsto: el modelo no recoge del todo los partidos con muy pocos minutos (lesiones durante el partido, decisiones técnicas).
- NBA: la fuente (pbpstats) no marca titulares en el box score; para 2026-27 se obtienen exactos de la distribución de tiempo en pista, pero en el backtest de 2025-26 se estiman como los 5 jugadores con más minutos en el primer cuarto (comprobado con 2026-27: coincide el 84 % de los titulares, jugador a jugador). Como temporada previa del backtest NBA se usan los totales agregados de 2024-25 (sin reparto por cuartos), porque descargar sus 1.230 partidos uno a uno con la fuente lenta habría llevado horas.
