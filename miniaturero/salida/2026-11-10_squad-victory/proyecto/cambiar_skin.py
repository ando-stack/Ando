"""Quita la skin verde de la miniatura y prepara las capas para poner la nueva (imagen aportada por el usuario)."""
import sys
import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, 'herramientas')
import mini  # noqa: E402

D = 'salida/2026-11-10_squad-victory/proyecto/img/'
base = np.array(Image.open(D + 'base_fondo_morado.png').convert('RGB'))
h, w = base.shape[:2]

# 1) máscara de la skin verde (recorte BiRefNet de antes, en su caja 359,0)
m = np.zeros((h, w), np.uint8)
p = np.array(Image.open(D + '_personaje.png'))[..., 3]
m[0:p.shape[0], 359:359 + p.shape[1]] = (p > 40) * 255
m = cv2.dilate(m, np.ones((9, 9), np.uint8))
Image.fromarray(m).save(D + '_mascara_skin_verde.png')

# 2) relleno inteligente (LaMa) del hueco
sin = mini.rellenar(base, m)
Image.fromarray(sin).save(D + 'base_sin_personaje.png')

# 3) capa de la tarjeta del #1 (para que vaya por delante de la skin, como en el original)
y0, y1, x0, x1 = 106, 183, 8, 466
trozo = base[y0:y1, x0:x1]
hsv = cv2.cvtColor(trozo, cv2.COLOR_RGB2HSV)
tarjeta = ((trozo.min(2) > 200) | ((hsv[..., 0] > 15) & (hsv[..., 0] < 35) & (hsv[..., 1] > 120))).astype(np.uint8) * 255
tarjeta = cv2.morphologyEx(tarjeta, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
n, et, st, _ = cv2.connectedComponentsWithStats(tarjeta)
mayor = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
tarjeta = ((et == mayor) * 255).astype(np.uint8)
tarjeta = cv2.GaussianBlur(tarjeta, (0, 0), 0.6)
Image.fromarray(np.dstack([trozo, tarjeta])).save(D + 'capa_tarjeta.png')
print('ok: hueco', int((m > 0).mean() * 100), '% · tarjeta', tarjeta.shape)
