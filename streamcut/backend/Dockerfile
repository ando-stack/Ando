FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core fonts-inter libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* && useradd -m -u 10001 streamcut
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
RUN mkdir -p /data && chown -R streamcut /data /app
USER streamcut
ENV STREAMCUT_DATA_DIR=/data HF_HOME=/data/models
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers"]
