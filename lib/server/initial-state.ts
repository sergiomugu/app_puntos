import facultiesConfig from "../../config/facultades.json";
import type { FacultyRecord, PilotState } from "./types";
import { driveRuntimeConfig } from "./runtime-config";

const emptyBreakdown = () => ({
  active: { total: 0, used: 0, available: 0 },
  license: { total: 0, used: 0, available: 0 },
  free: { total: 0, used: 0, available: 0 },
});

export function createInitialState(): PilotState {
  const now = new Date().toISOString();
  const driveConfig = driveRuntimeConfig();
  const faculties = facultiesConfig.facultades.map((config) => ({
    id: config.id,
    code: config.codigo,
    name: config.nombre,
    short: config.sigla,
    color: config.color,
    total: 0,
    used: 0,
    available: 0,
    breakdown: emptyBreakdown(),
    status: "pendiente",
    note: "Pendiente de la primera validación desde Google Drive.",
    source: { expectedFileName: config.archivoSugerido },
  })) as FacultyRecord[];

  return {
    schemaVersion: 1,
    updatedAt: now,
    faculties,
    history: Object.fromEntries(faculties.map((faculty) => [faculty.id, []])),
    drive: {
      configured: false,
      folderId: driveConfig.folderId,
      intervalSeconds: driveConfig.intervalSeconds,
      status: "pendiente",
      message: "Pendiente de la primera conexión con Google Drive.",
      warnings: [],
    },
  };
}
