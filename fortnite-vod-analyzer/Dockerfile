# Hugging Face Space (SDK: Docker) — todo en un contenedor: web + API + worker en el puerto 7860.
# Modo reglas (sin IA ni claves). Datos en /data (efímeros en el plan gratuito).

FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
ENV NEXT_PUBLIC_API_URL=/backend BACKEND_PROXY_URL=http://127.0.0.1:8000 NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS frd
WORKDIR /src
COPY replay-tools/FrdExport/ ./
RUN dotnet publish -c Release -r linux-x64 --self-contained true -p:PublishSingleFile=true -o /out

FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends nodejs libgl1 libglib2.0-0 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/app backend/app
COPY --from=web /web/.next/standalone web/
COPY --from=web /web/.next/static web/.next/static
COPY --from=frd /out/FrdExport /opt/frdexport/FrdExport
COPY space-start.sh /app/space-start.sh
RUN useradd -m -u 1000 user && mkdir -p /data && chown -R user /data /app
USER user
ENV DATA_DIR=/data FRD_CLI=/opt/frdexport/FrdExport ALLOW_REGISTRATION=false PUBLIC_API_URL=/backend \
    PORT=7860 HOSTNAME=0.0.0.0 PYTHONUNBUFFERED=1
EXPOSE 7860
CMD ["bash", "/app/space-start.sh"]
