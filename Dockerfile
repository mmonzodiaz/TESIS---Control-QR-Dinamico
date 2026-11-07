# Imagen de despliegue (Railway u otro servicio de contenedores). Un solo contenedor con:
#   - Caddy: sirve la app compilada y reenvia /api al backend y /registro-civil al emisor simulado;
#   - backend del recinto (uvicorn, puerto interno 8000), con la base PostgreSQL de DATABASE_URL;
#   - Registro Civil simulado (uvicorn, puerto interno 8001), con sus claves en el volumen /data.
# Por que uno solo y no tres servicios: docs/despliegue.md.

FROM node:24-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM caddy:2.10.2 AS caddy

FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /usr/local/bin/uv
COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/ ./
COPY --from=web /app/frontend/dist /srv
COPY deploy/ /app/deploy/
RUN chmod +x /app/deploy/start.sh
CMD ["/app/deploy/start.sh"]
