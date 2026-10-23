# Modelo y motor de simulación

Código: `engine/` (motor, cálculo exacto, modelo, perfiles, Elo, agregación, coherencia) y `config/formatos.ts`. Parámetros ajustados: `engine/calibracion.json` (generado por `npm run calibrar`) y `public/data/modelo.json` (lo que usa la web).

## 1. Datos de cada jugador (perfil)

`engine/perfiles.ts` recorre el histórico **en orden cronológico** y mantiene, por jugador y superficie (dura —incluye moqueta—, tierra, hierba y «todas»):

- Sumas de puntos al saque, primeros dentro, ganados con el primero y con el segundo, aces, dobles faltas, juegos al saque, puntos de break afrontados y salvados; puntos al resto y ganados, aces recibidos, juegos al resto y breaks; tie-breaks jugados y ganados.
- **Decaimiento exponencial** con vida media de 365 días: un partido de hace un año pesa la mitad que uno de hoy. Se usan las estadísticas desde el 1-1-2023 (≈ 3 temporadas).
- **Ajuste por el rival:** además de las sumas brutas se acumula el *exceso* de puntos ganados al saque frente a lo esperado contra ese rival concreto (`ganados − puntos · (media_superficie − exceso_resto_rival)`) y lo mismo al resto. Así, ganar muchos puntos al saque contra rivales flojos (ITF, previas) cuenta menos que hacerlo contra buenos restadores.
- Número de partidos **reales** con estadísticas (sin ponderar), que se muestra en la ficha.

Se excluyen walkovers; las retiradas cuentan para la forma pero no para el Elo ni para las estadísticas.

## 2. Elo general y por superficie

`engine/elo.ts`, variante del método de FiveThirtyEight / Tennis Abstract:

- Rating inicial 1500; histórico desde 2020 con **todos los niveles** (ATP, Challenger, ITF/Futures, WTA, WTA 125, ITF femenino, Copa Davis/BJK) para que los ratings de los distintos circuitos estén en la misma escala.
- `K = 250 / (n + 5)^0,4`, con `n` = partidos previos del jugador (general) o en esa superficie (rating de superficie); ×1,1 en partidos al mejor de 5.
- Probabilidad: `1 / (1 + 10^((Rb − Ra)/400))` con `R = (1 − w)·general + w·superficie`; `w` (peso de la superficie) se calibra.
- Jugadores con < 5 partidos y ranking conocido: el Elo se completa con la regresión `Elo ≈ a + b·ln(ranking)` ajustada sobre jugadores con ≥ 30 partidos (se marca «Elo estimado por ranking»).
- **Forma reciente:** residuo `resultado − probabilidad Elo previa`, acumulado con vida media de 45 días. Entra en el logit de la probabilidad Elo multiplicado por `γ` (calibrado).

## 3. Probabilidad de ganar un punto al saque en ESTE partido

Para cada jugador y superficie se estiman, con **contracción jerárquica** (regularización de jugadores con pocos datos):

```
valor_superficie = (suma_sup + K_s · prior_sup) / (n_sup + K_s)
prior_sup        = valor_todas + (media_pool_sup − media_pool_todas)
valor_todas      = (suma_todas + K · prior) / (n_todas + K)
```

- Para el **exceso de saque y de resto**, el prior sale del nivel del jugador: `a + b·(Elo − 1500)/100`, con `a` y `b` ajustados por regresión ponderada sobre jugadores con muchos puntos (por circuito masculino y femenino). Un jugador sin datos queda, por tanto, en lo que corresponde a su Elo.
- Para porcentajes de primeros, ganados con primero/segundo, aces y dobles faltas, el prior es la media de su circuito (masculino/femenino) en la superficie.
- Fuerzas `K` (en puntos o segundos saques): saque 600, resto 600, primeros 300, ganados 300, aces 600, dobles 300, aces recibidos 800, superficie 400.

**Combinación (Barnett y Clarke, 2005):**

```
p_A = media_saque_sup + exceso_saque_A − exceso_resto_B   (+ desplazamiento de calibración)
```

**Ajuste al Elo:** con `p_A`, `p_B` se calcula de forma exacta (cadenas de Markov, `engine/analitico.ts`) la probabilidad de victoria al mejor de 3 integrando la variabilidad partido a partido (Gauss-Hermite) → `P_est`. El Elo de superficie con la forma da `P_elo`. La probabilidad objetivo es

```
logit P = w_elo · logit P_elo + (1 − w_elo) · logit P_est
```

y se busca `δ` tal que `p_A' = σ(logit p_A + δ)`, `p_B' = σ(logit p_B − δ)` den exactamente esa probabilidad al mejor de 3. Ese mismo `δ` se usa en el formato real: al mejor de 5 la ventaja se amplifica de forma natural. Así la probabilidad de victoria hereda la buena calibración del Elo, y las estadísticas deciden *cómo* se gana (más o menos breaks, tie-breaks, aces).

## 4. Dentro de cada punto

`engine/modelo.ts → componentesSaque` reparte `p_A'` en sucesos coherentes:

- primer saque dentro con probabilidad `f1` (del jugador);
- segundo saque dentro con `1 − DF` (DF = dobles faltas por segundo saque);
- probabilidad de ganar con el primero/segundo **dentro**: las del jugador desplazadas por un mismo `τ` en logit hasta que `f1·g1 + (1 − f1)(1 − DF)·g2 = p_A'`;
- aces: el ritmo del jugador × (aces que concede el rival / media del circuito) × factor de calibración, repartido entre primer y segundo saque con `P(ace | 2.º) = ρ·P(ace | 1.º)` (`ρ = 0,15`, hipótesis documentada: las fuentes sólo dan el total de aces). Los aces están incluidos en `g1`/`g2`, de modo que no cambian la probabilidad total del punto.

## 5. Juegos, sets y formatos

`engine/motor.ts` juega punto a punto: juegos con ventaja (o punto decisivo en Next Gen), sets con tie-break en `tiebreakEn-tiebreakEn`, set decisivo según el formato (tie-break a 7, a 10, ventaja o super tie-break). Saque: alterna cada juego; en el tie-break saca primero quien tiene el turno y después cada dos puntos; tras el tie-break el turno sigue alternando, por lo que el set siguiente lo empieza quien restó el primer punto del tie-break. El primer sacador del partido se sortea en cada simulación.

Formatos verificados (ver cabecera de `config/formatos.ts`): ATP y Challenger al mejor de 3 con tie-break a 7 en todos los sets (ATP Rulebook 2025 1.03 B.1); WTA y WTA 125 igual (WTA Rulebook 2026 §39.a y apéndice E §40.a); Grand Slams: cuadro final masculino al mejor de 5, resto al mejor de 3, y tie-break a 10 a 6-6 del set final (Grand Slam Rule Book 2026); Next Gen ATP Finals: sets a 4 juegos, tie-break a 3-3, mejor de 5 y sin ventaja.

## 6. Variabilidad partido a partido

En cada simulación el logit de la probabilidad de saque de cada jugador se desplaza con `N(0, σ²)` independientes (cubre tanto días buenos/malos como partidos más o menos dominados por el saque) y el ritmo de aces de cada jugador se multiplica por un lognormal de media 1 y desviación `σ_aces`. La probabilidad de victoria NO cambia por ello: el ajuste al Elo del apartado 3 ya integra esa variabilidad. Lo que cambia es la dispersión (más sorpresas en el número de juegos, sets y aces), y `σ` y `σ_aces` se eligen por log score del total de juegos y de aces.

## 7. Calibración por circuito y superficie

`npm run calibrar` usa la temporada **2024** (perfiles calculados sólo con datos anteriores a cada partido):

1. Rejilla de `w_elo`, peso de la superficie en el Elo y `γ` de forma, minimizando el log loss de la probabilidad de victoria.
2. Para cada circuito × superficie se simulan hasta 1.000 partidos con estadísticas (200 simulaciones cada uno) y se ajustan iterativamente: desplazamiento del saque (para igualar los **breaks** por partido, y con ellos juegos y tie-breaks), factor de **aces** y factor de **dobles faltas**, hasta que las medias simuladas coinciden con las reales.
3. Rejilla de `σ` y `σ_aces`.

## 8. Validación

`npm run backtest` simula la temporada **2025**, que no se ha usado para ajustar nada, con los datos disponibles antes de cada partido. Métricas: log loss, Brier, aciertos y calibración de la probabilidad de victoria (comparada con el Elo solo y con las estadísticas solas); medias simuladas frente a reales de juegos, aces, dobles faltas, breaks y tie-breaks; Brier y calibración de P(over) del total de juegos y de aces, y de P(set decisivo). Resultados en `docs/validacion.md`.

## 9. Agregación y coherencia

`engine/agregacion.ts` guarda histogramas (número de veces) de todo: resultado en sets, marcadores exactos, juegos (total, por jugador, diferencia), sets, cada set (ganador, marcador, juegos), tie-breaks, aces, dobles faltas, breaks, puntos de break disputados, juegos al saque perdidos y porcentajes de saque. Los over/under y hándicaps se calculan a partir de los histogramas para cualquier línea. `engine/coherencia.ts` comprueba **cada** simulación (marcadores de set posibles en ese formato, el partido acaba cuando debe, ganador correcto, suma de juegos = juegos al saque + tie-breaks, breaks = puntos de break convertidos = juegos al saque perdidos del rival, puntos coherentes); el número de simulaciones incoherentes se muestra en la interfaz (debe ser 0).

## 10. Jugadores con pocos datos (estimaciones)

Si un jugador tiene menos de 10 partidos con estadísticas en el histórico usado, la ficha y los resultados lo marcan como **Estimado** e indican cuántos partidos reales hay. En ese caso sus parámetros salen casi por completo de los priors: nivel (Elo, o ranking si tampoco hay Elo), superficie y media del circuito, según las fórmulas del apartado 3.

## 11. Interpretación y limitaciones

- La probabilidad de victoria está anclada al Elo; las estadísticas aportan sobre todo el reparto saque/resto (estilo de partido). Con pocos datos, el estilo es el de un jugador medio de su nivel.
- No se modela el cansancio, las lesiones, la altitud, la velocidad de pista concreta ni la pista cubierta/exterior (sólo la superficie).
- Los puntos se consideran independientes dentro de un partido (salvo la variación de nivel por partido); no hay «momentum» punto a punto.
- Los resultados recientes del ATP Tour y de los Challenger (junio-octubre de 2026) no tienen estadísticas: sus jugadores actualizan Elo y forma, pero sus perfiles de saque/resto se basan en partidos hasta mayo/junio de 2026 (con WTA y WTA 125 sí actualizados).
