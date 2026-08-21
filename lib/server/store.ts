import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createInitialState } from "./initial-state";
import type { PilotState } from "./types";

const dataRoot = process.env.PUNTOS_DATA_DIR
  ? path.resolve(/* turbopackIgnore: true */ process.env.PUNTOS_DATA_DIR)
  : path.join(process.cwd(), "data");
const statePath = path.join(dataRoot, "state.json");
const backupPath = path.join(dataRoot, "state.backup.json");
let queue: Promise<void> = Promise.resolve();

export const DEFAULT_ORIGINAL_RETENTION = 20;

const isMissing = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

async function readJson(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as PilotState;
}

async function readStateUnlocked(): Promise<PilotState> {
  await mkdir(dataRoot, { recursive: true });
  try {
    return await readJson(statePath);
  } catch (error) {
    if (!isMissing(error)) {
      try {
        const backup = await readJson(backupPath);
        await writeFile(statePath, `${JSON.stringify(backup, null, 2)}\n`, "utf8");
        return backup;
      } catch {
        throw error;
      }
    }
    const state = createInitialState();
    await writeStateUnlocked(state);
    return state;
  }
}

async function writeStateUnlocked(state: PilotState) {
  await mkdir(dataRoot, { recursive: true });
  const temporary = `${statePath}.${process.pid}.tmp`;
  const serialized = `${JSON.stringify(state, null, 2)}\n`;

  // En Windows, renombrar un archivo temporal sobre state.json puede fallar
  // cuando el destino ya existe. Conservamos una copia recuperable y usamos
  // copyFile, que reemplaza el destino de forma compatible con Windows 10.
  try {
    await copyFile(statePath, backupPath);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  await writeFile(temporary, serialized, "utf8");
  try {
    await copyFile(temporary, statePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

function locked<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation, operation);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function getState() {
  await queue;
  return readStateUnlocked();
}

export function updateState(
  mutator: (state: PilotState) => void | Promise<void>,
) {
  return locked(async () => {
    const state = await readStateUnlocked();
    await mutator(state);
    state.updatedAt = new Date().toISOString();
    await writeStateUnlocked(state);
    return state;
  });
}

export async function saveOriginal(
  facultyId: string,
  attempt: number,
  status: "vigente" | "rechazado",
  fileName: string,
  buffer: Buffer,
) {
  const directory = path.join(dataRoot, "originales", facultyId);
  await mkdir(directory, { recursive: true });
  const safeName = fileName.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const target = path.join(
    directory,
    `${String(attempt).padStart(4, "0")}-${status}-${safeName}`,
  );
  await writeFile(target, buffer, { flag: "wx" }).catch(async (error) => {
    const exists =
      error instanceof Error && "code" in error && error.code === "EEXIST";
    if (!exists) throw error;
  });
}

function originalRetentionLimit() {
  const parsed = Number.parseInt(
    process.env.PUNTOS_ORIGINAL_RETENTION ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 1000
    ? parsed
    : DEFAULT_ORIGINAL_RETENTION;
}

export function originalsToRemove(
  fileNames: string[],
  protectedAttempt?: number,
  retention = DEFAULT_ORIGINAL_RETENTION,
) {
  const candidates = fileNames
    .map((fileName) => ({
      fileName,
      attempt: Number.parseInt(fileName.match(/^(\d+)-/)?.[1] ?? "", 10),
    }))
    .filter((entry) => Number.isFinite(entry.attempt))
    .sort((left, right) => right.attempt - left.attempt);
  const retained = new Set(
    candidates.slice(0, Math.max(1, retention)).map((entry) => entry.fileName),
  );
  if (protectedAttempt !== undefined) {
    for (const entry of candidates) {
      if (entry.attempt === protectedAttempt) retained.add(entry.fileName);
    }
  }
  return candidates
    .filter((entry) => !retained.has(entry.fileName))
    .map((entry) => entry.fileName);
}

export async function pruneOriginals(
  facultyId: string,
  protectedAttempt?: number,
) {
  const directory = path.join(dataRoot, "originales", facultyId);
  let fileNames: string[];
  try {
    fileNames = await readdir(directory);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  const obsolete = originalsToRemove(
    fileNames,
    protectedAttempt,
    originalRetentionLimit(),
  );
  await Promise.all(
    obsolete.map((fileName) => rm(path.join(directory, fileName), { force: true })),
  );
}
