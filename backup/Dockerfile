# Servicio cron de Railway que respalda la base todas las noches (respaldo-base.js).
# Imagen aparte porque necesita pg_dump 18 (el de Debian es más viejo y no puede
# volcar un servidor 18): se instala del repositorio oficial de PostgreSQL (PGDG).
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-18 \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backup/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY backup/respaldo-base.js ./

CMD ["node", "respaldo-base.js"]
