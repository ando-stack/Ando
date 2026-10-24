# Validación del modelo (backtest)

Generado automáticamente por `npm run backtest` el 2026-10-24.

- **Temporada evaluada:** 2025 (ATP, ATP Challenger, WTA y WTA 125; cuadro final y previa).
- **Sin mirar el futuro:** el histórico se recorre en orden y cada partido se predice con los perfiles, el Elo y la forma calculados sólo con partidos anteriores. Las medias del circuito se calculan con las tres temporadas previas.
- **Parámetros:** `calibrado-2024` — calibrados con la temporada 2024 (`npm run calibrar`), que no se solapa con la evaluada.
- **Partidos:** 19.147 para la probabilidad de victoria (cálculo exacto) y 9823 con estadísticas detalladas para las distribuciones (simulación punto a punto, 300 simulaciones por partido; hasta 1200 por circuito y superficie). Se excluyen retiradas y walkovers.
- Peso del Elo 0.8, peso de la superficie en el Elo 0.2, forma 0, σ dominancia = 0.2, σ común = 0.05, σ aces = 0.2.

## 1. Probabilidad de victoria

Log loss y Brier: cuanto más bajos, mejor (una moneda al aire da log loss 0,693 y Brier 0,25). Se compara el modelo combinado con el Elo de superficie solo y con las estadísticas de saque/resto solas.

| Grupo | Partidos | Log loss | Brier | Aciertos | Log loss sólo Elo | Log loss sólo estadísticas |
|---|---:|---:|---:|---:|---:|---:|
| Todos | 19147 | 0.609 | 0.211 | 65.9 % | 0.611 | 0.618 |
| ATP | 3755 | 0.615 | 0.214 | 65.6 % | 0.617 | 0.623 |
| ATP · Dura | 2189 | 0.611 | 0.213 | 66.1 % | 0.613 | 0.621 |
| ATP · Hierba | 468 | 0.635 | 0.223 | 63.7 % | 0.640 | 0.624 |
| ATP · Tierra batida | 1098 | 0.613 | 0.213 | 65.5 % | 0.615 | 0.628 |
| ATP Challenger | 9834 | 0.611 | 0.212 | 65.7 % | 0.612 | 0.622 |
| ATP Challenger · Dura | 4934 | 0.616 | 0.214 | 64.8 % | 0.617 | 0.628 |
| ATP Challenger · Hierba | 239 | 0.650 | 0.230 | 59.8 % | 0.652 | 0.654 |
| ATP Challenger · Tierra batida | 4661 | 0.603 | 0.209 | 66.9 % | 0.604 | 0.615 |
| WTA 125 | 1851 | 0.594 | 0.205 | 66.8 % | 0.595 | 0.603 |
| WTA 125 · Dura | 596 | 0.605 | 0.211 | 65.8 % | 0.608 | 0.609 |
| WTA 125 · Hierba | 127 | 0.656 | 0.232 | 63.0 % | 0.657 | 0.663 |
| WTA 125 · Tierra batida | 1128 | 0.581 | 0.199 | 67.8 % | 0.581 | 0.593 |
| WTA | 3707 | 0.606 | 0.210 | 66.4 % | 0.608 | 0.611 |
| WTA · Dura | 2338 | 0.610 | 0.212 | 65.8 % | 0.612 | 0.613 |
| WTA · Hierba | 507 | 0.622 | 0.217 | 65.3 % | 0.623 | 0.630 |
| WTA · Tierra batida | 862 | 0.586 | 0.201 | 68.8 % | 0.588 | 0.593 |

### Calibración de la probabilidad de victoria (todos los partidos)

| Rango predicho | Partidos | Predicho | Real |
|---|---:|---:|---:|
| 0.0–0.1 | 213 | 6.9 % | 2.3 % |
| 0.1–0.2 | 765 | 15.6 % | 11.2 % |
| 0.2–0.3 | 1616 | 25.6 % | 23.1 % |
| 0.3–0.4 | 2904 | 35.4 % | 32.9 % |
| 0.4–0.5 | 4070 | 45.2 % | 44.6 % |
| 0.5–0.6 | 4078 | 54.9 % | 55.1 % |
| 0.6–0.7 | 2946 | 64.6 % | 66.2 % |
| 0.7–0.8 | 1609 | 74.2 % | 78.2 % |
| 0.8–0.9 | 705 | 84.2 % | 86.1 % |
| 0.9–1.0 | 241 | 93.0 % | 95.0 % |

## 2. Distribuciones simuladas frente a la realidad

Medias por partido (simulado / real). «Over» = P(total por encima de la línea suelo(media simulada) + 0,5); se compara la probabilidad media predicha con la frecuencia real y se da su Brier.

| Grupo | Partidos | Juegos sim / real | P(over juegos) pred / real (Brier) | P(set decisivo) pred / real (Brier) | Aces sim / real | P(over aces) Brier | Dobles faltas sim / real | Breaks sim / real | Tie-breaks sim / real |
|---|---:|---|---|---|---|---:|---|---|---|
| Todos | 9823 | 22.91 / 22.96 | 41.5 % / 41.9 % (0.243) | 33.5 % / 33.9 % (0.221) | 7.68 / 7.73 | 0.249 | 6.50 / 6.61 | 6.51 / 6.51 | 0.34 / 0.33 |
| ATP | 2764 | 25.50 / 25.42 | 42.7 % / 41.9 % (0.244) | 35.0 % / 34.4 % (0.221) | 12.58 / 12.06 | 0.246 | 5.67 / 5.76 | 5.15 / 5.14 | 0.50 / 0.48 |
| ATP · Dura | 1200 | 24.73 / 25.14 | 41.5 % / 43.2 % (0.245) | 33.4 % / 34.5 % (0.222) | 14.03 / 13.78 | 0.249 | 5.95 / 5.93 | 4.79 / 4.79 | 0.49 / 0.52 |
| ATP · Hierba | 468 | 29.12 / 28.15 | 45.5 % / 40.4 % (0.245) | 36.8 % / 31.4 % (0.216) | 17.85 / 16.30 | 0.240 | 6.47 / 6.59 | 4.69 / 4.76 | 0.69 / 0.61 |
| ATP · Tierra batida | 1096 | 24.79 / 24.55 | 42.9 % / 41.2 % (0.243) | 36.0 % / 35.5 % (0.223) | 8.74 / 8.37 | 0.247 | 5.02 / 5.23 | 5.75 / 5.69 | 0.43 / 0.38 |
| ATP Challenger | 2639 | 22.43 / 22.67 | 40.8 % / 43.0 % (0.246) | 33.6 % / 35.6 % (0.227) | 7.77 / 8.50 | 0.254 | 5.96 / 6.00 | 5.73 / 5.72 | 0.34 / 0.33 |
| ATP Challenger · Dura | 1200 | 22.37 / 22.78 | 40.4 % / 44.3 % (0.248) | 32.5 % / 35.8 % (0.229) | 9.22 / 10.23 | 0.255 | 6.06 / 6.05 | 5.34 / 5.35 | 0.35 / 0.34 |
| ATP Challenger · Hierba | 239 | 23.66 / 23.31 | 41.9 % / 38.5 % (0.237) | 37.0 % / 34.7 % (0.225) | 12.85 / 12.40 | 0.244 | 5.66 / 6.19 | 4.51 / 4.60 | 0.47 / 0.41 |
| ATP Challenger · Tierra batida | 1200 | 22.25 / 22.42 | 41.1 % / 42.7 % (0.245) | 34.0 % / 35.6 % (0.226) | 5.31 / 6.00 | 0.256 | 5.92 / 5.90 | 6.38 / 6.32 | 0.31 / 0.30 |
| WTA 125 | 1851 | 21.33 / 21.28 | 40.9 % / 41.3 % (0.241) | 31.6 % / 32.7 % (0.215) | 3.40 / 3.62 | 0.250 | 7.40 / 7.55 | 8.28 / 8.29 | 0.23 / 0.21 |
| WTA 125 · Dura | 596 | 21.43 / 21.40 | 41.0 % / 40.8 % (0.241) | 31.7 % / 33.7 % (0.221) | 4.88 / 4.71 | 0.244 | 8.07 / 7.39 | 7.72 / 7.65 | 0.24 / 0.21 |
| WTA 125 · Hierba | 127 | 22.09 / 22.40 | 40.9 % / 43.3 % (0.245) | 33.6 % / 38.6 % (0.237) | 7.81 / 6.69 | 0.238 | 7.72 / 7.87 | 6.68 / 7.13 | 0.29 / 0.24 |
| WTA 125 · Tierra batida | 1128 | 21.19 / 21.10 | 40.9 % / 41.4 % (0.240) | 31.3 % / 31.5 % (0.210) | 2.12 / 2.69 | 0.254 | 7.01 / 7.59 | 8.75 / 8.76 | 0.21 / 0.20 |
| WTA | 2569 | 21.76 / 21.82 | 41.2 % / 41.3 % (0.242) | 33.0 % / 32.6 % (0.217) | 5.41 / 5.26 | 0.247 | 7.29 / 7.49 | 7.49 / 7.50 | 0.26 / 0.26 |
| WTA · Dura | 1200 | 21.70 / 21.82 | 41.2 % / 41.8 % (0.243) | 32.7 % / 32.4 % (0.215) | 5.70 / 5.66 | 0.246 | 7.66 / 7.83 | 7.38 / 7.45 | 0.25 / 0.26 |
| WTA · Hierba | 507 | 22.17 / 22.45 | 41.0 % / 42.8 % (0.243) | 33.7 % / 35.5 % (0.227) | 7.29 / 6.50 | 0.237 | 7.09 / 7.48 | 6.43 / 6.73 | 0.30 / 0.33 |
| WTA · Tierra batida | 862 | 21.60 / 21.44 | 41.4 % / 39.7 % (0.240) | 33.1 % / 31.2 % (0.214) | 3.90 / 3.97 | 0.253 | 6.91 / 7.03 | 8.25 / 8.04 | 0.24 / 0.23 |

### Calibración del over/under de juegos

| Rango predicho | Partidos | Predicho | Real |
|---|---:|---:|---:|
| 0.2–0.4 | 2764 | 38.0 % | 40.0 % |
| 0.4–0.6 | 7059 | 42.9 % | 42.7 % |

### Calibración de P(set decisivo) (número de sets)

| Rango predicho | Partidos | Predicho | Real |
|---|---:|---:|---:|
| 0.0–0.2 | 336 | 15.3 % | 12.2 % |
| 0.2–0.4 | 8472 | 33.2 % | 34.4 % |
| 0.4–0.6 | 1015 | 42.2 % | 37.0 % |

### Calibración del over/under de aces

| Rango predicho | Partidos | Predicho | Real |
|---|---:|---:|---:|
| 0.0–0.2 | 2 | 17.7 % | 50.0 % |
| 0.2–0.4 | 1511 | 36.5 % | 44.9 % |
| 0.4–0.6 | 8283 | 45.8 % | 47.3 % |
| 0.6–0.8 | 27 | 61.4 % | 74.1 % |

## 3. Lectura de los resultados

Ver la sección «Interpretación» de docs/modelo.md: qué significa cada métrica, qué grupos tienen menos datos y los ajustes hechos tras el backtest.
