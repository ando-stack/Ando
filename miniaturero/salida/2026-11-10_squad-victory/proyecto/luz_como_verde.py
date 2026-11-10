"""Iguala la iluminación de la skin nueva a la del render de la skin verde original:
mismas luces/sombras (igualación de histograma de luminancia), saturación más suave,
reflejo morado del fondo por la izquierda, brillo suave (bloom) y nitidez."""
import sys
import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, 'herramientas')
import mini  # noqa: E402

D = 'salida/2026-11-10_squad-victory/proyecto/img/'
# referencia: la skin verde dentro de la miniatura
base = np.array(Image.open(D + 'base_fondo_morado.png').convert('RGB'))
pm = np.array(Image.open(D + '_personaje.png'))[..., 3]
ref = base[0:pm.shape[0], 359:359 + pm.shape[1]]
ref_L = cv2.cvtColor(ref, cv2.COLOR_RGB2LAB)[..., 0][pm > 200].astype(np.float32)

im = np.array(Image.open(D + 'skin_nueva.png').convert('RGBA'))
a = im[..., 3].astype(np.float32) / 255
m = a > 0.8

# 1) un poco de modelado 3D suave (foco frontal-izquierdo amplio, sin contraluces fuertes)
r = mini.iluminar_3d(im, rim_der="#ffffff", rim_izq="#c86cff", fuerza_rim=0.45, clave=0.35, fundido=0.0,
                     key=(-0.35, -0.45, 0.82))
rgb = r[..., :3]

# 2) igualar luces y sombras a la skin verde (histograma de L)
lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
L = lab[..., 0]
qs = np.linspace(0, 100, 101)
src_q = np.percentile(L[m], qs)
dst_q = np.percentile(ref_L, qs)
L2 = np.interp(L, src_q, dst_q)
lab[..., 0] = L * 0.15 + L2 * 0.85

# 3) saturación más suave, como el render (sin apagar el naranja del todo)
lab[..., 1] = 128 + (lab[..., 1] - 128) * 0.8
lab[..., 2] = 128 + (lab[..., 2] - 128) * 0.8
rgb = cv2.cvtColor(lab.clip(0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB).astype(np.float32) / 255

# 4) reflejo morado del fondo en las sombras, más por la izquierda
h, w = a.shape
izq = np.clip(1 - np.linspace(0, 1, w), 0, 1)[None, :] ** 1.5
sombra = np.clip(1 - rgb.mean(2) * 1.6, 0, 1)
morado = np.array([0.62, 0.30, 0.70])
k = (0.10 + 0.18 * izq) * sombra
rgb = rgb * (1 - k[..., None]) + morado * k[..., None]

# 5) brillo suave (bloom) en las luces
luces = np.clip((rgb - 0.72) / 0.28, 0, 1)
bloom = cv2.GaussianBlur(luces, (0, 0), max(h, w) * 0.012)
rgb = 1 - (1 - rgb) * (1 - bloom * 0.22)

# 6) nitidez (como el render, más definido)
rgb = rgb + (rgb - cv2.GaussianBlur(rgb, (0, 0), 1.2)) * 0.6
out = (rgb.clip(0, 1) * 255).astype(np.uint8)
Image.fromarray(np.dstack([out, im[..., 3]])).save(D + 'skin_nueva_iluminada.png')

# comprobación
labo = cv2.cvtColor(out, cv2.COLOR_RGB2LAB).astype(np.float32)[..., 0][m] * 100 / 255
sat = cv2.cvtColor(out, cv2.COLOR_RGB2HSV)[..., 1][m].mean() / 255
print(f'nueva: L media {labo.mean():.1f} p5 {np.percentile(labo, 5):.1f} p95 {np.percentile(labo, 95):.1f} '
      f'satur {sat:.2f}   (verde: L media 61.2 p5 21.2 p95 90.6 satur 0.35)')
