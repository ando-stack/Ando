# Imagen para publicar AutoClips como web (p. ej. en Hugging Face Spaces).
FROM python:3.11-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1
WORKDIR /home/user/app

COPY --chown=user requirements.txt requirements-ia.txt ./
RUN pip install --no-cache-dir --user -r requirements.txt -r requirements-ia.txt \
 && python -c "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8')"

COPY --chown=user . .

EXPOSE 7860
# Actualiza yt-dlp al arrancar: las webs cambian a menudo y así siguen funcionando los enlaces.
CMD ["sh", "-c", "pip install -q --user -U 'yt-dlp[default]' ; exec python app.py --red --sin-navegador --puerto ${PORT:-7860}"]
