"""Armadura de gladiador realista (diseño original, todo con código).
Se construye un mapa de alturas sobre el torso del jugador (coraza musculada, ribetes en relieve,
hombreras de placas superpuestas, remaches) y se sombrea como metal con la misma luz que la foto."""
import sys
import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, 'herramientas')
import mini  # noqa: E402

D = 'salida/2026-11-15_logrones-arenas/proyecto/img/'
im = np.array(Image.open(D + 'anai.png').convert('RGBA'))
h, w = im.shape[:2]
a = im[..., 3].astype(np.float32) / 255
yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
rng = np.random.default_rng(7)

# ---------- zona que cubre la armadura (todo el torso menos cuello y cara)
def escote(x):
    return np.clip(422 - 0.0075 * (np.asarray(x, np.float32) - 318) ** 2, 330, None)   # escote en U suave alrededor del cuello


cuello = escote(xx)
libres = np.array(Image.open(D + '_mascara_brazos.png')) > 0      # brazos y manos: sin armadura
cuerpo = ((yy > cuello) & (a > .5) & ~libres).astype(np.uint8)

# ---------- materiales: 0 nada, 1 oro (coraza), 2 plata (ribetes/remaches), 3 bronce (hombreras)
mat = np.zeros((h, w), np.uint8)
mat[cuerpo > 0] = 1
z = np.zeros((h, w), np.float32)

# relieve base del cuerpo (profundidad) + musculatura esculpida
d = mini.profundidad(im[..., :3]).astype(np.float32)
lo, hi = np.percentile(d[cuerpo > 0], [2, 98])
d = cv2.GaussianBlur(np.clip((d - lo) / (hi - lo), 0, 1), (0, 0), 8)


def bulto(cx, cy, rx, ry, k):
    return (k * np.exp(-(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2))).astype(np.float32)


musc = bulto(212, 572, 92, 58, 1.0) + bulto(398, 572, 92, 58, 1.0)
for cx in (258, 346):
    for cy in (662, 712):
        musc += bulto(cx, cy, 36, 22, .5)
musc -= bulto(302, 600, 10, 120, .35)                      # surco central
dist = cv2.distanceTransform(cuerpo, cv2.DIST_L2, 5)
z += (d * 1.2 + musc + np.clip(dist / 45, 0, 1) * .8) * cuerpo

# ---------- ribetes plateados en relieve
rib = np.zeros((h, w), np.uint8)
def curva(pts, grosor):
    cv2.polylines(rib, [np.array(pts, np.int32)], False, 255, grosor, cv2.LINE_AA)
t = np.linspace(0, 1, 60)
xs = np.linspace(205, 432, 60)
curva(np.c_[xs, escote(xs) + 9], 13)                                              # cuello
curva(np.c_[110 + t * 190, 640 + 52 * np.sin(np.pi * t)], 10)                       # bajo pectoral izq.
curva(np.c_[300 + t * 200, 640 + 52 * np.sin(np.pi * t)], 10)                       # bajo pectoral der.
curva([[302, 690], [302, 754]], 9)                                                   # línea central
curva(np.c_[230 + t * 70, 690 - 6 * np.sin(np.pi * t)], 7)
curva(np.c_[305 + t * 70, 690 - 6 * np.sin(np.pi * t)], 7)
rib = (rib > 100).astype(np.uint8) & cuerpo
ribz = cv2.GaussianBlur(rib.astype(np.float32), (0, 0), 2.2)
z += ribz * .9
mat[rib > 0] = 2
# adorno central (rombo)
rombo = np.zeros((h, w), np.uint8)
cv2.fillPoly(rombo, [np.array([[302, 592], [318, 622], [302, 652], [286, 622]], np.int32)], 1)
z += cv2.GaussianBlur(rombo.astype(np.float32), (0, 0), 3) * 1.1
mat[rombo > 0] = 2

# ---------- hombreras de placas superpuestas (bronce)
def hombrera(cx, cy, lado):
    global z
    for i, r in enumerate((150, 122, 94)):                 # placa exterior primero, la de arriba encima
        placa = np.zeros((h, w), np.uint8)
        a0, a1 = (178, 262) if lado < 0 else (278, 362)
        cv2.ellipse(placa, (cx, cy), (r, int(r * .9)), 0, a0, a1, 1, -1)
        cv2.ellipse(placa, (cx, cy), (r - 34, int((r - 34) * .9)), 0, 0, 360, 0, -1)
        placa &= (a > .3).astype(np.uint8)
        if placa.sum() == 0:
            continue
        dd = cv2.distanceTransform(placa, cv2.DIST_L2, 3)
        cupula = np.clip(dd / 9, 0, 1) ** .7
        zp = 2.4 + i * .45 + cupula * .7
        sel = placa > 0
        z[sel] = zp[sel]
        mat[sel] = 3
        # remaches en cada placa
        for ang in np.linspace(np.radians(a0 + 22), np.radians(a1 - 22), 2):
            rx, ry = int(cx + (r - 17) * np.cos(ang)), int(cy + (r - 17) * .9 * np.sin(ang))
            if 0 <= ry < h and 0 <= rx < w and a[ry, rx] > .5:
                rem = bulto(rx, ry, 3.5, 3.5, .7)
                z[:] = np.maximum(z, zp * sel + rem * (rem > .05) + (rem > .05) * zp[ry, rx])
                mat[rem > .2] = 2


hombrera(196, 610, -1)
hombrera(424, 610, 1)

# remaches a lo largo del ribete del cuello
for xr in np.linspace(235, 400, 5):
    rx, ry = int(xr), int(escote(xr)) + 24
    if cuerpo[ry, rx] and mat[ry, rx] == 1:
        rem = bulto(rx, ry, 4, 4, .8)
        z += rem
        mat[rem > .25] = 2

mat[libres & (mat != 3)] = 0                                      # las hombreras sí pueden ir sobre el brazo
cubre = (mat > 0)
alfa = cv2.GaussianBlur(cubre.astype(np.float32), (0, 0), .9) * a

# ---------- normales
zf = cv2.GaussianBlur(z, (0, 0), 1.2)
gx = cv2.Sobel(zf, cv2.CV_32F, 1, 0, ksize=3)
gy = cv2.Sobel(zf, cv2.CV_32F, 0, 1, ksize=3)
k = 1.6 / (np.median(np.hypot(gx, gy)[cubre]) + 1e-6)
N = np.dstack([-gx * k, -gy * k, np.ones_like(gx)])
N /= np.linalg.norm(N, axis=2, keepdims=True)

L = np.array([.5, -.55, .67], np.float32); L /= np.linalg.norm(L)
V = np.array([0, 0, 1], np.float32)
H = (L + V) / np.linalg.norm(L + V)
ndl = np.clip(N @ L, 0, 1)
ndh = np.clip(N @ H, 0, 1)
fres = (1 - np.clip(N[..., 2], 0, 1)) ** 2

# oclusión ambiental (cavidades) a partir del mapa de alturas
ao = np.clip(1 - np.clip(cv2.GaussianBlur(z, (0, 0), 10) - z, 0, None) * 1.4, .35, 1)
# reflejo del entorno: arriba claro y cálido, abajo rojo oscuro (el póster)
ry = N[..., 1]
env = np.dstack([np.interp(ry, [-1, 0, 1], c) for c in ([1.0, .55, .28], [.95, .45, .2], [.85, .35, .2])])
env_k = np.clip(-ry * .5 + .5, 0, 1)[..., None]

base = {1: (np.array([.92, .66, .24]), np.array([.30, .17, .04]), 70, 1.0),     # oro
        2: (np.array([.95, .96, .98]), np.array([.32, .33, .36]), 90, 1.1),      # plata
        3: (np.array([.72, .44, .22]), np.array([.18, .09, .04]), 35, .7)}      # bronce gastado
col = np.zeros((h, w, 3), np.float32)
for mid, (claro, oscuro, brillo, ks) in base.items():
    sel = mat == mid
    if not sel.any():
        continue
    dif = ndl[sel][:, None] ** 1.1
    c = oscuro + (claro - oscuro) * dif
    c = c * ((.65 + .35 * env[sel] * env_k[sel]) if mid != 2 else (.85 + .15 * env[sel]))   # tinte del entorno
    c += (ndh[sel] ** brillo)[:, None] * np.array([1, .97, .9]) * ks     # brillo nítido
    c += (ndh[sel] ** 8)[:, None] * claro * .25 * ks                     # brillo amplio
    c += fres[sel][:, None] * np.array([.9, .25, .2]) * (.15 if mid == 2 else .4)   # contraluz rojo del fondo
    col[sel] = c

col *= ao[..., None]
# desgaste: ruido fino + arañazos + suciedad en cavidades
ruido = cv2.GaussianBlur(rng.random((h, w)).astype(np.float32), (0, 0), .8)
col *= (.93 + .14 * ruido)[..., None]
ara = np.zeros((h, w), np.uint8)
for _ in range(35):
    x0, y0 = rng.integers(40, w - 40), rng.integers(440, h)
    ang, ln = rng.uniform(0, np.pi), rng.uniform(8, 40)
    cv2.line(ara, (int(x0), int(y0)), (int(x0 + ln * np.cos(ang)), int(y0 + ln * np.sin(ang))), 255, 1, cv2.LINE_AA)
ara = cv2.GaussianBlur(ara.astype(np.float32) / 255, (0, 0), .5) * (mat == 1)
col = col * (1 - ara[..., None] * .12) + ara[..., None] * np.array([1, .9, .6]) * .08
sucio = cv2.GaussianBlur(rng.random((h, w)).astype(np.float32), (0, 0), 6)
col *= (1 - (1 - ao) * .5 * sucio)[..., None]

# sombra de la barbilla/cuello sobre la coraza y sombra en los bordes
bajo_cuello = np.clip(1 - (yy - cuello) / 60, 0, 1) * np.exp(-((xx - 318) / 120) ** 2)
col *= (1 - .55 * bajo_cuello * cuerpo)[..., None]
borde = np.exp(-dist / 14) * (mat == 1)
col *= (1 - .3 * borde)[..., None]
# se funde algo en sombra abajo, como el jugador
col *= (1 - np.clip((yy - 680) / 74, 0, 1) * .4)[..., None]

out = (np.clip(col, 0, 1) * 255).astype(np.uint8)
Image.fromarray(np.dstack([out, (alfa * 255).astype(np.uint8)])).save(D + 'coraza.png')
print('ok')
