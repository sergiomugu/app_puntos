import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../lib/server/initial-state";

test("el servidor inicia sin datos demostrativos y toma la carpeta del entorno", () => {
  process.env.PUNTOS_DRIVE_FOLDER_ID = "carpeta-configurada-en-servidor";
  const state = createInitialState();
  assert.equal(state.faculties.length, 5);
  assert.ok(state.faculties.every((faculty) => faculty.status === "pendiente"));
  assert.ok(state.faculties.every((faculty) => faculty.total === 0));
  assert.equal(state.drive.folderId, "carpeta-configurada-en-servidor");
  delete process.env.PUNTOS_DRIVE_FOLDER_ID;
});
