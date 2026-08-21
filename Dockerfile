FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run verify:release

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    PUNTOS_DATA_DIR=/var/lib/control-puntos-docentes \
    GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/google-drive-reader.json
WORKDIR /app
RUN mkdir -p /var/lib/control-puntos-docentes /run/secrets \
    && chown -R node:node /var/lib/control-puntos-docentes /app
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/db ./db
COPY --from=builder --chown=node:node \
    /app/scripts/migrate.mjs \
    /app/scripts/bootstrap-admin.mjs \
    /app/scripts/verificar-configuracion.mjs \
    /app/scripts/docker-entrypoint.sh \
    ./scripts/
RUN chmod 550 /app/scripts/docker-entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
