#!/bin/bash
# Arranque del contenedor de despliegue (ver Dockerfile y docs/despliegue.md).
set -euo pipefail

need() {
  if [ -z "${!1:-}" ]; then
    echo "Falta la variable $1. $2" >&2
    exit 1
  fi
}
need DATABASE_URL "Usa la base PostgreSQL del proyecto: \${{Postgres.DATABASE_URL}}."
need JWT_SECRET "Genera una con: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
need DEMO_ADMIN_PASSWORD "Contraseña del administrador demo (las del repositorio son públicas)."
need DEMO_GUARD_PASSWORD "Contraseña de los guardias demo (las del repositorio son públicas)."

# Claves y padrón del Registro Civil simulado: en el volumen, para que sobrevivan a cada despliegue.
# Si se pierden, todas las cédulas activadas dejan de servir y hay que activarlas de nuevo.
DATA_DIR="${DATA_DIR:-/data}"
export REGISTRO_CIVIL_DIR="$DATA_DIR/registro_civil"
export ISSUER_PUBLIC_KEY_FILE="$REGISTRO_CIVIL_DIR/issuer_public.key"
export VERIFIER_PRIVATE_KEY_FILE="$REGISTRO_CIVIL_DIR/verifier_private.key"
export REGISTRO_CIVIL_URL="http://127.0.0.1:8001"
mkdir -p "$REGISTRO_CIVIL_DIR"

# Contraseña de acceso al sitio. Las claves de activación demo están en el repositorio público: sin
# esta barrera, cualquiera podría activar a «Asistente Uno» en su teléfono y revocar el del piloto.
if [ -n "${ACCESO_CLAVE:-}" ]; then
  hash="$(caddy hash-password --plaintext "$ACCESO_CLAVE")"
  printf '@protegido not path /api/health\nbasic_auth @protegido {\n\t%s %s\n}\n' "${ACCESO_USUARIO:-piloto}" "$hash" > /tmp/acceso.caddy
elif [ "${ACCESO_ABIERTO:-}" = "1" ]; then
  echo "Aviso: sitio sin contraseña de acceso (ACCESO_ABIERTO=1)." >&2
  : > /tmp/acceso.caddy
else
  echo "Falta ACCESO_CLAVE (contraseña del sitio). Para dejarlo abierto a propósito: ACCESO_ABIERTO=1." >&2
  exit 1
fi

cd /app/backend
# Crea las tablas, el personal y el evento demo si faltan, y el padrón del emisor. Se puede repetir:
# no duplica nada ni revoca las cédulas ya activadas.
python -m app.seed

PROXY=(--proxy-headers --forwarded-allow-ips 127.0.0.1 --no-server-header)
# Un solo proceso por servidor: los límites de intentos viven en la memoria del proceso
# (docs/despliegue.md, «Pendiente para producción»).
uvicorn registro_civil.app:app --host 127.0.0.1 --port 8001 "${PROXY[@]}" &
uvicorn app.main:app --host 127.0.0.1 --port 8000 "${PROXY[@]}" &
caddy run --config /app/deploy/Caddyfile --adapter caddyfile &

# Si cualquiera de los tres se cae, el contenedor termina y Railway lo reinicia.
wait -n
exit 1
