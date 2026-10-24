# Fuentes de datos

Investigación hecha el 23-10-2026. Todas las fuentes usadas son **gratuitas**; no se ha contratado ningún servicio de pago. Cada descarga se guarda en caché (`ingest/.cache`), se respetan límites de peticiones por dominio (`ingest/lib/http.ts`) y **nunca se intenta eludir un bloqueo**: ante un 401/403 la fuente se marca como fallida y se siguen usando sus últimos datos válidos, cuya fecha se muestra en la web («Acerca» y avisos en «Torneos»).

## Fuentes usadas

| Uso | Fuente | Acceso | Licencia / condiciones | Límite que aplicamos |
|---|---|---|---|---|
| Histórico de partidos con estadísticas (2020 → junio 2026), jugadores (mano, fecha de nacimiento, país, altura) y rankings semanales | **Jeff Sackmann, `tennis_atp` y `tennis_wta`**. Los repositorios de GitHub dejaron de estar disponibles a mediados de 2026; se usa el **espejo de archivo** `Jackk7924/tennis-sackmann` en Hugging Face (ficheros sin modificar, con el README original) | CSV por HTTPS | **CC BY-NC-SA 4.0**: atribución a Jeff Sackmann, **sólo uso NO comercial**, obras derivadas con la misma licencia. Este proyecto, y cualquier despliegue suyo, debe ser no comercial mientras use estos datos | Descarga diaria como máximo (caché de 1 día para la temporada actual y de 30 días para las anteriores) |
| WTA y WTA 125: calendario (categoría, superficie, cubierta/exterior, fechas), cuadros, orden de juego (pista, hora, «not before»), resultados y estadísticas por partido; ranking WTA actual | **API de wtatennis.com** (`api.wtatennis.com/tennis/...`), la que usa la web oficial de la WTA | JSON público, sin clave | No hay términos publicados para uso por terceros (no es una API documentada). Se usa sólo para un proyecto personal no comercial, citando la fuente. Si la WTA lo prohíbe o lo bloquea, se deja de usar | ≥ 400 ms entre peticiones; partidos terminados en caché permanente; torneos en curso, 3 h |
| ATP Tour: cuadros, orden de juego (pista y hora), resultados; ranking ATP actual (top 150) | **ESPN** (`site.api.espn.com/apis/site/v2/sports/tennis/atp/...`) | JSON público, sin clave | API no documentada de espn.com; los términos de ESPN prohíben el uso comercial de su contenido. Uso personal no comercial con atribución | ≥ 400 ms entre peticiones; caché de 2 h para fechas actuales y permanente para fechas pasadas |
| ATP Challenger: calendario (categoría, superficie, «(i)» = cubierta) y cuadros con resultados. ATP Tour: superficie, cubierta/exterior y categoría | **Wikipedia en inglés** (API de MediaWiki, `action=parse`) | JSON | **CC BY-SA 4.0** (atribución y compartir igual). La política de la API pide agente de usuario identificativo, peticiones en serie y `maxlag` | 1 petición cada 1,5 s, `maxlag=5`, reintentos con espera exponencial y `Retry-After`; cuadros terminados en caché permanente |
| Reglamentos de formato | ATP Rulebook 2025 (cap. 1, regla 1.03 B), WTA Rulebook 2026 (§39 y apéndice E §40), Grand Slam Rule Book 2026, reglas Next Gen ATP Finals 2025 | PDF | Consulta | — |

## Fuentes evaluadas y descartadas

| Fuente | Motivo |
|---|---|
| **atptour.com** (calendario, cuadros, órdenes de juego de ATP y Challenger, PDF del reglamento 2026) | Devuelve **403** (protección anti-bots de Cloudflare) a cualquier acceso automatizado. No se intenta eludir. Consecuencia: **los Challenger no tienen orden de juego** en esta aplicación y el reglamento ATP se ha verificado con la edición 2025 |
| **Sofascore**, **Flashscore** | Bloquean el acceso automatizado (403) y sus condiciones prohíben la extracción de datos |
| `minmaxxxer/atp-wta-matches-with-odds` (Hugging Face, CC BY 4.0 declarada) | Continúa el formato de Sackmann hasta octubre de 2026, pero se obtiene extrayendo datos de Flashscore, cuyas condiciones lo prohíben: no se puede garantizar que la licencia declarada sea válida. Además sólo cubre ATP/WTA principal |
| tennis-data.co.uk | 403 desde el entorno de ingesta |
| API-Tennis, Sportradar, RapidAPI (planes de pago o freemium) | De pago o con planes gratuitos muy limitados; no se usan sin autorización explícita |
| Tennis Abstract (tennisabstract.com) | Mismo autor que el histórico; sus páginas no están pensadas para acceso automatizado y no aportan más que el histórico abierto |

## Cobertura y huecos conocidos

- **Histórico con estadísticas:** Sackmann llega hasta el 25-05-2026 (ATP y WTA principal), 01-06-2026 (Challenger) y 02-06-2026 (WTA 125). Desde entonces:
  - WTA y WTA 125: resultados **con** estadísticas de la API de la WTA.
  - ATP Tour: resultados **sin** estadísticas de saque (ESPN no las publica). Sirven para el Elo y la forma.
  - Challenger: resultados **sin** estadísticas (cuadros de Wikipedia). Las fechas exactas de cada partido no aparecen en los cuadros: se aproximan por ronda (lunes de la semana + 1 día en primera ronda, +3 en octavos… +6 en la final).
- **Challenger y WTA 125:** muchos partidos (sobre todo previa y torneos pequeños) no tienen estadísticas. Esos jugadores usan la estimación documentada en `docs/modelo.md` y se marcan como «Estimado» con su número de partidos con datos reales.
- **Revés (una o dos manos):** ninguna de las fuentes abiertas lo ofrece; se muestra «no disponible».
- **Ranking ATP actual:** ESPN publica el top 150. Para el resto se muestra el último ranking del histórico (con su fecha, junio de 2026).
- **Cubierta/exterior en el histórico:** Sackmann no lo indica. El modelo no lo usa (sólo la superficie); se muestra como dato del torneo.
- **Torneos cancelados:** se leen las secciones «Cancelled tournaments» de los calendarios de Wikipedia. Un Challenger cancelado no se muestra. Si la WTA sigue listando un torneo que Wikipedia da por cancelado y no hay cuadro (p. ej. Río y Miami WTA 125, octubre-noviembre de 2026), se muestra con un aviso de que las fuentes no coinciden.
- **WTA 125 sin marcador en directo de la WTA:** su cuadro se toma, si existe, de la página de Wikipedia del torneo (sin horarios).
- **Wikipedia** puede ir con horas de retraso respecto a los resultados oficiales y la IP del servidor de ingesta puede recibir límites (429): se reintenta con espera y se usa la caché.

## Actualización

- `npm run ingesta` — todo (histórico + fuentes en vivo + perfiles + Elo). Primera ejecución: 30-40 minutos (descarga las estadísticas partido a partido de la WTA); las siguientes, pocos minutos gracias a la caché.
- `npm run ingesta:vivo` — sólo calendario, cuadros, órdenes de juego y rankings (reusa la caché del histórico).
- El flujo de GitHub Actions `.github/workflows/ingesta-tenis.yml` lo ejecuta varias veces al día (06:15, 10:15, 14:15, 18:15 y 22:15 UTC), sincroniza Supabase y despliega en Netlify. Las horas se muestran en Europe/Madrid.

## Verificación manual de datos

Ver `docs/verificacion.md` (10 datos publicados comparados con la fuente original o con una fuente independiente; se regenera con `npm run verificar`).
