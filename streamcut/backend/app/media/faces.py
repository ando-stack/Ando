"""Detector de caras compartido (análisis de vídeo y seguimiento de cara).

Usa YuNet (red neuronal ligera de OpenCV, modelo incluido en ``assets/models``), que detecta caras
de frente, de lado, pequeñas y con mala luz. Si la versión de OpenCV no lo trae, usa el clasificador
Haar clásico cuando existe; si no hay ninguno, no detecta caras (y el resto sigue funcionando).
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)
MODEL = Path(__file__).parent / "assets" / "models" / "face_detection_yunet_2023mar.onnx"
Face = tuple[float, float, float, float]  # cx, cy, w, h normalizados (0..1)


class FaceDetector:
    def __init__(self, width: int, height: int, score: float = 0.6) -> None:
        self.w, self.h = width, height
        self.kind = "none"
        self._yn = None
        self._haar: list = []
        try:
            import cv2
            self._cv2 = cv2
        except Exception:  # pragma: no cover - OpenCV es dependencia obligatoria
            return
        if hasattr(cv2, "FaceDetectorYN") and MODEL.exists():
            try:
                try:  # OpenCV avisa de que no usa GPU para este modelo: no es un error
                    cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)
                except Exception:
                    pass
                self._yn = cv2.FaceDetectorYN.create(str(MODEL), "", (width, height), score, 0.3, 50)
                self.kind = "yunet"
                return
            except Exception as exc:
                log.warning("YuNet no disponible: %s", exc)
        if hasattr(cv2, "CascadeClassifier") and hasattr(cv2, "data"):
            for name in ("haarcascade_frontalface_default.xml", "haarcascade_profileface.xml"):
                c = cv2.CascadeClassifier(cv2.data.haarcascades + name)
                if not c.empty():
                    self._haar.append(c)
            if self._haar:
                self.kind = "haar"
        if self.kind == "none":
            log.warning("No hay detector de caras disponible en esta versión de OpenCV")

    @property
    def available(self) -> bool:
        return self.kind != "none"

    def detect(self, bgr: np.ndarray) -> list[Face]:
        """Caras en una imagen BGR del tamaño indicado al crear el detector."""
        w, h = self.w, self.h
        out: list[Face] = []
        if self._yn is not None:
            _, res = self._yn.detect(bgr)
            for row in (res if res is not None else []):
                x, y, fw, fh = (float(v) for v in row[:4])
                out.append((round((x + fw / 2) / w, 4), round((y + fh / 2) / h, 4), round(fw / w, 4), round(fh / h, 4)))
            return out
        if self._haar:
            gray = self._cv2.equalizeHist(self._cv2.cvtColor(bgr, self._cv2.COLOR_BGR2GRAY))
            for k, c in enumerate(self._haar):
                for (x, y, fw, fh) in c.detectMultiScale(gray, scaleFactor=1.12, minNeighbors=5, minSize=(20, 20)):
                    f = (round((x + fw / 2) / w, 4), round((y + fh / 2) / h, 4), round(fw / w, 4), round(fh / h, 4))
                    if k and any(abs(f[0] - g[0]) < g[2] / 2 and abs(f[1] - g[1]) < g[3] / 2 for g in out):
                        continue
                    out.append(f)
        return out
