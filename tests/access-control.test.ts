import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccessFaculty,
  hasPermission,
  normalizeFacultyScopes,
  validateRoleScopes,
} from "../lib/server/access-control";

test("reserva la verificación manual para Administrador y Operador DGPFP", () => {
  assert.equal(hasPermission("ADMIN_GENERAL", "sync:manual"), true);
  assert.equal(hasPermission("OPERADOR_DGPFP", "sync:manual"), true);
  assert.equal(hasPermission("CONSULTA_GENERAL", "sync:manual"), false);
  assert.equal(hasPermission("RESPONSABLE_FACULTAD", "sync:manual"), false);
});

test("Consulta General tiene alcance total pero sólo permisos de lectura", () => {
  assert.equal(canAccessFaculty("CONSULTA_GENERAL", [], "eco"), true);
  assert.equal(canAccessFaculty("CONSULTA_GENERAL", [], "hum"), true);
  assert.equal(hasPermission("CONSULTA_GENERAL", "dashboard:read"), true);
  assert.equal(hasPermission("CONSULTA_GENERAL", "history:full"), false);
  assert.equal(hasPermission("CONSULTA_GENERAL", "users:manage"), false);
});

test("los perfiles de Facultad quedan limitados a sus alcances asignados", () => {
  assert.equal(canAccessFaculty("CONSULTA_FACULTAD", ["eco"], "eco"), true);
  assert.equal(canAccessFaculty("CONSULTA_FACULTAD", ["eco"], "hum"), false);
  assert.equal(validateRoleScopes("CONSULTA_FACULTAD", []), "El perfil requiere al menos una Facultad asignada.");
  assert.equal(validateRoleScopes("CONSULTA_GENERAL", ["eco"]), "El perfil tiene alcance institucional y no admite Facultades individuales.");
});

test("normaliza alcances sin duplicados ni identificadores desconocidos", () => {
  assert.deepEqual(normalizeFacultyScopes(["eco", "eco", "hum", "otra", 4]), ["eco", "hum"]);
});
