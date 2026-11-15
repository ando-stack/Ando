# Approved asset library

Put **only** images and videos you are allowed to use here (your own captures, licensed
stock, official press material used within its terms). The factory never downloads or
scrapes third-party footage, and never removes watermarks.

Optional sidecar file `<name>.json` next to each asset:

```json
{
  "tags": ["lucia", "prison", "trailer"],
  "license": "Own gameplay capture",
  "credit": "Captured by me",
  "approved": true,
  "aiGenerated": false
}
```

Without a sidecar, tags are taken from the file and folder names
(e.g. `characters/lucia-caminos-01.jpg` → `characters`, `lucia`, `caminos`).
`"approved": false` hides an asset. `"aiGenerated": true` makes the video show an
"AI-generated concept" label whenever the asset is on screen.
