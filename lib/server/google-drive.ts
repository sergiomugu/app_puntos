import { access, readFile } from "node:fs/promises";
import { GoogleAuth } from "google-auth-library";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  version?: string;
  size?: string;
  md5Checksum?: string;
};

const scope = "https://www.googleapis.com/auth/drive.readonly";
const maximumRetries = 5;
let auth: GoogleAuth | undefined;

export function retryableDriveStatus(status: number) {
  return status === 429 || status === 500 || status === 502 ||
    status === 503 || status === 504;
}

export function driveRetryDelayMilliseconds(
  retryNumber: number,
  jitterMilliseconds = Math.floor(Math.random() * 1_001),
) {
  const normalizedRetry = Math.min(
    6,
    Math.max(1, Math.trunc(retryNumber)),
  );
  const normalizedJitter = Math.min(
    1_000,
    Math.max(0, Math.trunc(jitterMilliseconds)),
  );
  return Math.min(64_000, 2 ** normalizedRetry * 1_000) + normalizedJitter;
}

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function driveCredentialsAvailable() {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) return false;
  try {
    await access(keyPath);
    const credentials = JSON.parse(await readFile(keyPath, "utf8")) as {
      client_email?: string;
      private_key?: string;
      type?: string;
    };
    if (
      credentials.type !== "service_account" ||
      !credentials.client_email ||
      !credentials.private_key
    ) {
      throw new Error("La clave JSON no corresponde a una cuenta de servicio.");
    }
    return true;
  } catch {
    return false;
  }
}

async function authorizationHeaders() {
  auth ??= new GoogleAuth({ scopes: [scope] });
  const client = await auth.getClient();
  return client.getRequestHeaders();
}

async function driveFetch(url: URL) {
  const headers = await authorizationHeaders();
  for (let attempt = 0; attempt <= maximumRetries; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(45_000),
      });
    } catch (error) {
      if (attempt === maximumRetries) throw error;
      await wait(driveRetryDelayMilliseconds(attempt + 1));
      continue;
    }
    if (response.ok) return response;

    const detail = (await response.text()).slice(0, 600);
    const failure = new Error(
      `Google Drive respondió ${response.status}: ${detail || response.statusText}`,
    );
    if (!retryableDriveStatus(response.status) || attempt === maximumRetries) {
      throw failure;
    }
    await wait(driveRetryDelayMilliseconds(attempt + 1));
  }
  throw new Error("Google Drive agotó los reintentos disponibles.");
}

export async function listFolderFiles(folderId: string) {
  const files: DriveFile[] = [];
  let pageToken = "";
  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set(
      "q",
      `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`,
    );
    url.searchParams.set(
      "fields",
      "nextPageToken,files(id,name,mimeType,modifiedTime,version,size,md5Checksum)",
    );
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("spaces", "drive");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const payload = (await (await driveFetch(url)).json()) as {
      nextPageToken?: string;
      files?: DriveFile[];
    };
    files.push(...(payload.files ?? []));
    pageToken = payload.nextPageToken ?? "";
  } while (pageToken);
  return files;
}

export async function downloadDriveFile(fileId: string) {
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
  );
  url.searchParams.set("alt", "media");
  const response = await driveFetch(url);
  return Buffer.from(await response.arrayBuffer());
}
