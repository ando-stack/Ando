"""Brazos visibles: las manos reales quedan fuera de la armadura y, bajo las hombreras,
los brazos se muestran desnudos (piel del tono de la cara, volumen de cilindro y la misma luz)."""
import cv2
import numpy as np
from PIL import Image

D = 'salida/2026-11-15_logrones-arenas/proyecto/img/'
foto = np.array(Image.open(D + 'anai.png').convert('RGBA'))
ilu = np.array(Image.open(D + 'anai_iluminado.png').convert('RGBA'))
h, w = foto.shape[:2]
a = (foto[..., 3] > 128).astype(np.uint8)

# 1) manos (piel real de la foto, abajo)
hsv = cv2.cvtColor(foto[..., :3], cv2.COLOR_RGB2HSV)
r, g, b = [foto[..., i].astype(int) for i in range(3)]
manos = ((hsv[..., 0] < 20) & (hsv[..., 1] > 45) & (hsv[..., 1] < 150) & (hsv[..., 2] > 110)
         & (r > g) & (g > b) & (r - g > 25) & (r - g < 85) & (g > 80)).astype(np.uint8)
manos = cv2.morphologyEx(manos, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
n, lab, st, _ = cv2.connectedComponentsWithStats(manos)
manos = np.isin(lab, [i for i in range(1, n) if st[i, 4] > 300]).astype(np.uint8)
manos[:640] = 0
manos[600:712, 225:272] = 0                                        # parte baja del escudo de la camiseta
manos = cv2.morphologyEx(manos, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
manos = cv2.dilate(manos, np.ones((5, 5), np.uint8)) & a

# 2) brazos (mangas de la camiseta, a los lados del torso)
brazos = np.zeros((h, w), np.uint8)
cv2.fillPoly(brazos, [np.array([[0, 540], [55, 505], [128, 540], [124, 640], [112, 754], [0, 754]], np.int32)], 1)
cv2.fillPoly(brazos, [np.array([[468, 525], [540, 492], [570, 520], [570, 754], [492, 754], [478, 660]], np.int32)], 1)
brazos = brazos & a & (1 - manos)

Image.fromarray(((brazos | manos) * 255).astype(np.uint8)).save(D + '_mascara_brazos.png')

# 3) piel con volumen: altura = forma redondeada dentro de cada brazo
dist = cv2.distanceTransform(brazos, cv2.DIST_L2, 5)
z = np.sqrt(np.clip(dist, 0, None)).astype(np.float32)
z = cv2.GaussianBlur(z, (0, 0), 3)
gx = cv2.Sobel(z, cv2.CV_32F, 1, 0, ksize=5)
gy = cv2.Sobel(z, cv2.CV_32F, 0, 1, ksize=5)
k = 1.2 / (np.median(np.hypot(gx, gy)[brazos > 0]) + 1e-6)
N = np.dstack([-gx * k, -gy * k, np.ones_like(gx)])
N /= np.linalg.norm(N, axis=2, keepdims=True)
L = np.array([.5, -.55, .67], np.float32); L /= np.linalg.norm(L)
dif = np.clip(N @ L, 0, 1)
Hv = (L + [0, 0, 1]); Hv /= np.linalg.norm(Hv)
spec = np.clip(N @ Hv, 0, 1) ** 25 * .12
fres = (1 - np.clip(N[..., 2], 0, 1)) ** 2

piel_cla = np.array([.86, .62, .52]); piel_osc = np.array([.32, .17, .13])   # a partir del tono de la mejilla
col = piel_osc + (piel_cla - piel_osc) * (dif[..., None] ** .9)
col += spec[..., None]
col += fres[..., None] * np.array([.9, .2, .15]) * .35                       # contraluz rojo, como el resto
# un poco de la textura de la foto (pliegues), sin las rayas de color
lum = cv2.cvtColor(ilu[..., :3], cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
detalle = lum - cv2.GaussianBlur(lum, (0, 0), 4)
col *= (1 + np.clip(detalle, -.08, .08))[..., None]
rng = np.random.default_rng(2)
col *= (.97 + .06 * cv2.GaussianBlur(rng.random((h, w)).astype(np.float32), (0, 0), .7))[..., None]
yy = np.mgrid[0:h, 0:w][0].astype(np.float32)
col *= (1 - np.clip((yy - 680) / 74, 0, 1) * .4)[..., None]                 # misma caída a sombra abajo

alfa = cv2.GaussianBlur(brazos.astype(np.float32), (0, 0), 1.2) * (foto[..., 3] / 255)
out = (np.clip(col, 0, 1) * 255).astype(np.uint8)
Image.fromarray(np.dstack([out, (alfa * 255).astype(np.uint8)])).save(D + 'brazos.png')
print('ok', int(brazos.sum()), int(manos.sum()))
