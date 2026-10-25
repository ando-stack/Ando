# Videoclip estilo trap/drip (Remotion)

Videoclip de ~29 s (1920x1080, 30 fps) hecho con fotos animadas en 2.5D: coche deportivo, lluvia de billetes, fajos de dinero, destellos de diamante y cortes al ritmo.

Está montado a 100 BPM (`src/theme.ts`). Si la canción va a otro tempo, cambia `BPM` y todo se recoloca solo.

```bash
npm install
npm run studio   # editar y previsualizar
npm run render   # genera out/videoclip.mp4
```

Para añadir la canción: copia el archivo a `public/cancion.mp3` y añade en `src/Videoclip.tsx`, dentro de `Videoclip`:
`<Audio src={staticFile('cancion.mp3')} startFrom={0} />` (importando `Audio` de `remotion`).

- Escenas y textos: `src/Videoclip.tsx`
- Coche, billetes, fajos y destellos: `src/props.tsx`
- Fotos recortadas: `public/cutN.png`
