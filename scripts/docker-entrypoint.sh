#!/bin/sh
set -eu

node /app/scripts/migrate.mjs
node /app/scripts/bootstrap-admin.mjs
node /app/scripts/verificar-configuracion.mjs
exec node /app/server.js
