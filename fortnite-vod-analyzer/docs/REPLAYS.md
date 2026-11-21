# Replays de Fortnite (`.replay`): investigación y diseño

## Qué es un `.replay`

Es una *network demo* de Unreal Engine (`LocalFileNetworkReplayStreaming`), no un vídeo:

| Bloque | Contenido | Protección |
|---|---|---|
| Info | firma `0x1CA2E27F`, versión del contenedor, duración, changelist, fecha, flags | sin cifrar |
| `Header` (chunk 0) | versión de red/motor, rama (`++Fortnite+Release-32.00`), plataforma | sin cifrar |
| `Event` (chunk 3) | `playerElim`, `AthenaMatchStats`, `AthenaMatchTeamStats`… | **AES-256-ECB** con la clave guardada en el propio archivo |
| `ReplayData` (chunk 1) | paquetes de red replicados (posiciones, inventario, builds, zonas…) | AES + **compresión Oodle** |
| `Checkpoint` (chunk 2) | estados completos para avanzar rápido | igual que ReplayData |

Consecuencias:
- FFmpeg y los modelos de visión **no pueden** leerlo.
- Los **eventos** (eliminaciones/knocks con tiempo exacto, estadísticas finales, puesto) se pueden leer con AES estándar, sin Oodle.
- Las **posiciones, zonas, nombres** exigen descomprimir Oodle **y** reconstruir el estado de red con definiciones de propiedades que Epic cambia entre temporadas.

## Parsers evaluados (noviembre 2026)

| Proyecto | Lenguaje | Licencia | Estado | Qué extrae | Notas |
|---|---|---|---|---|---|
| [Shiqan/FortniteReplayDecompressor](https://github.com/Shiqan/FortniteReplayDecompressor) (NuGet `FortniteReplayReader` 3.2.0) | C# (.NET 10/11) | MIT; **OozSharp** (Oodle) es GPL‑3.0 (derivado de powzix/ooz) | Activo (último commit 15‑11‑2026) | eventos, jugadores, nombres, propietario, equipos, kill feed, **posiciones**, zonas, builds, armas | Se ejecuta como proceso separado (`replay-tools/FrdExport`) para no enlazar código GPL en el backend |
| [xNocken/replay-reader](https://github.com/xNocken/replay-reader) (npm `fortnite-replay-parser`) | Node.js | MIT (usa `ooz-wasm`) | Último commit 06‑2025 | similar | Menos actualizado; alternativa si se prefiere Node |

### Pruebas realizadas con replays reales (incluidas en el repo de FRD)

| Replay | Versión | Lector nativo (eventos) | FRD (`ParseMode.Full`) |
|---|---|---|---|
| season11 / 11.11 / 11.31 / collectPickup | 11.00–11.40 | ✅ 95–152 eventos, stats, puesto | ✅ nombres, propietario. ⚠️ sin tiempo de mundo en movimientos → posiciones descartadas |
| season12 | 12.00 | ✅ 106 eventos (coincide con FRD) | igual que arriba |
| chapter2season6_10 | 16.10 | ✅ 164 eventos (coincide) | igual que arriba |
| chapter5season5 | 32.00 | ✅ 137 eventos (coincide) | ✅ **posiciones (≈7 000 muestras) y 9 zonas**, sincronizadas (offset −42.8 s) |

No hay replays públicas de la temporada actual en esos repositorios: **no se asume** que la versión vigente funcione. Por eso:

## Arquitectura de adaptadores (`backend/app/replay/`)

```
ReplayAdapter (base.py)            is_available() · probe() · parse() -> ReplayParseResult
├── NativeEventsAdapter (native.py)  Python puro. Valida firma, versión, descifra eventos.
│                                    Siempre disponible. Rechaza versiones de contenedor/red desconocidas.
└── FrdCliAdapter (frd_cli.py)       Ejecuta FrdExport (timeout, solo lectura) y ENRIQUECE el resultado
                                     nativo: nombres, propietario, equipos, posiciones, zonas.
registry.parse_replay()             nativo -> (si disponible) FRD; si FRD falla, se conserva lo nativo + aviso.
```

Reglas de fiabilidad:
- Todo lo que no se pudo leer va en `unavailable` y la UI lo muestra; nunca se rellena.
- El tiempo del mundo (posiciones, zonas) se sincroniza con el tiempo de la replay **cruzando el kill feed con los eventos de eliminación** (mediana de ≥3 coincidencias consistentes). Si no se puede sincronizar, las posiciones se descartan en lugar de mostrarse desalineadas.
- Las estadísticas finales (`AthenaMatchStats`) solo se atribuyen al jugador que grabó la replay.
- Si el contenedor no se reconoce o no hay eventos del jugador: la partida queda **Incompatible**, sin estadísticas, y la UI ofrece la conversión a vídeo.

## Cambios de versión

- Nueva versión de contenedor/red → `UnsupportedReplayVersionError` explicativo (no se intenta adivinar).
- Nuevo formato de `playerElim` → los eventos que fallan se cuentan y se avisa ("N eliminaciones no se pudieron interpretar").
- FRD se actualiza con `dotnet add package FortniteReplayReader --version X` y recompilando `FrdExport`; el backend no cambia.

## Alternativa funcional: Replay Mode → vídeo

No existe un conversor `.replay → .mp4` fuera del juego (renderizar requiere el motor y los assets de Fortnite). La app **no simula** uno: guía al coach para grabar la replay desde *Carrera → Repeticiones* y subir el vídeo a la misma partida, que pasa a analizarse como vídeo conservando el archivo `.replay`.
