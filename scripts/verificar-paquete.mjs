import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const forbidden = [
  ".env",
  "secrets/google-drive-reader.json",
  "data/state.json",
  "data/state.backup.json",
];
const required = [
  ".env.example",
  "Dockerfile",
  "compose.yaml",
  "PARAMETROS-INSTALACION.md",
  "INSTALACION-V2.3.1.md",
  "CAMBIOS-V2.3.1.md",
  "VERSION-INSTITUCIONAL.txt",
  "VALIDACION-ENTREGA.md",
  "db/migrations/001_identity_access_audit.sql",
  "db/migrations/002_unrc_email_domains.sql",
  "db/migrations/003_user_access_statistics.sql",
  "scripts/migrate.mjs",
  "scripts/bootstrap-admin.mjs",
];
const errors = [];

for (const relative of forbidden) {
  try {
    await access(path.join(root, relative));
    errors.push(`El paquete contiene un archivo prohibido: ${relative}`);
  } catch {
    // La ausencia es el resultado esperado.
  }
}

for (const relative of required) {
  try {
    await access(path.join(root, relative));
  } catch {
    errors.push(`Falta un archivo requerido: ${relative}`);
  }
}

const secretEntries = await readdir(path.join(root, "secrets"), {
  withFileTypes: true,
}).catch(() => []);
for (const entry of secretEntries) {
  if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
    errors.push(`No se admite una credencial JSON dentro de secrets/: ${entry.name}`);
  }
}

const envExample = await readFile(path.join(root, ".env.example"), "utf8");
if (!envExample.includes("REEMPLAZAR")) {
  errors.push(".env.example debe contener marcadores y nunca valores secretos reales.");
}

if (errors.length) {
  console.error("El paquete no es publicable:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Paquete publicable: estructura completa y sin credenciales ni estado real.");
}
