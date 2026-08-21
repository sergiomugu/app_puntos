import pilotConfig from "../../config/piloto.json";

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function driveRuntimeConfig() {
  return {
    folderId:
      process.env.PUNTOS_DRIVE_FOLDER_ID?.trim() ||
      pilotConfig.googleDrive.folderId.trim(),
    intervalSeconds: positiveInteger(
      process.env.PUNTOS_SYNC_INTERVAL_SECONDS,
      pilotConfig.googleDrive.intervaloSegundos,
    ),
    maximumMegabytes: positiveInteger(
      process.env.PUNTOS_MAX_FILE_MB,
      pilotConfig.googleDrive.tamanoMaximoMB,
    ),
  };
}
