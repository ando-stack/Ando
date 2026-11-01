# Imágenes de prueba

Creadas para este proyecto con `scripts/crear_imagenes_prueba.py`: composiciones propias (textos,
formas y efectos) sobre fotografías de **dominio público** o **CC0**. Junto a cada imagen hay un
JSON con la «verdad» (textos, fuentes, colores, contornos, sujetos y gráficos esperados) que usa
`scripts/evaluar_descomposicion.py` para medir la calidad.

| Imagen | Qué prueba | Foto de base (licencia) |
|---|---|---|
| `01_miniatura_reaccion.jpg` | miniatura de YouTube: cara recortada con contorno blanco, texto grande con contorno, círculo gráfico con texto | NASA KSC-2012-1695 y S84-40242 (dominio público, NASA) |
| `02_poster_deportivo.png` | póster 4:5: jugador recortado, banda diagonal, franja, texto con sombra, tildes | NASA s90-38573 (dominio público) |
| `03_fondo_complejo.jpg` | fondo fotográfico complejo (estructuras, cielo) con titular y rótulo | SpaceX, liberada al dominio público (vía scikit-image) |
| `04_textos_rotados.webp` | tres textos girados (−15°, 10°, −6°), fuentes y contornos distintos, flecha, fondo con ruido | — (100 % generada) |
| `05_dos_caras_vs.jpg` | dos personas recortadas, «VS» con doble contorno, fondo partido en diagonal | NASA (Eileen Collins, vía scikit-image) y S84-40242 |
| `06_producto.jpg` | producto (taza) con texto en degradado y contorno blanco, «¿…?» | Rachel Michetti, CC0 (vía scikit-image) |
| `07_mascota.png` | animal (no persona), franja lateral, texto en dos líneas con «¿» | Stefan van der Walt, CC0 (vía scikit-image) |

Las fotos de la NASA son de dominio público en EE. UU. (no implican respaldo de la NASA; las
insignias de la NASA que aparecen en los trajes no deben usarse en diseños propios). Las
fotos originales se descargan en `_fuentes_originales/` (no se suben al repositorio).

Los resultados de la última evaluación están en [`resultados/informe.md`](resultados/informe.md)
con una lámina por imagen (original, reconstrucción y cada capa).
