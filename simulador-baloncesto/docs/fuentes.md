# Fuentes de datos

Revisión hecha el **23/10/2026**. Para cada competición se indica qué fuente se usa, qué se
descarga, sus condiciones de uso, si permiten el acceso automatizado y las alternativas
descartadas. **El simulador es una herramienta de uso personal y no comercial**: ninguna de las
fuentes autoriza la redistribución pública de sus datos ni su uso comercial.

## Política común de la ingesta (`ingest/lib/http.ts`)

- User-Agent identificativo y honesto (`SimuladorBaloncesto/1.0 …`), sin hacerse pasar por un navegador.
- Intervalo mínimo entre peticiones por dominio: pbpstats 1,5 s; EuroLiga 0,8 s; acb.com y live.acb.com 2,5 s.
- Caché en disco (`.cache/http`): los partidos terminados no se vuelven a pedir; listados y plantillas caducan en 3–24 h.
- Reintentos solo ante errores de red, 429 y 5xx, con espera exponencial y respetando `Retry-After`.
- Ante 401/403 o páginas de control anti-bots **no se reintenta ni se intenta eludir el bloqueo**: se registra el error en `data/data_updates.json` y se conservan los últimos datos válidos (con su fecha visible en la interfaz).
- Validación antes de guardar (`ingest/lib/validate.ts`): rangos posibles, jugadores existentes, quintetos de 5 jugadores de la plantilla, coherencia de puntos (jugadores = marcador, cuartos = marcador).
- No se usa ningún servicio de pago.

## NBA

| | |
|---|---|
| **Fuente usada** | [PBP Stats API](https://api.pbpstats.com/docs) (Darryl Blackport), API pública y documentada (OpenAPI), sin clave. Datos derivados del jugada a jugada oficial de NBA.com. |
| **Qué se descarga** | Equipos (`/get-teams/nba`), partidos de la temporada (`/get-games/nba`), box score por cuarto de cada partido (`/get-game-stats?Type=Player`: minutos por periodo, tiros de 2 y 3, tiros libres, rebotes, asistencias, robos, tapones, pérdidas, faltas cometidas y recibidas; puntos por periodo de cada equipo), plantilla por equipo (`/get-team-players-for-season`) y distribución del tiempo en pista de cada jugador (`/get-playing-time-distribution`) para saber quién fue titular. |
| **Condiciones** | La API no publica condiciones de uso. Las estadísticas son de NBA.com, cuyas [condiciones](https://www.nba.com/termsofuse) (apartado *NBA Statistics*) permiten su uso solo con fines periodísticos o **privados y no comerciales**, con atribución a NBA.com, y **prohíben** usarlas en relación con apuestas (incluso legales), productos de fantasy y bases de datos públicas de estadísticas actualizadas sin consentimiento. Por eso la herramienta se plantea como uso privado y la «cuota justa» está desactivada por defecto. |
| **Acceso automatizado** | Permitido de hecho (API pensada para programas, con ejemplos en Python). Se limita a 1 petición cada 1,5 s y todo queda en caché. |
| **Limitaciones** | La plantilla solo incluye jugadores que ya han jugado con el equipo esta temporada (los lesionados que no han debutado no aparecen). La fuente no marca titulares en el box score; para 2026-27 se obtienen exactos (en pista en el segundo 0), para 2025-26 se estiman como los 5 con más minutos en el primer cuarto (solo afecta al backtest). La fuente va unos días por detrás de los partidos más recientes. |
| **Descartadas** | `stats.nba.com` y `cdn.nba.com` (oficiales): bloquean el acceso desde redes de centros de datos (Akamai, «Access Denied» / sin respuesta) y sus condiciones restringen el uso. Basketball-Reference / Sports Reference: sus [condiciones](https://www.sports-reference.com/data_use.html) prohíben expresamente crear webs o herramientas con datos extraídos. ESPN: su `robots.txt` bloquea a los agentes de IA y sus condiciones prohíben la extracción automatizada. balldontlie: las estadísticas requieren plan de pago (no se usa sin tu permiso). API-Sports (API-Basketball): requiere registro y clave; plan gratuito de 100 peticiones/día, posible alternativa si se quiere. |
| **Lesiones** | El parte oficial de lesiones (PDF en `ak-static.cms.nba.com`, enlazado desde [official.nba.com](https://official.nba.com/nba-injury-report-2026-27-season/)) también está bloqueado desde esta red. Se infieren **ausencias recientes** (jugadores que no han jugado los últimos partidos de su equipo) y se pueden añadir bajas manuales con fuente en `data/manual/bajas.json`. |

## EuroLiga

| | |
|---|---|
| **Fuente usada** | API oficial de Euroleague Basketball: `https://api-live.euroleague.net` ([Swagger](https://api-live.euroleague.net/swagger/index.html)) y `https://live.euroleague.net/api` (jugada a jugada). Sin clave. |
| **Qué se descarga** | Clubes y plantillas (`/v2/competitions/E/seasons/E2026/clubs`, `…/clubs/{código}/people`: posición, altura, nacionalidad, dorsal), calendario y resultados con parciales por cuarto (`…/games`), box score de cada partido con titulares y segundos jugados (`…/games/{n}/stats`) y jugada a jugada (`PlayByPlay`) para reconstruir los minutos de cada jugador en cada cuarto (cambios IN/OUT). Agregados oficiales (`/v3/competitions/E/statistics/...`) solo para verificación. |
| **Condiciones** | La web de Euroleague Basketball muestra un control de seguridad (Vercel) a los accesos automatizados, por lo que **no se han podido leer sus condiciones de uso** y no se ha intentado saltar ese control. La API es pública y la usan paquetes de código abierto (`euroleague_api`, `euroleaguer`). Se usa solo para uso personal no comercial, citando a Euroleague Basketball. **Pendiente**: revisar las condiciones en un navegador antes de cualquier uso público. |
| **Acceso automatizado** | La API responde sin clave ni bloqueos; se limita a 1 petición cada 0,8 s con caché. |
| **Lesiones** | No hay parte oficial accesible. Se infieren **ausencias recientes**: jugadores de la plantilla que no han estado en el acta de los últimos partidos (posible baja, sin confirmación). Bajas manuales con fuente en `data/manual/bajas.json`. |

## Liga Endesa (ACB)

| | |
|---|---|
| **Fuente usada** | Páginas públicas de [acb.com](https://acb.com/es/liga) (equipos y plantillas: `/es/liga/equipos/{equipo}/plantilla`) y de [live.acb.com](https://live.acb.com) (estadísticas de cada partido, a las que redirige `acb.com/partido/estadisticas/id/{id}`). Los datos se leen del flujo de datos que la propia página incluye (Next.js), sin ejecutar JavaScript. |
| **Qué se descarga** | Plantillas (posición, altura, nacionalidad, dorsal, tipo de licencia JFL/EXT…), y por partido: parciales por cuarto, titulares, y box score completo del partido y de cada cuarto (minutos por cuarto de cada jugador, tiros, rebotes, asistencias, robos, tapones, pérdidas, faltas cometidas y recibidas). |
| **Condiciones** | `robots.txt` de acb.com y live.acb.com: `Allow: /` para todos los agentes (incluidos los de IA). El [aviso legal](https://acb.com/es/liga/aviso-legal) de ACEB, S.A.U. autoriza visualizar y hacer **reproducciones privadas** (descarga y almacenamiento) para **uso personal**, identificando la fuente; prohíbe la distribución, transformación o comunicación pública sin consentimiento previo. |
| **Acceso automatizado** | Permitido por `robots.txt`; 1 petición cada 2,5 s y caché indefinida de partidos terminados. **No se usa** la API privada `api2.acb.com`: requiere una clave incrustada en la web que no se nos ha concedido. |
| **Identificadores de partido** | Son correlativos y compartidos con otras competiciones (Copa, Supercopa, categorías inferiores); se filtra por `competitionId = 1` (Liga Endesa) y `editionId` (90 = 2025-26, 91 = 2026-27). Rangos localizados sondeando identificadores el 23/10/2026 (`config/temporadas.ts`): 2025-26 → 104441–104800 y 105321–105380 (playoffs); 2026-27 → desde 105361 hasta 60 identificadores seguidos sin partido terminado. |
| **Lesiones** | Igual que en la EuroLiga: ausencias recientes inferidas del acta + bajas manuales. |
| **Reglamento** | El cupo de jugadores de formación local condiciona las plantillas pero no se simula: se usan las convocatorias reales recientes. |

## Quintetos y rotaciones

Ninguna fuente accesible publica quintetos «probables» antes del partido. Se calcula el **quinteto
probable** como los 5 jugadores disponibles con más titularidades en los últimos 5 partidos del
equipo (ponderando más los recientes) y la **rotación** como la media ponderada de minutos de esos
partidos y de la temporada, escalada a 240 (NBA) o 200 (FIBA) minutos. Se muestran siempre como
«probables», con la base del cálculo, la fuente y la fecha del último partido. Si hay titulares
recientes de baja, se avisa. Todo es editable antes de simular.

## Reglamentos consultados

- NBA Official Rulebook, regla 12 (faltas y penalizaciones): <https://official.nba.com/rule-no-12-fouls-and-penalties/>
- Reglas Oficiales de Baloncesto FIBA 2024 (en vigor desde el 1/10/2024), art. 40 y 41. Copia consultada: edición de la federación coreana (<https://www.koreabasketball.or.kr/static/2025_FIBA_game_rule.pdf>); anuncio oficial: <https://refereeing.fiba.basketball/en/news/fiba-official-basketball-rules-2024-come-into-force-on-october-1>.

## Datos estimados

Cuando un jugador tiene menos de 100 minutos (temporada actual + anterior) en la competición,
sus tasas se marcan como **estimadas**: se regularizan hacia la media de su posición en esa
competición y, si ha jugado en la otra competición europea (EuroLiga ↔ ACB, emparejado por nombre),
se usan sus tasas allí ajustadas por la diferencia de nivel entre ligas (ver `docs/modelo.md`).
