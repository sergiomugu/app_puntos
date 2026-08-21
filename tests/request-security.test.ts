import assert from "node:assert/strict";
import test from "node:test";
import {
  requestContext,
  safeReturnPath,
  sameOriginError,
} from "../lib/server/request-security";

test("acepta mutaciones del origen configurado y rechaza sitios externos", () => {
  process.env.PUNTOS_BASE_URL = "https://puntos-docentes.unrc.edu.ar";
  const allowed = new Request("https://puntos-docentes.unrc.edu.ar/api/admin/users", {
    method: "POST",
    headers: { origin: "https://puntos-docentes.unrc.edu.ar", "sec-fetch-site": "same-origin" },
  });
  const rejected = new Request("https://puntos-docentes.unrc.edu.ar/api/admin/users", {
    method: "POST",
    headers: { origin: "https://sitio-externo.example", "sec-fetch-site": "cross-site" },
  });
  assert.equal(sameOriginError(allowed), undefined);
  assert.equal(sameOriginError(rejected), "La solicitud no proviene del origen autorizado.");
  delete process.env.PUNTOS_BASE_URL;
});

test("impide redirecciones abiertas en el retorno OAuth", () => {
  assert.equal(safeReturnPath("/admin/usuarios"), "/admin/usuarios");
  assert.equal(safeReturnPath("//sitio-externo.example"), "/");
  assert.equal(safeReturnPath("https://sitio-externo.example"), "/");
  assert.equal(safeReturnPath("/ruta\\externa"), "/");
});

test("prioriza la IP verificada por el proxy institucional", () => {
  const request = new Request("https://puntos-docentes.unrc.edu.ar", {
    headers: {
      "x-real-ip": "192.0.2.15",
      "x-forwarded-for": "203.0.113.99, 192.0.2.15",
      "user-agent": "Navegador de prueba",
    },
  });
  const context = requestContext(request);
  assert.equal(context.ipAddress, "192.0.2.15");
  assert.equal(context.userAgent, "Navegador de prueba");
});
