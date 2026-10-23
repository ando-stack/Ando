# Modelo de simulación

El simulador juega cada partido **posesión a posesión y jugador a jugador** (`engine/simulate.ts`)
y repite el partido miles de veces (Monte Carlo) para obtener la distribución completa de cada
estadística. Equipo y jugadores son coherentes por construcción: las estadísticas de equipo son la
suma de las de sus jugadores, los puntos por cuarto suman el resultado final y siempre hay 5
jugadores por equipo en pista (los minutos suman 5 × duración del partido, prórrogas incluidas).

## 1. Datos de entrada (`ingest/build.ts`)

Todo se calcula a partir de box scores partido a partido de la temporada actual (2026-27) y la
anterior (2025-26).

**Peso de cada temporada.** Para cada equipo, la temporada anterior pesa
`w = 1 / (1 + partidos_actuales / 16)` por partido: con 0 partidos jugados manda la anterior; con
16, la anterior vale la mitad por partido; con 48, un 25 %. Se aplica a equipos y a sus jugadores.
El valor 16 se eligió con el backtest de la EuroLiga 2025-26 (probados 8, 16 y 30: Brier 0,223,
0,218 y 0,220).

**Equipo.** Medias por partido propias y del rival; posesiones `FGA − OREB + TOV + 0,44·FTA`
(media de ambos equipos); eficiencias ofensiva y defensiva por 100 posesiones; % de rebote
ofensivo `OREB/(OREB+DREB rival)` y defensivo; pérdidas por posesión propias y forzadas;
asistencias por canasta; robos por posesión rival; tapones por tiro de 2 rival; % de tiro propios y
concedidos; proporción de triples; tiros libres por tiro de campo; puntos por cuarto a favor y en
contra; rendimiento como local y visitante.

**Jugador.** Tasas por minuto en pista de todas las estadísticas (tiros de 2 y 3 intentados y
anotados, tiros libres, rebotes ofensivos y defensivos, asistencias, robos, tapones, pérdidas,
faltas cometidas y recibidas). Se regularizan con un *prior* de 150 minutos (probados 60, 150 y 300 en el backtest; 150 fue el
mejor) hacia la media de su
posición en la competición (o hacia sus tasas en la otra competición europea, ajustadas de nivel,
si ha jugado allí). Porcentajes regularizados con un *prior* de 100 intentos de 2, 120 de 3 y 40
tiros libres. Uso = posesiones que termina (FGA + 0,44·FTA + TOV) / posesiones del equipo con él en
pista. Patrón de minutos por cuarto: fracción de sus minutos de tiempo reglamentario jugada en cada
cuarto (con un *prior* de ~3 partidos del patrón medio de titulares o suplentes de la liga).

**Estimaciones.** Jugadores con menos de 100 minutos en la competición (temporada actual + anterior)
se marcan como *estimados*: su perfil es la media de su posición en esa competición o, si se le
encuentra por nombre en la otra liga europea (EuroLiga ↔ ACB), sus tasas allí multiplicadas por el
cociente entre las medias de ambas ligas en cada estadística.

**Quinteto probable y rotación.** Titulares: más titularidades en los últimos 5 partidos del
equipo (los más recientes pesan más), excluyendo bajas. Minutos: 70 % media ponderada reciente +
30 % media de temporada, escalados a 5 × 48 (NBA) o 5 × 40 (FIBA) minutos y limitados al máximo de
jugadores en acta (13 NBA, 12 FIBA).

**Bajas.** Ausencias recientes inferidas (no aparecer en el acta, o no jugar en la NBA, en los
últimos 2 partidos del equipo habiendo jugado antes) y bajas manuales con fuente
(`data/manual/bajas.json`). Por defecto se marcan como baja y el usuario puede cambiarlo.

## 2. Preparación de un partido (`engine/prepare.ts`)

Con los titulares, minutos y bajas elegidos por el usuario (los minutos se reescalan para sumar
5 × duración reglamentaria) se construye para cada jugador:

- `uso` = (T2I + T3I + viajes a TL + pérdidas) por minuto, donde *viajes a TL* = (TLI − tasa de 2+1 ×
  canastas) / (2 + fracción de viajes de 3 tiros).
- reparto de sus posesiones usadas: pérdida, viaje a la línea, tiro de 2, tiro de 3;
- porcentajes de 2, 3 y TL; pesos por minuto para rebotes, asistencias, robos, tapones y faltas.

Por equipo: ritmo (posesiones), % de rebote, asistencias por canasta y **multiplicadores
defensivos** = lo que concede respecto a la media de la liga (acierto de 2 y de 3 del rival —este
último regularizado al 60 % porque el % de triple concedido es muy ruidoso—, pérdidas forzadas,
faltas en el tiro concedidas, proporción de triples del rival), probabilidad de que una pérdida
rival sea un robo y de taponar un fallo de 2.

## 3. Simulación de un partido (`engine/simulate.ts`)

1. **Ritmo.** Posesiones del partido = `ritmo_local × ritmo_visitante / ritmo_liga`, con
   variabilidad normal (desv. 3,5 %) y un factor de calibración. La duración media de una posesión
   es `48·60 / (2·posesiones)` (o 40·60); cada jugada dura un tiempo Erlang(3) con esa media,
   limitado a 24 s (14 s tras rebote ofensivo), más corta en contraataques tras robo.
2. **Rotaciones.** Cada jugador recibe unos minutos objetivo con variabilidad lognormal
   (desv. 21 % para quien juega ≥ 20 min y 42 % para el resto, valores ajustados a la variabilidad
   real de minutos de la EuroLiga/ACB 2025-26), repartidos por cuartos según su patrón y reescalados
   para que cada cuarto sume 5 × duración. En cada balón muerto (faltas, pérdidas sin robo, tiros
   libres, la mitad de las canastas) se eligen los 5 con mayor «necesidad» = minutos que le faltan
   en el cuarto / tiempo que queda, con histéresis para evitar cambios continuos. Los titulares
   designados empiezan el 1.º y el 3.º cuarto. **Problemas de faltas**: con 2 faltas en el 1.º
   cuarto, 3 en el 2.º o (eliminación − 1) en el 3.º (o en el 4.º si queda más de medio cuarto) su
   necesidad baja al 30 %. **Eliminación**: al llegar a 5 (FIBA) o 6 (NBA) faltas sale y no vuelve
   (si el equipo se queda sin 5 jugadores disponibles, vuelve a pista sin sumar más faltas
   personales). Con más de 20 puntos de diferencia en el último 40 % del 4.º cuarto, juegan más los
   suplentes («tiempo de la basura»).
3. **Cada posesión.** Primero puede haber una falta personal no de tiro (tasa calibrada, ajustada
   por la tendencia a hacer faltas de los defensores en pista); si el equipo está en bonus, 2 tiros
   libres. Si no, se elige el jugador que termina la posesión entre los 5 en pista en proporción a
   su uso, y la acción según su reparto ajustado por la defensa rival (multiplicadores de pérdidas,
   faltas en el tiro y proporción de triples) y el contexto (final de partido).
   - **Pérdida**: una fracción (12 %) son faltas en ataque (falta personal del atacante, falta
     recibida para un defensor); del resto, con probabilidad = robos/pérdidas rivales del equipo
     defensor (ajustada por los robadores en pista), hay robo y la siguiente posesión es un
     contraataque.
   - **Viaje a la línea** (falta en el tiro sin canasta): falta para un defensor (ponderado por su
     tasa de faltas), 2 tiros libres (3 en una pequeña fracción).
   - **Tiro de 2 o de 3**: acierto = % del jugador × multiplicador defensivo rival × factor de
     calibración × ventaja de campo (+h/2 local, −h/2 visitante) × efecto marcador (abajo), ×0,6 si
     es un tiro sobre la bocina.
4. **Canasta**: puede ser asistida con probabilidad = asistencias por canasta del equipo
   (más alta en triples, ×1,35, que en canastas de 2, ×0,85, normalizado) ajustada por los
   pasadores en pista; el asistente se elige entre los otros 4 por su tasa de asistencias. Con
   probabilidad 4 % es un 2+1 / 3+1.
5. **Tapones**: un fallo de 2 puede ser tapón de un defensor (probabilidad del equipo, ajustada por
   los taponadores en pista, asignado por tasa de tapones).
6. **Rebotes**: tras un fallo (o el último tiro libre fallado), rebote ofensivo con probabilidad
   combinada tipo *log5* entre el % de rebote ofensivo del atacante y el % concedido por el
   defensor, ajustada por los reboteadores en pista (y ×0,45 tras tiro libre). Una fracción
   calibrada de los rebotes son «de equipo» (balón fuera, etc.) y no se asignan a ningún jugador,
   como en las actas oficiales. El rebote se asigna a un jugador por su tasa de rebote ofensivo o
   defensivo. El rebote ofensivo continúa la posesión.
7. **Faltas y bonus** (config/reglas.ts):
   - NBA: penalización desde la 5.ª falta de equipo del periodo (4.ª en la prórroga); en los dos
     últimos minutos, la 2.ª falta del equipo si no había llegado al cupo; las faltas en ataque no
     cuentan como falta de equipo.
   - FIBA: penalización desde la 5.ª falta de equipo del cuarto; las de la prórroga cuentan como del
     4.º cuarto; las faltas en ataque cuentan como falta de equipo (pero se castigan con saque).
8. **Prórrogas**: si hay empate al final, prórrogas de 5 minutos hasta que haya ganador (salto
   inicial en el 1.º periodo y prórrogas; saques alternos según cada reglamento en el resto).
9. **Final de partido** (último cuarto y prórrogas):
   - El que pierde hace faltas intencionadas cuando defiende: perdiendo de 1-2 si quedan menos
     segundos que el reloj de posesión; de 3, solo en los últimos 8 s (40 % de las veces); de 4 a 6,
     en el último 60 % de la ventana (60 s NBA / 50 s FIBA); de 7 a 9, en toda la ventana. La falta
     se hace sobre un atacante elegido por uso y por mal porcentaje de tiros libres.
   - En los dos últimos minutos el que gana agota la posesión (≥ 18 s de media) y el que pierde
     acelera (×0,6).
   - Con empate o perdiendo de 1-3 y el reloj por debajo de 24 s, se juega el último tiro; perdiendo
     de 3 en los últimos 30 s se buscan triples (×5); perdiendo de 1-2 en los últimos 24 s, tiros de
     2 (×1,8); perdiendo de 4 o más en el último minuto, más triples (×1,6).
10. **Efecto marcador.** En los partidos reales la dispersión del margen es menor que la de
    posesiones independientes (el que va ganando se relaja y el que pierde aprieta). El acierto del
    equipo que va *por encima de la ventaja esperada a esas alturas del partido* se reduce un
    `scoreEffect × desviación / 10` (y aumenta si va por debajo). La ventaja esperada sale de una
    simulación piloto de 120 partidos con semilla fija, así que no se penaliza al mejor equipo por
    ser mejor: solo se reduce la varianza. `scoreEffect` se calibra para reproducir la desviación
    típica real del margen.

## 4. Calibración (`engine/calibrate.ts`, `config/calibracion.json`)

Se simulan todos los cruces posibles entre los equipos de la competición (con su rotación por
defecto) y se ajustan iterativamente (8 iteraciones, con amortiguación) los factores globales para
que las medias simuladas por equipo y partido coincidan con las reales de la competición (temporada
actual + anterior ponderada):

| Factor | Se ajusta con |
|---|---|
| `paceFactor` | posesiones |
| `fg2Factor`, `fg3Factor`, `ftFactor` | % de 2, de 3 y de TL |
| `tovFactor` | pérdidas por posesión |
| `tripFactor` | tiros libres intentados por posesión |
| `orebFactor` | % de rebote ofensivo (en *odds*) |
| `teamReboundShare` | rebotes de jugador totales |
| `astFactor` | asistencias por canasta |
| `stlFactor` | robos por pérdida |
| `blkFactor` | tapones por fallo de 2 |
| `nonShootingFoulRate` | faltas personales |
| `homeShootingEdge` | margen medio a favor del local |
| `scoreEffect` | desviación típica del margen |

Los valores reales, simulados y los factores resultantes de cada competición están en
`config/calibracion.json` y en la página «Acerca». Los resultados del backtest están en
`docs/validacion.md`.

## 5. Agregación y mercados (`engine/aggregate.ts`, `engine/markets.ts`)

Cada worker agrega sus simulaciones en histogramas (número de veces que sale cada valor) de: puntos
por cuarto y mitad de cada equipo y del total, margen final y por cuarto, marcadores exactos,
prórrogas, todas las estadísticas de equipo (local, visitante y partido) y de cada jugador
(incluidas las combinadas, minutos, dobles-dobles, triples-dobles, eliminaciones y máximos del
partido, con los empates repartidos). El hilo principal combina los histogramas y de ellos salen
medias, over/under (línea x,5 o de 0,5 en 0,5, en el rango elegido), hándicaps (el equipo cubre si
su margen + la línea > 0), márgenes por tramos y punto a punto, ganador de cada cuarto/mitad
(incluido el empate) y mejor cuarto de cada equipo. Todas las distribuciones se muestran ordenadas
de mayor a menor frecuencia con número de veces y porcentaje (y, opcionalmente, cuota justa =
1/probabilidad).

**Reproducibilidad.** Generador xoshiro128** con semilla; cada worker usa una semilla derivada
de la global y su índice, así que con la misma semilla y el mismo número de workers el resultado es
idéntico.

## 6. Limitaciones conocidas

- No se modelan emparejamientos individuales, alineaciones concretas ni cansancio dentro del
  partido; la defensa es a nivel de equipo.
- La ventaja de campo es la media de la liga (no específica de cada equipo).
- La tasa de prórrogas simulada es más baja que la real (≈ 2-3 % frente a ≈ 4-5 %): el modelo de
  final de partido no reproduce del todo la acumulación de empates al final del tiempo
  reglamentario.
- Los cruces entre competiciones no están soportados (solo partidos dentro de la misma liga).
