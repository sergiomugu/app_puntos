import { access, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const errors = [];
const required = [
  "PUNTOS_BASE_URL",
  "DATABASE_URL",
  "PUNTOS_GOOGLE_CLIENT_ID",
  "PUNTOS_GOOGLE_CLIENT_SECRET",
  "PUNTOS_AUTH_SECRET",
  "PUNTOS_COOKIE_SECURE",
  "PUNTOS_INITIAL_ADMIN_EMAIL",
  "PUNTOS_INITIAL_ADMIN_NAME",
  "PUNTOS_DRIVE_FOLDER_ID",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "PUNTOS_DATA_DIR",
];

for (const name of required) {
  if (!process.env[name]?.trim()) errors.push(`Falta ${name}.`);
  else if (/REEMPLAZAR/i.test(process.env[name])) {
    errors.push(`${name} conserva un marcador REEMPLAZAR.`);
  }
}
try {
  const baseUrl = new URL(process.env.PUNTOS_BASE_URL || "");
  if (process.env.PUNTOS_COOKIE_SECURE !== "false" && baseUrl.protocol !== "https:") {
    errors.push("PUNTOS_BASE_URL debe utilizar HTTPS.");
  }
  if (
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash ||
    (baseUrl.pathname !== "/" && baseUrl.pathname !== "")
  ) {
    errors.push("PUNTOS_BASE_URL debe contener solamente el origen público, sin ruta ni parámetros.");
  }
} catch {
  errors.push("PUNTOS_BASE_URL no tiene un formato válido.");
}
if ((process.env.PUNTOS_AUTH_SECRET ?? "").length < 64) {
  errors.push("PUNTOS_AUTH_SECRET debe tener al menos 64 caracteres aleatorios.");
}
const institutionalDomain = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*unrc\.edu\.ar$/;
const domainHint = (process.env.PUNTOS_GOOGLE_HOSTED_DOMAIN_HINT || "").trim().toLowerCase();
if (domainHint && domainHint !== "*" && !institutionalDomain.test(domainHint)) {
  errors.push("PUNTOS_GOOGLE_HOSTED_DOMAIN_HINT debe ser *, unrc.edu.ar o un subdominio institucional válido.");
}
if (process.env.NODE_ENV === "production" && process.env.PUNTOS_COOKIE_SECURE !== "true") {
  errors.push("PUNTOS_COOKIE_SECURE debe ser true en producción.");
}
const institutionalEmail = /^[^@\s]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*unrc\.edu\.ar$/;
if (!institutionalEmail.test((process.env.PUNTOS_INITIAL_ADMIN_EMAIL || "").toLowerCase())) {
  errors.push("PUNTOS_INITIAL_ADMIN_EMAIL debe pertenecer a unrc.edu.ar o a un subdominio institucional válido.");
}
if ((process.env.PUNTOS_INITIAL_ADMIN_NAME || "").trim().length < 3) {
  errors.push("PUNTOS_INITIAL_ADMIN_NAME debe identificar al administrador principal.");
}

for (const [name, minimum, maximum] of [
  ["PUNTOS_SESSION_IDLE_MINUTES", 5, 240],
  ["PUNTOS_SESSION_ABSOLUTE_HOURS", 1, 24],
  ["PUNTOS_REAUTH_MINUTES", 1, 30],
  ["PUNTOS_SYNC_INTERVAL_SECONDS", 30, 3600],
  ["PUNTOS_MAX_FILE_MB", 1, 100],
  ["PUNTOS_ORIGINAL_RETENTION", 1, 1000],
]) {
  if (!process.env[name]?.trim()) continue;
  const parsed = Number.parseInt(process.env[name], 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    errors.push(`${name} debe ser un entero entre ${minimum} y ${maximum}.`);
  }
}

const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credentialsPath) {
  try {
    await access(credentialsPath);
    const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
    if (
      credentials.type !== "service_account" ||
      !credentials.client_email ||
      !credentials.private_key
    ) {
      errors.push("La credencial de Google Drive no es una cuenta de servicio válida.");
    }
  } catch {
    errors.push("No se pudo leer la credencial indicada por GOOGLE_APPLICATION_CREDENTIALS.");
  }
}

const dataDirectory = process.env.PUNTOS_DATA_DIR;
if (dataDirectory) {
  try {
    await mkdir(path.resolve(dataDirectory), { recursive: true });
    const testPath = path.join(path.resolve(dataDirectory), ".write-test");
    await writeFile(testPath, "ok", { mode: 0o600 });
    await rm(testPath, { force: true });
  } catch {
    errors.push("PUNTOS_DATA_DIR no existe o el usuario del servicio no puede escribir allí.");
  }
}

if (process.env.DATABASE_URL) {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PUNTOS_DATABASE_SSL === "true"
      ? { rejectUnauthorized: true }
      : false,
  });
  try {
    await client.connect();
    const result = await client.query(
      `SELECT to_regclass('public.app_users') AS users,
        to_regclass('public.audit_log') AS audit,
        to_regclass('public.user_activity_events') AS activity`,
    );
    if (!result.rows[0]?.users || !result.rows[0]?.audit || !result.rows[0]?.activity) {
      errors.push("PostgreSQL responde, pero faltan migraciones de identidad, auditoría o estadísticas.");
    } else {
      const principal = await client.query(
        `SELECT EXISTS (
          SELECT 1 FROM app_users
          WHERE protected_principal = true
            AND role_code = 'ADMIN_GENERAL'
            AND status_code = 'ACTIVO'
            AND lower(email) = lower($1)
        ) AS found`,
        [process.env.PUNTOS_INITIAL_ADMIN_EMAIL],
      );
      if (!principal.rows[0]?.found) {
        errors.push("No se encontró el Administrador General principal protegido configurado.");
      }
    }
  } catch {
    errors.push("No se pudo conectar con PostgreSQL mediante DATABASE_URL.");
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (errors.length) {
  console.error("Configuración incompleta:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Configuración válida: Google Workspace, PostgreSQL, Google Drive y persistencia disponibles.");
}
