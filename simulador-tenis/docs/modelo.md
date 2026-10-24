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

**Ajuste al Elo:** con `p_A`, `p_B` se calcula de forma exacta (cadenas de Markov, `engine/analitico.ts`) la probabilidad de victoria al mejor de 3 → `P_est` (sin variabilidad: es una medida de fuerza, y así los pesos calibrados no dependen de σ). El Elo de superficie con la forma da `P_elo`. La probabilidad objetivo es

```
logit P = k · [ w_elo · logit P_elo + (1 − w_elo) · logit P_est ]
```

`k` (escala) corrige que la mezcla sea poco segura de sí misma: en el primer backtest (sin escala) el modelo daba 74 % a favoritos que ganaron el 78 % de las veces y 7 % a jugadores que ganaron el 2 %. `k` se ajusta con la temporada de calibración junto a los demás pesos.

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

En cada simulación se sortean dos desplazamientos (en escala logit) de la probabilidad TOTAL de ganar un punto al saque:

- **Dominancia del día** `D ~ N(0, σ²)`: el saque de A se desplaza `+D` y el de B `−D` (un jugador en buena forma saca y resta mejor a la vez). Hace los partidos más o menos desequilibrados.
- **Condiciones del día** `C ~ N(0, σ_común²)`: el saque de ambos se desplaza `+C` (pista más rápida o lenta, viento, bolas). Cambia cuántos juegos al saque se ganan, no quién gana.

El desplazamiento se reparte entre primer y segundo saque con un mismo `τ` (Newton, en cada simulación), de modo que el motor y el cálculo exacto usan exactamente la misma probabilidad total. Además, el ritmo de aces de cada jugador se multiplica por un lognormal de media 1 y desviación `σ_aces`.

La probabilidad de victoria NO cambia por esta variabilidad: el ajuste al Elo del apartado 3 la integra (Gauss-Hermite de 10 nodos en `D` y 3 en `C`; los tests comprueban que la simulación y la integral coinciden). Lo que cambia es la dispersión (más sorpresas en el número de juegos, sets y aces). `σ`, `σ_común` y `σ_aces` se eligen por log score del total de juegos y de aces.

**Por qué dos componentes:** con desplazamientos independientes por jugador (primera versión), la calibración igualaba los breaks por partido pero los partidos simulados duraban ≈ 1,5 juegos más que los reales en todos los circuitos (y el log score seguía mejorando al subir σ hasta 0,3 sin quitar el sesgo): los breaks se repartían demasiado entre los dos jugadores. Con la dominancia separada, una σ de dominancia ≈ 0,2 iguala a la vez breaks y juegos en los 12 grupos de 2024 (diferencias ≤ 0,2 juegos; ver la tabla del apartado 7).

## 7. Calibración por circuito y superficie

`npm run calibrar` (por defecto con la temporada 2024; `TEMPORADA_CALIBRACION=2025` para producción). Perfiles, Elo y medias se calculan sólo con datos anteriores a cada partido.

1. **Probabilidad de victoria** (partidos al mejor de 3): rejilla de `w_elo` ∈ [0,3; 1], peso de la superficie ∈ [0; 0,7], `γ` de forma ∈ [0; 0,25] y escala `k` ∈ [0,9; 2], minimizando el log loss.
2. **Medias por grupo** (circuito × superficie, hasta 1.000 partidos con estadísticas por grupo, 200 simulaciones por partido), 4 + 3 iteraciones de ajuste conjunto:
   - desplazamiento del saque → iguala los **breaks** por partido;
   - **σ de dominancia** del grupo → iguala el **total de juegos** (≈ −14 juegos por unidad de σ);
   - factor de **aces** y de **dobles faltas** → iguala sus medias.
3. **σ común** (0,05 / 0,15 / 0,25) y **σ_aces** (0,2 / 0,3 / 0,4) por log score del total de juegos y de aces.

**Calibración con 2024** (la que evalúa el backtest de 2025): `w_elo = 0,6`, superficie `0,1`, `γ = 0`, `k = 1,1` (log loss 2024: 0,6068), σ común 0,05, σ_aces 0,2. La forma reciente no mejora al Elo (que ya pondera más lo reciente): `γ` queda en 0 y la forma se sigue mostrando en la ficha. Medias de 2024 tras calibrar (simulado / real, por partido):

| Grupo | Breaks | Aces | Dobles faltas | Juegos | σ dominancia |
|---|---|---|---|---|---|
| ATP · dura | 4,74 / 4,75 | 13,75 / 13,74 | 5,77 / 5,76 | 24,86 / 24,89 | 0,191 |
| ATP · tierra | 5,73 / 5,74 | 8,22 / 8,20 | 4,97 / 4,97 | 24,56 / 24,56 | 0,155 |
| ATP · hierba | 4,49 / 4,50 | 17,62 / 17,54 | 6,39 / 6,37 | 28,36 / 28,37 | 0,117 |
| Challenger · dura | 5,16 / 5,17 | 10,30 / 10,28 | 6,10 / 6,08 | 22,54 / 22,54 | 0,209 |
| Challenger · tierra | 6,29 / 6,31 | 6,03 / 6,04 | 6,03 / 6,04 | 22,25 / 22,28 | 0,184 |
| Challenger · hierba | 4,33 / 4,34 | 13,54 / 13,50 | 5,44 / 5,40 | 23,84 / 23,86 | 0,174 |
| WTA · dura | 7,42 / 7,42 | 5,71 / 5,71 | 7,69 / 7,68 | 21,73 / 21,72 | 0,190 |
| WTA · tierra | 8,33 / 8,33 | 3,58 / 3,57 | 6,88 / 6,88 | 21,66 / 21,65 | 0,183 |
| WTA · hierba | 6,54 / 6,55 | 6,85 / 6,88 | 7,13 / 7,15 | 22,16 / 22,20 | 0,183 |
| WTA 125 · dura | 7,68 / 7,68 | 5,39 / 5,40 | 8,39 / 8,38 | 21,67 / 21,68 | 0,194 |
| WTA 125 · tierra | 8,76 / 8,75 | 2,71 / 2,71 | 7,35 / 7,35 | 21,31 / 21,31 | 0,199 |
| WTA 125 · hierba | 7,03 / 7,00 | 7,17 / 7,14 | 8,34 / 8,28 | 22,33 / 22,21 | 0,195 |

Estas igualdades son en la muestra de calibración; la comprobación fuera de muestra es el backtest (apartado 8).

**Calibración de producción con 2025** (`engine/calibracion.json`, la que usa la web): `w_elo = 0,65`, superficie `0,2`, `γ = 0`, `k = 1` (log loss 2025: 0,6077), σ común 0,15, σ_aces 0,2, σ de dominancia por grupo entre 0,17 y 0,22. Medias de 2025 tras calibrar (simulado / real): ATP dura 25,19 / 25,20 juegos y 13,86 / 13,86 aces; Challenger dura 22,70 / 22,72 juegos y 10,20 / 10,21 aces; WTA tierra 21,46 / 21,44 juegos y 8,04 / 8,04 breaks; WTA 125 tierra 21,01 / 21,02 juegos (los 12 grupos, en el registro de `npm run calibrar`).

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
