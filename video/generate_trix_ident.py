import math, random, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

# Layout is defined on a 1280x720 grid; K scales the output resolution
# (1 = 720p, 1.5 = 1080p, 3 = 4K). R is the logo layer's render scale,
# kept above the largest on-screen size so the logo is only ever downsampled.
W0, H0, FPS = 1280, 720, 24
K = float(sys.argv[2]) if len(sys.argv) > 2 else 1.5
R = K * 1.35
W, H = int(round(W0 * K)), int(round(H0 * K))
LW, LH = int(round(W0 * R)), int(round(H0 * R))
DUR = 2.2
N = int(DUR * FPS)
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

RED = (198, 11, 30)
RED_D = (170, 21, 27)
YEL = (255, 196, 0)
PAPER = (240, 236, 226)
INK = (18, 18, 20)

FONTS = {
    'black': '/usr/share/fonts/opentype/inter/Inter-Black.otf',
    'serif': '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf',
    'mono': '/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf',
    'sans': '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
    'xb': '/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf',
}
for k, v in list(FONTS.items()):
    if not os.path.exists(v):
        FONTS[k] = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

rng = random.Random(7)


def torn_poly(w, h, jitter, n=40, seed=0):
    r = random.Random(seed)
    pts = []
    cx, cy = w / 2, h / 2
    for i in range(n):
        a = 2 * math.pi * i / n
        # superellipse-ish blob (rounded rect)
        ca, sa = math.cos(a), math.sin(a)
        ex = 4
        rx = (abs(ca) ** ex + abs(sa) ** ex) ** (-1 / ex)
        x = cx + ca * rx * w / 2 * (1 - r.uniform(0, jitter))
        y = cy + sa * rx * h / 2 * (1 - r.uniform(0, jitter))
        pts.append((x, y))
    return pts


def paper_noise(img, amt=14, seed=0):
    a = np.asarray(img).astype(np.int16)
    bh, bw = max(1, int(a.shape[0] / R)), max(1, int(a.shape[1] / R))
    g0 = np.random.default_rng(seed).integers(-amt, amt, (bh, bw)).astype(np.float32)
    g = np.asarray(Image.fromarray(g0, 'F').resize((a.shape[1], a.shape[0]), Image.BILINEAR))
    g = np.round(g).astype(np.int16)[..., None]
    a[..., :3] = np.clip(a[..., :3] + g, 0, 255)
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def make_tile(ch, font, fsize, bg, fg, outline, size, seed):
    S = 3 * R  # supersample
    w, h = size
    pad = 30
    im = Image.new('RGBA', (int((w + pad * 2) * S), int((h + pad * 2) * S)), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    off = pad * S
    outer = [(x * S + off, y * S + off) for x, y in torn_poly(w, h, 0.10, 46, seed)]
    d.polygon(outer, fill=PAPER + (255,))
    if bg != PAPER:
        iw, ih = w * 0.80, h * 0.82
        inner = [((x + (w - iw) / 2) * S + off, (y + (h - ih) / 2) * S + off)
                 for x, y in torn_poly(iw, ih, 0.08, 40, seed + 1)]
        d.polygon(inner, fill=bg + (255,))
    f = ImageFont.truetype(font, int(round(fsize * S)))
    cx, cy = (w / 2 + pad) * S, (h / 2 + pad) * S
    d.text((cx, cy), ch, font=f, fill=fg + (255,), anchor='mm',
           stroke_width=int(round(3 * S)) if outline else 0, stroke_fill=outline + (255,) if outline else None)
    im = im.resize((int((w + pad * 2) * R), int((h + pad * 2) * R)), Image.LANCZOS)
    im = paper_noise(im, 10, seed)
    # soft drop shadow
    a = im.split()[3]
    sh = Image.new('RGBA', im.size, (0, 0, 0, 0))
    sh.putalpha(a.point(lambda v: int(v * 0.55)).filter(ImageFilter.GaussianBlur(6 * R)))
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    out.alpha_composite(sh, (int(4 * R), int(6 * R)))
    out.alpha_composite(im)
    return out


def make_flag(seed=3):
    S = 3 * R
    w, h = 120, 80
    pad = 30
    im = Image.new('RGBA', (int((w + pad * 2) * S), int((h + pad * 2) * S)), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    off = pad * S
    outer = [(x * S + off, y * S + off) for x, y in torn_poly(w, h, 0.06, 40, seed)]
    d.polygon(outer, fill=PAPER + (255,))
    fx0, fy0, fx1, fy1 = (off + 10 * S, off + 9 * S, off + (w - 10) * S, off + (h - 9) * S)
    fh = fy1 - fy0
    d.rectangle([fx0, fy0, fx1, fy1], fill=RED_D + (255,))
    d.rectangle([fx0, fy0 + fh / 4, fx1, fy0 + fh * 3 / 4], fill=YEL + (255,))
    # tiny simplified coat-of-arms block
    ax = fx0 + (fx1 - fx0) * 0.30
    ay = fy0 + fh / 2
    d.rounded_rectangle([ax - 7 * S, ay - 9 * S, ax + 7 * S, ay + 9 * S], radius=int(3 * S), fill=(170, 21, 27, 255))
    d.rectangle([ax - 11 * S, ay - 8 * S, ax - 9 * S, ay + 9 * S], fill=(200, 200, 200, 255))
    d.rectangle([ax + 9 * S, ay - 8 * S, ax + 11 * S, ay + 9 * S], fill=(200, 200, 200, 255))
    d.ellipse([ax - 5 * S, ay - 14 * S, ax + 5 * S, ay - 8 * S], fill=(230, 170, 0, 255))
    im = im.resize((int((w + pad * 2) * R), int((h + pad * 2) * R)), Image.LANCZOS)
    # slight wave via column offsets
    a = np.asarray(im).copy()
    out = np.zeros_like(a)
    for x in range(a.shape[1]):
        dy = int(round(3 * R * math.sin(x / (18.0 * R))))
        out[:, x] = np.roll(a[:, x], dy, axis=0)
    im = Image.fromarray(out, 'RGBA')
    im = paper_noise(im, 8, seed)
    a = im.split()[3]
    sh = Image.new('RGBA', im.size, (0, 0, 0, 0))
    sh.putalpha(a.point(lambda v: int(v * 0.55)).filter(ImageFilter.GaussianBlur(6 * R)))
    o = Image.new('RGBA', im.size, (0, 0, 0, 0))
    o.alpha_composite(sh, (int(4 * R), int(6 * R)))
    o.alpha_composite(im)
    return o


# ---- assets ----
TILES = [
    # ch, font, size, bg, fg, outline, tilesize, final (dx,dy,rot)
    ('T', FONTS['black'], 92, PAPER, INK, None, (108, 128), (-165, 6, 5)),
    ('R', FONTS['serif'], 96, RED, PAPER, None, (104, 124), (-62, -6, -4)),
    ('I', FONTS['mono'], 104, YEL, RED_D, None, (78, 130), (30, 4, 3)),
    ('X', FONTS['sans'], 100, PAPER, RED, INK, (110, 122), (128, -4, -6)),
]
tile_imgs = [make_tile(c, f, s, bg, fg, ol, sz, 11 + i * 5) for i, (c, f, s, bg, fg, ol, sz, _) in enumerate(TILES)]
flag_img = make_flag()

ed = Image.new('RGBA', (int(260 * R), int(60 * R)), (0, 0, 0, 0))
dd = ImageDraw.Draw(ed)
dd.text((10 * R, 8 * R), 'edited by', font=ImageFont.truetype(FONTS['black'], int(round(30 * R))), fill=(255, 255, 255, 255),
        stroke_width=int(round(2 * R)), stroke_fill=(10, 10, 10, 255))

# background
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32) / K  # logical 1280x720 coords
bg = np.full((H, W, 3), 11, np.float32)
grid = ((xx % 14 < 2) & (yy % 14 < 2)).astype(np.float32) * 6
bg += grid[..., None]
vign = 1 - 0.45 * (((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
bg *= np.clip(vign, 0.4, 1)[..., None]

CX, CY = W0 / 2 + 10, H0 / 2 - 20


def ease_out_back(t, s=1.9):
    t -= 1
    return t * t * ((s + 1) * t + s) + 1


def ease_out(t):
    return 1 - (1 - t) ** 3


def clamp(x, a=0, b=1):
    return max(a, min(b, x))


def place(canvas, img, x, y, scale=1.0, rot=0.0, alpha=1.0, pix=1, mblur=(0, 0), sx=None, sy=None):
    if alpha <= 0.01 or scale <= 0.01:
        return
    sx = scale if sx is None else sx
    sy = scale if sy is None else sy
    w, h = img.size
    im = img.resize((max(1, int(w * sx)), max(1, int(h * sy))), Image.BILINEAR)
    if rot:
        im = im.rotate(rot, resample=Image.BICUBIC, expand=True)
    x, y = x * R, y * R
    mblur = (mblur[0] * R, mblur[1] * R)
    pix = int(round(pix * R)) if pix > 1 else 1
    if pix > 1:
        sw, shh = im.size
        im = im.resize((max(1, sw // pix), max(1, shh // pix)), Image.BILINEAR).resize((sw, shh), Image.NEAREST)
    if alpha < 1:
        a = im.split()[3].point(lambda v: int(v * alpha))
        im.putalpha(a)
    steps = 1
    if mblur != (0, 0):
        steps = 7
    if steps == 1:
        canvas.alpha_composite(im, (int(x - im.size[0] / 2), int(y - im.size[1] / 2)))
    else:
        acc = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
        a = im.split()[3].point(lambda v: int(v / 2.4))
        im2 = im.copy(); im2.putalpha(a)
        for k in range(steps):
            f = k / (steps - 1) - 0.5
            acc.alpha_composite(im2, (int(x - im.size[0] / 2 + mblur[0] * f), int(y - im.size[1] / 2 + mblur[1] * f)))
        canvas.alpha_composite(acc)


def ring_layer(t_draw, front, wob, jit):
    """ellipse orbit ring; draws on from 0..1, returns RGBA layer"""
    S = R * (2 if R < 2 else 1)
    L = Image.new('RGBA', (int(W0 * S), int(H0 * S)), (0, 0, 0, 0))
    if t_draw <= 0:
        return Image.new('RGBA', (LW, LH), (0, 0, 0, 0))
    d = ImageDraw.Draw(L)
    rx, ry = 255, 82
    tilt = math.radians(-12 + jit)
    end = 2 * math.pi * t_draw
    n = 220
    prev = None
    for i in range(n + 1):
        a = -math.pi * 0.95 + end * i / n
        isfront = math.sin(a) > 0
        x0 = math.cos(a) * rx * (1 + 0.03 * math.sin(3 * a + wob))
        y0 = math.sin(a) * ry
        x = CX + 15 + x0 * math.cos(tilt) - y0 * math.sin(tilt)
        y = CY + 8 + x0 * math.sin(tilt) + y0 * math.cos(tilt)
        p = (x * S, y * S)
        if prev is not None and isfront == front:
            mix = (math.cos(a) + 1) / 2
            col = tuple(int(RED[c] * mix + YEL[c] * (1 - mix)) for c in range(3))
            wdt = int((9 + 4 * math.sin(a)) * S)
            d.line([prev, p], fill=col + (255,), width=wdt)
            d.ellipse([p[0] - wdt / 2, p[1] - wdt / 2, p[0] + wdt / 2, p[1] + wdt / 2], fill=col + (255,))
        prev = p
    if L.size != (LW, LH):
        L = L.resize((LW, LH), Image.LANCZOS)
    # highlight / glow
    glow = L.filter(ImageFilter.GaussianBlur(8 * R))
    out = Image.new('RGBA', (LW, LH), (0, 0, 0, 0))
    out.alpha_composite(glow)
    out.alpha_composite(L)
    return out


def flare(canvas_np, cx, cy, r, col, strength):
    d2 = ((xx - cx) ** 2 + ((yy - cy) * 0.6) ** 2) / (r * r)
    m = np.exp(-d2) * strength
    canvas_np += m[..., None] * np.array(col, np.float32)[None, None, :]


FLARES = [  # time center, x, y, r, color
    (0.55, W0 * 0.98, H0 * 0.55, 110, (255, 80, 40)),
    (1.35, W0 * 0.95, H0 * 0.42, 90, (255, 170, 30)),
    (1.55, W0 * 0.04, H0 * 0.50, 120, (230, 40, 40)),
    (1.62, W0 * 0.70, H0 * 0.44, 60, (255, 200, 60)),
    (2.05, W0 * 0.62, H0 * 0.32, 70, (255, 120, 40)),
]

frng = random.Random(42)
for fi in range(N):
    t = fi / FPS
    logo = Image.new('RGBA', (LW, LH), (0, 0, 0, 0))
    # stop-motion jitter, changes every 2 frames
    jr = random.Random(fi // 2 * 13 + 5)
    jit = lambda a: jr.uniform(-a, a)
    settle = clamp((t - 0.9) / 0.2)

    # ring back
    rd = ease_out(clamp((t - 0.5) / 0.45))
    wob = t * 4
    ringJ = jit(1.2) if t > 0.95 else 0
    logo.alpha_composite(ring_layer(rd, False, wob, ringJ))

    # "edited by"
    te = clamp((t - 0.38) / 0.18)
    if te > 0:
        s = ease_out_back(te)
        place(logo, ed, CX - 150 + jit(1.5), CY - 92 + jit(1.5), scale=0.85 * s, rot=6 + jit(1.5), alpha=clamp(te * 3))

    # letters
    starts = [0.18, 0.26, 0.34, 0.42]
    scramble = [(-40, 10, -20), (-120, -10, 25), (60, 40, -30), (10, -30, 18)]
    for i, img in enumerate(tile_imgs):
        dx, dy, r = TILES[i][7]
        tt = clamp((t - starts[i]) / 0.16)
        if tt <= 0:
            continue
        # phase 1: pop in at scrambled spot; phase 2: snap to final (0.6-0.85s)
        snap = ease_out(clamp((t - 0.6 - i * 0.03) / 0.22))
        sx_, sy_, sr = scramble[i]
        px = CX + (sx_ + (dx - sx_) * snap) * (1.25 - 0.25 * snap)
        py = CY + sy_ + (dy - sy_) * snap
        rot = sr + (r - sr) * snap
        sc = ease_out_back(tt) * (1.0 + 0.12 * (1 - snap))
        pix = 1
        mb = (0, 0)
        if tt < 0.5:
            pix = 9 if tt < 0.25 else 5
            mb = (60 * (1 - tt), 0)
        if 0.6 < t < 0.85:
            mb = (int(45 * (1 - snap)), 0)
        place(logo, img, px + jit(2.5), py + jit(2.5), scale=sc, rot=rot + jit(2.5), pix=pix, mblur=mb)

    # flag sticker: falls in, then sits bottom-right of X
    tf = clamp(t / 0.3)
    if t < 0.62:
        fy = -60 + (CY - 70 + 60) * ease_out(tf)
        fx = CX + 30 - 60 * ease_out(clamp((t - 0.2) / 0.4))
        trail = int(200 * (1 - ease_out(tf)))
        place(logo, flag_img, fx, fy, scale=0.75, rot=-8 + 30 * (1 - tf), pix=6 if t < 0.12 else 1,
              mblur=(0, trail) if trail > 4 else (0, 0))
    else:
        mv = ease_out(clamp((t - 0.62) / 0.22))
        fx = CX - 30 + (CX + 215 - (CX - 30)) * mv
        fy = (CY - 10) + (CY + 52 - (CY - 10)) * mv
        place(logo, flag_img, fx + jit(2), fy + jit(2), scale=0.75 + 0.1 * mv, rot=-8 - 18 * mv + jit(3),
              mblur=(int(50 * (1 - mv)), 0) if mv < 0.9 else (0, 0))

    # ring front
    logo.alpha_composite(ring_layer(rd, True, wob, ringJ))

    # global: punch-in blur at snap, slow push, squash-out
    gscale = 1.22 + 0.05 * clamp((t - 0.9) / 0.9)
    sxg = syg = gscale
    if t > 1.78:
        k = ease_out(clamp((t - 1.78) / 0.16))
        syg *= (1 - 0.95 * k)
        sxg *= (1 + 0.35 * k)
    if t > 1.98:
        logo = Image.new('RGBA', (LW, LH), (0, 0, 0, 0))
    if True:
        lw, lh = int(W * sxg), max(1, int(H * syg))
        sm = logo.resize((lw, lh), Image.LANCZOS)
        logo = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        logo.alpha_composite(sm, (int(round((CX - CX * sxg) * K)), int(round((CY - CY * syg) * K))))
        if t > 1.78:
            logo = logo.filter(ImageFilter.BoxBlur(int((2 + 10 * clamp((t - 1.78) / 0.2)) * K)))
    if 0.62 < t < 0.8:
        g = logo.filter(ImageFilter.GaussianBlur(12 * K))
        a = g.split()[3].point(lambda v: int(v * 0.8))
        g.putalpha(a)
        glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        glow.alpha_composite(g)
        glow.alpha_composite(logo)
        logo = glow

    # compose
    frame = bg.copy()
    for (tc, fx_, fy_, r, col) in FLARES:
        s = math.exp(-((t - tc) / 0.09) ** 2)
        if s > 0.01:
            flare(frame, fx_ + 40 * (t - tc) * 10, fy_, r, col, 0.9 * s)
    # red flash streak at start (sticker entry)
    if t < 0.2:
        flare(frame, CX + 30, 120 + 900 * t, 40, (255, 60, 30), 1.2 * (1 - t / 0.2))
    la = np.asarray(logo).astype(np.float32)
    al = la[..., 3:4] / 255
    frame = frame * (1 - al) + la[..., :3] * al
    # grain
    g0 = np.random.default_rng(fi).normal(0, 5, (H0, W0)).astype(np.float32)
    g = np.asarray(Image.fromarray(g0, 'F').resize((W, H), Image.BILINEAR)) if K != 1 else g0
    frame += g[..., None] * (1 + 0.25 * (K > 1))
    Image.fromarray(np.clip(frame, 0, 255).astype(np.uint8)).save(f'{OUT}/f_{fi:03d}.png')
print('done', N)
