import { readFile } from "node:fs/promises";
import path from "node:path";
import { GoogleAuth } from "google-auth-library";

const root = process.cwd();
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  ? path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS)
  : path.join(root, "secrets", "google-drive-reader.json");
const folderId = process.env.PUNTOS_DRIVE_FOLDER_ID?.trim();
const official = [
  "PUFAV.xlsx",
  "PUEXA.xlsx",
  "PUINGE.xlsx",
  "PUECON.xlsx",
  "PUHUM.xlsx",
];

try {
  if (!folderId) {
    throw new Error("Falta PUNTOS_DRIVE_FOLDER_ID en la configuración del servidor.");
  }
  const credentials = JSON.parse(await readFile(keyPath, "utf8"));
  if (credentials.type !== "service_account") {
    throw new Error("El JSON no corresponde a una cuenta de servicio.");
  }
  console.log(`Cuenta técnica: ${credentials.client_email}`);

  const auth = new GoogleAuth({
    keyFile: keyPath,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  const client = await auth.getClient();
  const headers = await client.getRequestHeaders();
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", `'${folderId}' in parents and trashed = false`);
  url.searchParams.set("fields", "files(id,name,mimeType,modifiedTime,size)");
  url.searchParams.set("pageSize", "100");

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(45_000),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Google Drive respondió ${response.status}: ${body.slice(0, 600)}`);
  }

  const files = JSON.parse(body).files ?? [];
  console.log(`Archivos visibles en la carpeta: ${files.length}`);
  for (const name of official) {
    const matches = files.filter((file) => file.name === name);
    console.log(`${matches.length === 1 ? "OK" : "REVISAR"} - ${name}: ${matches.length} coincidencia(s)`);
  }
  const unknown = files.filter(
    (file) => file.mimeType !== "application/vnd.google-apps.folder" && !official.includes(file.name),
  );
  for (const file of unknown) {
    console.log(`NO RECONOCIDO - ${file.name}`);
  }
  console.log("Diagnóstico de conexión finalizado.");
} catch (error) {
  console.error("DIAGNÓSTICO FALLIDO");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
