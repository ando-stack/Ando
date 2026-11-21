# --- Stage 1: build the FortniteReplayDecompressor CLI (optional adapter, separate process)
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS frd
WORKDIR /src
COPY replay-tools/FrdExport/ ./
RUN dotnet publish -c Release -o /out

# --- Stage 2: API + worker
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libicu-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# .NET runtime for FrdExport
COPY --from=mcr.microsoft.com/dotnet/runtime:10.0 /usr/share/dotnet /usr/share/dotnet
ENV DOTNET_ROOT=/usr/share/dotnet FRD_CLI=/opt/frdexport/FrdExport DATA_DIR=/data PYTHONUNBUFFERED=1
COPY --from=frd /out /opt/frdexport
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
RUN useradd -r -u 10001 fva && mkdir -p /data && chown fva /data
USER fva
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
