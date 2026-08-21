import assert from "node:assert/strict";
import test from "node:test";
import {
  UserStatisticsError,
  parseUserActivityInput,
} from "../lib/server/user-statistics";

test("acepta actividades generales y de Facultad con alcance válido", () => {
  assert.deepEqual(
    parseUserActivityInput({ activityCode: "TABLERO_CONSULTADO" }),
    { activityCode: "TABLERO_CONSULTADO", facultyId: null },
  );
  assert.deepEqual(
    parseUserActivityInput({
      activityCode: "FACULTAD_CONSULTADA",
      facultyId: "eco",
    }),
    { activityCode: "FACULTAD_CONSULTADA", facultyId: "eco" },
  );
});

test("rechaza actividades desconocidas o sin la Facultad requerida", () => {
  assert.throws(
    () => parseUserActivityInput({ activityCode: "ACTIVIDAD_DESCONOCIDA" }),
    UserStatisticsError,
  );
  assert.throws(
    () => parseUserActivityInput({ activityCode: "PDF_FACULTAD_GENERADO" }),
    /requiere identificar una Facultad/,
  );
  assert.throws(
    () => parseUserActivityInput({
      activityCode: "PDF_CONSOLIDADO_GENERADO",
      facultyId: "eco",
    }),
    /no admite una Facultad/,
  );
});
