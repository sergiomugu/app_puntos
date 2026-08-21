import assert from "node:assert/strict";
import test from "node:test";
import {
  driveFileMarker,
  driveMetadataUnchanged,
  shouldDownloadDriveFile,
  shouldSkipDownloadedFile,
} from "../lib/server/sync-drive";
import type { DriveFile } from "../lib/server/google-drive";
import type { FacultyRecord, ImportAttempt } from "../lib/server/types";

const attempt = (
  status: "vigente" | "rechazado",
  validatorVersion?: string,
): ImportAttempt => ({
  attempt: 1,
  validatorVersion,
  status,
  fileName: "PUFAV.xlsx",
  driveFileId: "drive-id",
  driveModifiedAt: "2026-08-11T00:00:00.000Z",
  detectedAt: "2026-08-11T00:00:00.000Z",
  validatedAt: "2026-08-11T00:00:00.000Z",
  sha256: "archivo-sin-cambios",
  recordCount: 10,
  checks: [],
  errors: status === "rechazado" ? ["Error anterior"] : [],
  warnings: [],
});

test("conserva una versión vigente aunque provenga del validador anterior", () => {
  assert.equal(
    shouldSkipDownloadedFile(
      attempt("vigente", "2.1.2"),
      attempt("vigente", "2.1.2"),
      "archivo-sin-cambios",
    ),
    true,
  );
});

test("reprocesa una vez un rechazo creado por el validador anterior", () => {
  assert.equal(
    shouldSkipDownloadedFile(
      undefined,
      attempt("rechazado", "2.1.2"),
      "archivo-sin-cambios",
    ),
    false,
  );
});

test("no repite un rechazo sin cambios del validador actual", () => {
  assert.equal(
    shouldSkipDownloadedFile(
      undefined,
      attempt("rechazado", "2.1.3"),
      "archivo-sin-cambios",
    ),
    true,
  );
});

const driveFile = (overrides: Partial<DriveFile> = {}): DriveFile => ({
  id: "drive-id",
  name: "PUFAV.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  modifiedTime: "2026-08-11T00:00:00.000Z",
  version: "100",
  size: "2048",
  md5Checksum: "md5-contenido-vigente",
  ...overrides,
});

const source = (
  overrides: Partial<FacultyRecord["source"]> = {},
): FacultyRecord["source"] => ({
  expectedFileName: "PUFAV.xlsx",
  ...overrides,
});

test("omite la descarga cuando el contenido binario no cambió", () => {
  const file = driveFile({ version: "101" });
  const marker = driveFileMarker(driveFile({ version: "100" }));
  assert.equal(driveMetadataUnchanged(marker, file), true);
  assert.equal(
    shouldDownloadDriveFile(source({ lastObserved: marker }), file),
    false,
  );
});

test("descarga únicamente cuando cambia la huella MD5", () => {
  const previous = driveFileMarker(driveFile());
  const changed = driveFile({
    version: "101",
    modifiedTime: "2026-08-11T00:01:00.000Z",
    md5Checksum: "md5-contenido-nuevo",
  });
  assert.equal(
    shouldDownloadDriveFile(source({ lastObserved: previous }), changed),
    true,
  );
});

test("detecta el reemplazo por otro archivo aunque conserve el nombre", () => {
  const previous = driveFileMarker(driveFile());
  assert.equal(
    shouldDownloadDriveFile(
      source({ lastObserved: previous }),
      driveFile({ id: "drive-id-reemplazado" }),
    ),
    true,
  );
});

test("reutiliza el historial de v2.3.0 al actualizar sin descargas innecesarias", () => {
  const previousAttempt = attempt("vigente", "2.1.3");
  assert.equal(
    shouldDownloadDriveFile(
      source({ current: previousAttempt, lastAttempt: previousAttempt }),
      driveFile({ version: undefined, size: undefined, md5Checksum: undefined }),
    ),
    false,
  );
});

test("reprocesa un rechazo previo si cambió la versión del validador", () => {
  const rejected = attempt("rechazado", "2.1.2");
  assert.equal(
    shouldDownloadDriveFile(
      source({
        lastAttempt: rejected,
        lastObserved: driveFileMarker(driveFile()),
      }),
      driveFile(),
    ),
    true,
  );
});

test("no vuelve a descargar un rechazo ya evaluado por el validador actual", () => {
  const rejected = attempt("rechazado", "2.1.3");
  assert.equal(
    shouldDownloadDriveFile(
      source({
        lastAttempt: rejected,
        lastObserved: driveFileMarker(driveFile()),
      }),
      driveFile(),
    ),
    false,
  );
});
