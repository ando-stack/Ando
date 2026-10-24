# Validación del modelo (backtest)

Generado automáticamente por `npm run backtest` el 2026-10-24.

- **Temporada evaluada:** 2025 (ATP, ATP Challenger, WTA y WTA 125; cuadro final y previa).
- **Sin mirar el futuro:** el histórico se recorre en orden y cada partido se predice con los perfiles, el Elo y la forma calculados sólo con partidos anteriores. Las medias del circuito se calculan con las tres temporadas previas.
- **Parámetros:** `calibrado-2024` — calibrados con la temporada 2024 (`npm run calibrar`), que no se solapa con la evaluada.
- **Partidos:** 19.147 para la probabilidad de victoria (cálculo exacto) y 9823 con estadísticas detalladas para las distribuciones (simulación punto a punto, 300 simulaciones por partido; hasta 1200 por circuito y superficie). Se excluyen retiradas y walkovers.
- Peso del Elo 0.6, escala del logit 1.1, peso de la superficie en el Elo 0.1, forma 0, σ dominancia = 0.2 (por defecto; cada circuito y superficie tiene la suya, 0,12-0,21), σ común = 0.05, σ aces = 0.2.

## 1. Probabilidad de victoria

Log loss y Brier: cuanto más bajos, mejor (una moneda al aire da log loss 0,693 y Brier 0,25). Se compara el modelo combinado con el Elo de superficie solo y con las estadísticas de saque/resto solas.

| Grupo | Partidos | Log loss | Brier | Aciertos | Log loss sólo Elo | Log loss sólo estadísticas |
|---|---:|---:|---:|---:|---:|---:|
| Todos | 19147 | 0.607 | 0.211 | 66.2 % | 0.612 | 0.617 |
| ATP | 3755 | 0.613 | 0.213 | 66.4 % | 0.619 | 0.621 |
| ATP · Dura | 2189 | 0.608 | 0.211 | 67.0 % | 0.614 | 0.617 |
| ATP · Hierba | 468 | 0.634 | 0.221 | 65.4 % | 0.647 | 0.625 |
| ATP · Tierra batida | 1098 | 0.614 | 0.214 | 65.5 % | 0.618 | 0.629 |
| ATP Challenger | 9834 | 0.610 | 0.212 | 65.6 % | 0.613 | 0.621 |
| ATP Challenger · Dura | 4934 | 0.617 | 0.215 | 64.7 % | 0.618 | 0.630 |
| ATP Challenger · Hierba | 239 | 0.646 | 0.229 | 61.1 % | 0.650 | 0.654 |
| ATP Challenger · Tierra batida | 4661 | 0.600 | 0.208 | 66.8 % | 0.605 | 0.609 |
| WTA 125 | 1851 | 0.589 | 0.203 | 67.8 % | 0.596 | 0.601 |
| WTA 125 · Dura | 596 | 0.602 | 0.210 | 66.6 % | 0.609 | 0.611 |
| WTA 125 · Hierba | 127 | 0.666 | 0.234 | 59.8 % | 0.656 | 0.694 |
| WTA 125 · Tierra batida | 1128 | 0.573 | 0.196 | 69.3 % | 0.583 | 0.586 |
| WTA | 3707 | 0.603 | 0.209 | 66.8 % | 0.609 | 0.613 |
| WTA · Dura | 2338 | 0.606 | 0.210 | 66.4 % | 0.612 | 0.614 |
| WTA · Hierba | 507 | 0.625 | 0.218 | 65.5 % | 0.624 | 0.644 |
| WTA · Tierra batida | 862 | 0.579 | 0.198 | 68.6 % | 0.590 | 0.590 |

### Calibración de la probabilidad de victoria (todos los partidos)

| Rango predicho | Partidos | Predicho | Real |
|---|---:|---:|---:|
| 0.0–0.1 | 562 | 6.0 % | 7.5 % |
| 0.1–0.2 | 1062 | 15.5 % | 16.4 % |
| 0.2–0.3 | 1844 | 25.3 % | 27.2 % |
| 0.3–0.4 | 2702 | 35.2 % | 36.2 % |
| 0.4–0.5 | 3314 | 45.0 % | 44.5 % |
| 0.5–0.6 | 3462 | 55.0 % | 55.3 % |
| 0.6–0.7 | 2783 | 64.8 % | 62.4 % |
| 0.7–0.8 | 1809 | 74.6 % | 73.8 % |
| 0.8–0.9 | 1059 | 84.5 % | 81.6 % |
| 0.9–1.0 | 550 | 94.3 % | 92.7 % |

## 2. Distribuciones simuladas frente a la realidad

Medias por partido (simulado / real). «Over» = P(total por encima de la línea suelo(media simulada) + 0,5); se compara la probabilidad media predicha con la frecuencia real y se da su Brier.

| Grupo | Partidos | Juegos sim / real | P(over juegos) pred / real (Brier) | P(set decisivo) pred / real (Brier) | Aces sim / real | P(over aces) Brier | Dobles faltas sim / real | Breaks sim / real | Tie-breaks sim / real |
|---|---:|---|---|---|---|---:|---|---|---|
| Todos | 9823 | 22.86 / 22.96 | 41.4 % / 42.3 % (0.244) | 33.3 % / 33.9 % (0.220) | 7.67 / 7.73 | 0.249 | 6.48 / 6.61 | 6.50 / 6.51 | 0.34 / 0.33 |
| ATP | 2764 | 25.47 / 25.42 | 42.7 % / 42.1 % (0.244) | 35.0 % / 34.4 % (0.220) | 12.55 / 12.06 | 0.247 | 5.66 / 5.76 | 5.15 / 5.14 | 0.50 / 0.48 |
| ATP · Dura | 1200 | 24.70 / 25.14 | 41.6 % / 44.1 % (0.247) | 33.5 % / 34.5 % (0.221) | 14.00 / 13.78 | 0.249 | 5.93 / 5.93 | 4.78 / 4.79 | 0.49 / 0.52 |
| ATP · Hierba | 468 | 29.15 / 28.15 | 45.5 % / 39.1 % (0.245) | 37.0 % / 31.4 % (0.216) | 17.82 / 16.30 | 0.239 | 6.48 / 6.59 | 4.70 / 4.76 | 0.70 / 0.61 |
| ATP · Tierra batida | 1096 | 24.75 / 24.55 | 42.8 % / 41.2 % (0.240) | 35.9 % / 35.5 % (0.220) | 8.72 / 8.37 | 0.248 | 5.01 / 5.23 | 5.74 / 5.69 | 0.42 / 0.38 |
| ATP Challenger | 2639 | 22.40 / 22.67 | 40.9 % / 43.4 % (0.247) | 33.5 % / 35.6 % (0.227) | 7.77 / 8.50 | 0.254 | 5.95 / 6.00 | 5.73 / 5.72 | 0.34 / 0.33 |
| ATP Challenger · Dura | 1200 | 22.30 / 22.78 | 40.3 % / 44.4 % (0.249) | 32.1 % / 35.8 % (0.230) | 9.20 / 10.23 | 0.255 | 6.04 / 6.05 | 5.33 / 5.35 | 0.35 / 0.34 |
| ATP Challenger · Hierba | 239 | 23.73 / 23.31 | 42.2 % / 38.1 % (0.235) | 37.4 % / 34.7 % (0.221) | 12.87 / 12.40 | 0.241 | 5.68 / 6.19 | 4.53 / 4.60 | 0.48 / 0.41 |
| ATP Challenger · Tierra batida | 1200 | 22.24 / 22.42 | 41.3 % / 43.5 % (0.247) | 34.0 % / 35.6 % (0.226) | 5.33 / 6.00 | 0.255 | 5.92 / 5.90 | 6.38 / 6.32 | 0.30 / 0.30 |
| WTA 125 | 1851 | 21.27 / 21.28 | 40.9 % / 42.1 % (0.242) | 31.3 % / 32.7 % (0.214) | 3.40 / 3.62 | 0.251 | 7.37 / 7.55 | 8.26 / 8.29 | 0.23 / 0.21 |
| WTA 125 · Dura | 596 | 21.41 / 21.40 | 41.0 % / 42.6 % (0.243) | 31.7 % / 33.7 % (0.216) | 4.87 / 4.71 | 0.245 | 8.06 / 7.39 | 7.72 / 7.65 | 0.24 / 0.21 |
| WTA 125 · Hierba | 127 | 22.08 / 22.40 | 41.4 % / 43.3 % (0.248) | 33.8 % / 38.6 % (0.242) | 7.88 / 6.69 | 0.230 | 7.71 / 7.87 | 6.67 / 7.13 | 0.29 / 0.24 |
| WTA 125 · Tierra batida | 1128 | 21.10 / 21.10 | 40.8 % / 41.7 % (0.241) | 30.8 % / 31.5 % (0.210) | 2.11 / 2.69 | 0.256 | 6.96 / 7.59 | 8.71 / 8.76 | 0.21 / 0.20 |
| WTA | 2569 | 21.68 / 21.82 | 41.0 % / 41.5 % (0.243) | 32.6 % / 32.6 % (0.217) | 5.39 / 5.26 | 0.247 | 7.27 / 7.49 | 7.46 / 7.50 | 0.25 / 0.26 |
| WTA · Dura | 1200 | 21.63 / 21.82 | 41.0 % / 41.3 % (0.242) | 32.3 % / 32.4 % (0.216) | 5.68 / 5.66 | 0.246 | 7.62 / 7.83 | 7.36 / 7.45 | 0.25 / 0.26 |
| WTA · Hierba | 507 | 22.11 / 22.45 | 41.0 % / 44.6 % (0.248) | 33.4 % / 35.5 % (0.226) | 7.29 / 6.50 | 0.236 | 7.10 / 7.48 | 6.42 / 6.73 | 0.30 / 0.33 |
| WTA · Tierra batida | 862 | 21.50 / 21.44 | 41.1 % / 39.9 % (0.240) | 32.5 % / 31.2 % (0.213) | 3.88 / 3.97 | 0.254 | 6.87 / 7.03 | 8.21 / 8.04 | 0.23 / 0.23 |

### Calibración del over/under de juegos

| Rango predicho | Partidos | Predicho | Real |
|---|---:|---:|---:|
| 0.2–0.4 | 2914 | 37.7 % | 40.0 % |
| 0.4–0.6 | 6909 | 43.0 % | 43.3 % |

### Calibración de P(set decisivo) (número de sets)

| Rango predicho | Partidos | Predicho | Real |
|---|---:|---:|---:|
| 0.0–0.2 | 594 | 13.7 % | 14.8 % |
| 0.2–0.4 | 7884 | 33.2 % | 34.4 % |
| 0.4–0.6 | 1345 | 42.3 % | 39.7 % |

### Calibración del over/under de aces

| Rango predicho | Partidos | Predicho | Real |
|---|---:|---:|---:|
| 0.0–0.2 | 2 | 18.7 % | 50.0 % |
| 0.2–0.4 | 1542 | 36.5 % | 45.4 % |
| 0.4–0.6 | 8249 | 45.9 % | 47.6 % |
| 0.6–0.8 | 30 | 61.3 % | 83.3 % |

## 3. Lectura de los resultados y ajustes hechos

- **Probabilidad de victoria.** El modelo combinado mejora al Elo de superficie solo y a las estadísticas solas en casi todos los grupos con muchos partidos. Los grupos de hierba (pocos partidos, temporada corta) son los más ruidosos: ahí el Elo o las estadísticas solas a veces ganan por poco.
- **Juegos, breaks, dobles faltas y tie-breaks.** Las medias simuladas quedan muy cerca de las reales en el conjunto y en los grupos grandes. Las desviaciones mayores están en los grupos pequeños de hierba.
- **Aces.** En los Challenger de 2025 hubo más aces que en 2024 (la temporada de calibración) y el modelo se queda algo corto; también por eso la P(over aces) queda por debajo de la frecuencia real. La calibración de producción se hace con la temporada más reciente (2025) para recoger esa tendencia.
- **Ajustes hechos a partir de las validaciones** (historial en docs/modelo.md §6 y §3):
  1. La variabilidad partido a partido pasó de desplazamientos independientes por jugador a dos componentes (dominancia y condiciones), porque con la primera versión los partidos simulados duraban ≈ 1,5 juegos de más.
  2. Se añadió la escala del logit (k) porque el primer backtest mostró un modelo poco seguro en los extremos.
  3. La probabilidad «por estadísticas» se calcula sin variabilidad: con variabilidad, los pesos ajustados con una σ no servían para otra y el segundo backtest salió demasiado seguro (85 % predicho → 80 % real).
- **Parámetros en producción:** los mismos pasos, calibrados con la temporada 2025 (`engine/calibracion.json`). Este informe usa los de 2024 para que la evaluación sea fuera de muestra.
