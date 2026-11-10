"""Coraza dorada que sigue la silueta y el relieve del torso del jugador (diseño original, todo con código)."""
import sys, cv2, numpy as np
from PIL import Image
sys.path.insert(0, 'herramientas'); import mini
D = 'salida/2026-11-15_logrones-arenas/proyecto/img/'
im = np.array(Image.open(D + 'anai.png').convert('RGBA')); h, w = im.shape[:2]
a = im[..., 3].astype(np.float32) / 255
yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
# escote en U alrededor del cuello
cuello = np.minimum(430 + 0.0018 * (xx - 318) ** 2, 455)
cuello = np.where((xx < 225) | (xx > 405), 392, cuello)
m = ((yy > cuello) & (a > .5)).astype(np.float32)
m = cv2.GaussianBlur(m, (0, 0), 1.2)
# relieve: profundidad del torso + músculos esculpidos (pectorales, abdominales)
d = mini.profundidad(im[..., :3]); lo, hi = np.percentile(d[m > .5], [2, 98]); d = np.clip((d - lo) / (hi - lo), 0, 1)
d = cv2.GaussianBlur(d, (0, 0), 6)
def bulto(cx, cy, rx, ry, k): return k * np.exp(-(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2))
musc = (bulto(210, 575, 95, 60, 1.0) + bulto(395, 575, 95, 60, 1.0)
        + sum(bulto(cx, cy, 38, 24, .55) for cx in (258, 345) for cy in (665, 715)))
dist = cv2.distanceTransform((m > .5).astype(np.uint8), cv2.DIST_L2, 5)
z = (d * 0.6 + musc + np.clip(dist / 40, 0, 1) * .35).astype(np.float32)
gx = cv2.Sobel(z, cv2.CV_32F, 1, 0, ksize=5); gy = cv2.Sobel(z, cv2.CV_32F, 0, 1, ksize=5)
esc = 0.7 / (np.median(np.hypot(gx, gy)[m > .5]) + 1e-6); gx *= esc; gy *= esc
N = np.dstack([-gx, -gy, np.ones_like(gx)]); N /= np.linalg.norm(N, axis=2, keepdims=True)
L = np.array([.5, -.55, .67]); L /= np.linalg.norm(L)           # mismo foco que el jugador (derecha-arriba)
dif = np.clip(N @ L, 0, 1)
H = L + [0, 0, 1]; H /= np.linalg.norm(H); spec = np.clip(N @ H, 0, 1) ** 30
env = np.clip(N[..., 1] * -.5 + .5, 0, 1)                        # reflejo del entorno: cielo claro arriba, suelo oscuro
oro_osc, oro, oro_cla = np.array([.36, .2, .04]), np.array([.86, .6, .2]), np.array([1, .93, .62])
col = oro_osc + (oro - oro_osc) * dif[..., None] ** .9
col = col + (oro_cla - col) * (env[..., None] * .35)
col = col + spec[..., None] * np.array([1, .95, .8]) * .9
rim = np.clip(-N[..., 0], 0, 1) ** 2 * .5                         # contraluz rojo por la izquierda
col = 1 - (1 - col) * (1 - rim[..., None] * np.array([1, .2, .15]))
ruido = cv2.GaussianBlur(np.random.default_rng(3).random((h, w)).astype(np.float32), (0, 0), 1.2)
col *= (0.96 + 0.08 * ruido)[..., None]                             # metal algo gastado
col *= (1 - np.clip((yy - 690) / 64, 0, 1) * .45)[..., None]      # se funde un poco en sombra abajo
out = (np.clip(col, 0, 1) * 255).astype(np.uint8)
Image.fromarray(np.dstack([out, (m * im[..., 3] / 255 * 255).astype(np.uint8)])).save(D + 'coraza.png')
print('ok')
