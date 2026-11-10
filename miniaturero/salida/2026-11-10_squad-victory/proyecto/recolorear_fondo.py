"""Cambia el verde del fondo por el morado de la clasificación (entrada/clasificacion_squads.webp).
Solo toca píxeles verdes que NO son del personaje. Conserva luces, sombras y texturas (cuadros pixelados)."""
import cv2
import numpy as np
from PIL import Image

D = 'salida/2026-11-10_squad-victory/proyecto/img/'
base = np.array(Image.open(D + 'base_sin_textos.png').convert('RGB'))
h, w = base.shape[:2]

# máscara del personaje (recorte con BiRefNet, colocado en su caja de la imagen)
pers = np.zeros((h, w), np.float32)
p = np.array(Image.open(D + '_personaje.png'))[..., 3].astype(np.float32) / 255
pers[0:p.shape[0], 359:359 + p.shape[1]] = p
pers = cv2.erode((pers > 0.5).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(np.float32)   # sin margen: el filo verde también cambia
pers = cv2.GaussianBlur(pers, (0, 0), 0.8)

# qué es "verde del fondo"
hsv = cv2.cvtColor(base, cv2.COLOR_RGB2HSV).astype(np.float32)
H, S = hsv[..., 0] * 2, hsv[..., 1] / 255           # H en grados
verde = np.clip((S - 0.18) / 0.15, 0, 1) * np.clip((H - 72) / 14, 0, 1) * np.clip((205 - H) / 14, 0, 1)   # verdes y turquesas (no amarillos)
verde = cv2.GaussianBlur(verde, (0, 0), 0.8) * (1 - pers)

# degradado objetivo con los morados de la captura
xs = np.linspace(0, 1, w)[None, :, None]
ys = np.linspace(0, 1, h)[:, None, None]
izq, centro, der = np.array([111, 33, 112]), np.array([128, 44, 122]), np.array([168, 92, 158])
grad = np.where(xs < 0.5, izq + (centro - izq) * (xs / 0.5), centro + (der - centro) * ((xs - 0.5) / 0.5))
grad = grad * (1 - 0.35 * ys ** 2) + np.array([40, 30, 90]) * 0.35 * ys ** 2 * (1 - xs)   # abajo-izq más oscuro/azulado
grad = np.clip(grad, 0, 255).astype(np.uint8)

lab_b = cv2.cvtColor(base, cv2.COLOR_RGB2LAB).astype(np.float32)
lab_g = cv2.cvtColor(np.broadcast_to(grad, (h, w, 3)).copy(), cv2.COLOR_RGB2LAB).astype(np.float32)
sel = verde > 0.5
mL = lab_b[..., 0][sel].mean()
out = lab_g.copy()
out[..., 0] = np.clip(lab_g[..., 0] + (lab_b[..., 0] - mL) * 0.9, 0, 255)     # conserva luces y sombras del original
# conserva la intensidad del color original (zonas muy saturadas = morado más intenso)
croma_b = np.sqrt((lab_b[..., 1] - 128) ** 2 + (lab_b[..., 2] - 128) ** 2)
k = np.clip(croma_b / (np.median(croma_b[sel]) + 1e-6), 0.4, 1.4)
out[..., 1] = 128 + (lab_g[..., 1] - 128) * k
out[..., 2] = 128 + (lab_g[..., 2] - 128) * k
rec = cv2.cvtColor(out.clip(0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB).astype(np.float32)
res = rec * verde[..., None] + base * (1 - verde[..., None])
Image.fromarray(res.clip(0, 255).astype(np.uint8)).save(D + 'base_fondo_morado.png')
print('verde cambiado: %.0f%% de la imagen' % (100 * (verde > 0.5).mean()))
