export type BreakdownItem = {
  total: number;
  used: number;
  available: number;
};

export type Breakdown = {
  active: BreakdownItem;
  license: BreakdownItem;
  free: BreakdownItem;
};

export type ImportAttempt = {
  attempt: number;
  validatorVersion?: string;
  status: "vigente" | "rechazado";
  fileName: string;
  driveFileId: string;
  driveModifiedAt: string;
  detectedAt: string;
  validatedAt: string;
  activatedAt?: string;
  sha256: string;
  recordCount: number;
  checks: string[];
  errors: string[];
  warnings: string[];
};

export type DriveFileMarker = {
  fileId: string;
  fileName: string;
  modifiedTime: string;
  version?: string;
  md5Checksum?: string;
  size?: string;
};

export type FacultyRecord = {
  id: string;
  code: number;
  name: string;
  short: string;
  color: string;
  total: number;
  used: number;
  available: number;
  breakdown: Breakdown;
  loadedAt?: string;
  fileName?: string;
  status: "vigente" | "pendiente" | "observado";
  note?: string;
  source: {
    expectedFileName: string;
    current?: ImportAttempt;
    lastAttempt?: ImportAttempt;
    lastObserved?: DriveFileMarker;
  };
};

export type DriveStatus = {
  configured: boolean;
  folderId: string;
  intervalSeconds: number;
  lastSyncAt?: string;
  status: "pendiente" | "correcto" | "advertencia" | "error";
  message: string;
  warnings: string[];
};

export type PilotState = {
  schemaVersion: 1;
  updatedAt: string;
  faculties: FacultyRecord[];
  history: Record<string, ImportAttempt[]>;
  drive: DriveStatus;
};

export type FacultyConfig = {
  codigo: number;
  id: string;
  sigla: string;
  nombre: string;
  archivoSugerido: string;
  color: string;
  identificadoresContenido: string[];
};

export type Summary = {
  total: number;
  used: number;
  available: number;
  breakdown: Breakdown;
};
