import { createHash } from "node:crypto";
import facultiesConfig from "../../config/facultades.json";
import {
  downloadDriveFile,
  driveCredentialsAvailable,
  listFolderFiles,
  type DriveFile,
} from "./google-drive";
import {
  VALIDATOR_VERSION,
  validateWorkbook,
} from "./excel-validator";
import { getState, pruneOriginals, saveOriginal, updateState } from "./store";
import type {
  DriveFileMarker,
  FacultyConfig,
  FacultyRecord,
  ImportAttempt,
  PilotState,
} from "./types";
import { driveRuntimeConfig } from "./runtime-config";

const configs = facultiesConfig.facultades as FacultyConfig[];
let activeSync: Promise<PilotState> | undefined;

export function shouldSkipDownloadedFile(
  current: ImportAttempt | undefined,
  lastAttempt: ImportAttempt | undefined,
  sha256: string,
) {
  if (current?.sha256 === sha256) return true;
  return (
    lastAttempt?.sha256 === sha256 &&
    lastAttempt.validatorVersion === VALIDATOR_VERSION
  );
}

export function driveFileMarker(driveFile: DriveFile): DriveFileMarker {
  return {
    fileId: driveFile.id,
    fileName: driveFile.name,
    modifiedTime: driveFile.modifiedTime,
    version: driveFile.version,
    md5Checksum: driveFile.md5Checksum,
    size: driveFile.size,
  };
}

function markerFromAttempt(
  attempt: ImportAttempt | undefined,
): DriveFileMarker | undefined {
  return attempt
    ? {
        fileId: attempt.driveFileId,
        fileName: attempt.fileName,
        modifiedTime: attempt.driveModifiedAt,
      }
    : undefined;
}

export function driveMetadataUnchanged(
  marker: DriveFileMarker | undefined,
  driveFile: DriveFile,
) {
  if (
    !marker ||
    marker.fileId !== driveFile.id ||
    marker.fileName !== driveFile.name
  ) {
    return false;
  }
  if (marker.md5Checksum && driveFile.md5Checksum) {
    return marker.md5Checksum === driveFile.md5Checksum;
  }
  if (marker.version && driveFile.version) {
    return marker.version === driveFile.version;
  }
  return marker.modifiedTime === driveFile.modifiedTime &&
    (!marker.size || !driveFile.size || marker.size === driveFile.size);
}

export function shouldDownloadDriveFile(
  source: FacultyRecord["source"],
  driveFile: DriveFile,
) {
  if (
    source.lastAttempt?.status === "rechazado" &&
    source.lastAttempt.validatorVersion !== VALIDATOR_VERSION
  ) {
    return true;
  }
  const previousMarker = source.lastObserved ?? markerFromAttempt(
    source.lastAttempt ?? source.current,
  );
  return !driveMetadataUnchanged(previousMarker, driveFile);
}

const displayStamp = (iso: string) => {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("day")}/${value("month")}/${value("year")}|${value("hour")}:${value("minute")}`;
};

export function sanitizedMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Error desconocido";
  if (/SERVICE_DISABLED|accessNotConfigured|has not been used|API.+disabled/i.test(message)) {
    return "La API de Google Drive no está habilitada en el proyecto de Google Cloud.";
  }
  if (/invalid_grant|unauthorized_client|invalid_client/i.test(message)) {
    return "La credencial de Google Drive fue rechazada. Revise la clave JSON y la hora de Windows.";
  }
  if (/403|insufficient|permission/i.test(message)) {
    return "La cuenta de servicio no tiene permiso de lector sobre la carpeta configurada.";
  }
  if (/404|not.?found/i.test(message)) {
    return "Google Drive no encontró la carpeta o el archivo solicitado.";
  }
  if (/timeout|aborted|UND_ERR_CONNECT_TIMEOUT|fetch failed/i.test(message)) {
    return "No fue posible comunicarse con Google Drive. Revise la conexión a Internet, el proxy o el firewall institucional.";
  }
  return `No se pudo consultar Google Drive: ${message.slice(0, 220)}`;
}

async function registerDriveFailure(message: string, configured: boolean) {
  return updateState((state) => {
    state.drive.configured = configured;
    state.drive.lastSyncAt = new Date().toISOString();
    state.drive.status = "error";
    state.drive.message = message;
  });
}

async function runSync() {
  const driveConfig = driveRuntimeConfig();
  if (!driveConfig.folderId) {
    return registerDriveFailure(
      "No se configuró PUNTOS_DRIVE_FOLDER_ID. El tablero conserva la última información válida.",
      false,
    );
  }
  const configured = await driveCredentialsAvailable();
  if (!configured) {
    return registerDriveFailure(
      "No se encontró la credencial de sólo lectura indicada por GOOGLE_APPLICATION_CREDENTIALS. El tablero conserva la última información válida.",
      false,
    );
  }

  let files;
  try {
    files = await listFolderFiles(driveConfig.folderId);
  } catch (error) {
    return registerDriveFailure(sanitizedMessage(error), true);
  }

  const syncStartedAt = new Date().toISOString();
  const warnings: string[] = [];
  const officialNames = new Set(configs.map((config) => config.archivoSugerido));
  const unknownFiles = files.filter(
    (file) =>
      file.mimeType !== "application/vnd.google-apps.folder" &&
      !officialNames.has(file.name),
  );
  if (unknownFiles.length) {
    const unknownNames = unknownFiles
      .map((file) => `“${file.name}”`)
      .join(", ");
    warnings.push(
      `${unknownFiles.length} archivo(s) no reconocido(s) fueron ignorados: ${unknownNames}.`,
    );
  }

  for (const facultyConfig of configs) {
    try {
    const candidates = files.filter(
      (file) => file.name === facultyConfig.archivoSugerido,
    );
    if (!candidates.length) continue;
    if (candidates.length > 1) {
      warnings.push(
        `${facultyConfig.archivoSugerido}: hay ${candidates.length} archivos con el mismo nombre; no se actualizó.`,
      );
      continue;
    }

    const driveFile = candidates[0];
    const before = await getState();
    const currentFaculty = before.faculties.find(
      (faculty) => faculty.id === facultyConfig.id,
    );
    if (
      currentFaculty &&
      !shouldDownloadDriveFile(currentFaculty.source, driveFile)
    ) {
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = await downloadDriveFile(driveFile.id);
    } catch (error) {
      warnings.push(
        `${driveFile.name}: ${sanitizedMessage(error).replace(/^No se pudo consultar Google Drive:\s*/i, "")}`,
      );
      continue;
    }

    const sha256 = createHash("sha256").update(buffer).digest("hex");
    if (
      shouldSkipDownloadedFile(
        currentFaculty?.source.current,
        currentFaculty?.source.lastAttempt,
        sha256,
      )
    ) {
      await updateState((state) => {
        const faculty = state.faculties.find(
          (item) => item.id === facultyConfig.id,
        );
        if (faculty) faculty.source.lastObserved = driveFileMarker(driveFile);
      });
      continue;
    }

    const validation = await validateWorkbook(
      buffer,
      facultyConfig,
      driveConfig.maximumMegabytes * 1024 * 1024,
    );
    const now = new Date().toISOString();
    const previousHistory = before.history[facultyConfig.id] ?? [];
    const attemptNumber =
      Math.max(0, ...previousHistory.map((entry) => entry.attempt)) + 1;
    const attempt: ImportAttempt = {
      attempt: attemptNumber,
      validatorVersion: VALIDATOR_VERSION,
      status: validation.valid ? "vigente" : "rechazado",
      fileName: driveFile.name,
      driveFileId: driveFile.id,
      driveModifiedAt: driveFile.modifiedTime,
      detectedAt: syncStartedAt,
      validatedAt: now,
      activatedAt: validation.valid ? now : undefined,
      sha256,
      recordCount: validation.recordCount,
      checks: validation.checks,
      errors: validation.errors,
      warnings: validation.warnings,
    };

    await saveOriginal(
      facultyConfig.id,
      attemptNumber,
      attempt.status,
      driveFile.name,
      buffer,
    );

    const updatedState = await updateState((state) => {
      state.history[facultyConfig.id] ??= [];
      state.history[facultyConfig.id].unshift(attempt);
      state.history[facultyConfig.id] = state.history[facultyConfig.id].slice(
        0,
        100,
      );
      const faculty = state.faculties.find(
        (item) => item.id === facultyConfig.id,
      );
      if (!faculty) return;
      faculty.source.lastObserved = driveFileMarker(driveFile);
      faculty.source.lastAttempt = attempt;
      if (!validation.valid || !validation.summary) {
        faculty.note = validation.errors.join(" ");
        return;
      }
      faculty.total = validation.summary.total;
      faculty.used = validation.summary.used;
      faculty.available = validation.summary.available;
      faculty.breakdown = validation.summary.breakdown;
      faculty.loadedAt = displayStamp(now);
      faculty.fileName = driveFile.name;
      faculty.status = "vigente";
      faculty.note = undefined;
      faculty.source.current = attempt;
    });
    const updatedFaculty = updatedState.faculties.find(
      (item) => item.id === facultyConfig.id,
    );
    await pruneOriginals(
      facultyConfig.id,
      updatedFaculty?.source.current?.attempt,
    );
    } catch (error) {
      warnings.push(
        `${facultyConfig.archivoSugerido}: ${sanitizedMessage(error).replace(/^No se pudo consultar Google Drive:\s*/i, "")}`,
      );
    }
  }

  return updateState((state) => {
    for (const config of configs) {
      const faculty = state.faculties.find((item) => item.id === config.id);
      if (faculty) faculty.source.expectedFileName = config.archivoSugerido;
    }
    state.drive.configured = true;
    state.drive.lastSyncAt = new Date().toISOString();
    state.drive.warnings = warnings;
    state.drive.status = warnings.length ? "advertencia" : "correcto";
    state.drive.message = warnings.length
      ? "Google Drive fue consultado; revise las advertencias registradas."
      : "Google Drive fue consultado correctamente.";
  });
}

export function syncDriveNow() {
  if (!activeSync) {
    activeSync = runSync().finally(() => {
      activeSync = undefined;
    });
  }
  return activeSync;
}

export async function maybeSyncDrive() {
  const state = await getState();
  const intervalMilliseconds = driveRuntimeConfig().intervalSeconds * 1000;
  const last = state.drive.lastSyncAt
    ? new Date(state.drive.lastSyncAt).getTime()
    : 0;
  if (Date.now() - last >= intervalMilliseconds) return syncDriveNow();
  return state;
}
