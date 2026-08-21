import assert from "node:assert/strict";
import test from "node:test";
import { publicDashboard, sessionActivity } from "../lib/server/public-state";
import { createInitialState } from "../lib/server/initial-state";
import type { ImportAttempt } from "../lib/server/types";

const attempt = (number: number): ImportAttempt => ({
  attempt: number,
  status: "vigente",
  fileName: "PUECON.xlsx",
  driveFileId: `drive-${number}`,
  driveModifiedAt: "2026-08-12T00:00:00.000Z",
  detectedAt: "2026-08-12T00:00:00.000Z",
  validatedAt: "2026-08-12T00:00:00.000Z",
  activatedAt: "2026-08-12T00:00:00.000Z",
  sha256: `huella-${number}`,
  recordCount: 10,
  checks: [],
  errors: [],
  warnings: [],
});

test("muestra el último registro inicial y los eventos posteriores de la sesión", () => {
  const history = [attempt(5), attempt(4), attempt(3), attempt(2)];
  assert.deepEqual(
    sessionActivity(history, 3).map((entry) => entry.attempt),
    [5, 4, 3],
  );
});

test("si la sesión comenzó sin registros muestra todas las novedades", () => {
  const history = [attempt(2), attempt(1)];
  assert.deepEqual(
    sessionActivity(history, 0).map((entry) => entry.attempt),
    [2, 1],
  );
});

test("el servidor filtra Facultades antes de responder a un alcance limitado", () => {
  const state = createInitialState();
  const payload = publicDashboard(state, {
    role: "CONSULTA_FACULTAD",
    facultyIds: ["eco"],
  });

  assert.deepEqual(payload.faculties.map((faculty) => faculty.id), ["eco"]);
  assert.deepEqual(payload.drive.warnings, []);
  assert.equal("folderId" in payload.drive, false);
});

test("el alcance institucional recibe las cinco Facultades", () => {
  const payload = publicDashboard(createInitialState(), {
    role: "CONSULTA_GENERAL",
    facultyIds: [],
  });
  assert.equal(payload.faculties.length, 5);
});
