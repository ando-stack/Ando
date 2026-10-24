#!/usr/bin/env bash
# Aplica las migraciones en un PostgreSQL local con pgvector y ejecuta las pruebas de RLS.
# Requisitos: PostgreSQL 15+ (initdb, pg_ctl) y la extensión pgvector instalada.
set -euo pipefail
# PostgreSQL no arranca como root: si hace falta, se relanza como el usuario "postgres".
if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
  exec runuser -u postgres -- bash "$(readlink -f "$0")" "$@"
fi
DIR="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$DIR/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
TMP="$(mktemp -d)"
DATA="$TMP/data"
PORT="${PGPORT_TEST:-55432}"
"$PGBIN/initdb" -D "$DATA" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/pg.log" -w start >/dev/null
trap '"$PGBIN/pg_ctl" -D "$DATA" -m fast stop >/dev/null; rm -rf "$TMP"' EXIT
PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -c "create database estudia_test" postgres
"${PSQL[@]}" -d estudia_test -f "$DIR/supabase_stubs.sql"
for f in "$RAIZ"/supabase/migrations/*.sql; do
  echo "→ Migración $(basename "$f")"
  "${PSQL[@]}" -d estudia_test -f "$f"
done
echo "→ Pruebas de RLS y lógica de base de datos"
"${PSQL[@]}" -d estudia_test -f "$DIR/pruebas_rls.sql"
echo "✓ Base de datos: todas las pruebas pasan"
