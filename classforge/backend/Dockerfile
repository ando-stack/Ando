# Backend de ClassForge AI listo para Hugging Face Spaces (Docker) o Render.
FROM python:3.12-slim

# LibreOffice: conversión a PDF y recálculo/verificación de fórmulas.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-writer libreoffice-calc libreoffice-impress \
      fonts-dejavu fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea \
 && rm -rf /var/lib/apt/lists/*

# Hugging Face ejecuta el contenedor con el usuario 1000.
RUN useradd -m -u 1000 user
WORKDIR /home/user/app

COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=user app ./app

USER user
ENV HOME=/home/user \
    PYTHONUNBUFFERED=1 \
    CLASSFORGE_DATA_DIR=/tmp/classforge-data \
    MPLCONFIGDIR=/tmp/matplotlib \
    PORT=7860
EXPOSE 7860
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
