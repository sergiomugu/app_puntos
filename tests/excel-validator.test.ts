import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { extractSummary, validateWorkbook } from "../lib/server/excel-validator";
import type { FacultyConfig } from "../lib/server/types";

const economics: FacultyConfig = {
  codigo: 4,
  id: "eco",
  sigla: "ECO",
  nombre: "Facultad de Ciencias Económicas",
  archivoSugerido: "PUECON.xlsx",
  color: "#1775b8",
  identificadoresContenido: ["ECONOMIC"],
};

async function workbookBuffer(
  available = 114403,
  summaryLabel = "Totales de la Facultad de Cs. Economicas",
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("CUADRO");
  sheet.getCell("A2").value = "FACULTAD DE CIENCIAS ECONOMICAS";
  sheet.getCell("B9").value = summaryLabel;
  sheet.getCell("D9").value = 5380000;
  sheet.getCell("E9").value = 5265597;
  sheet.getCell("F9").value = available;
  sheet.getCell("B10").value = "PUNTOS EN USO";
  sheet.getCell("D10").value = 3843764;
  sheet.getCell("E10").value = 3843764;
  sheet.getCell("F10").value = 0;
  sheet.getCell("B11").value = "PUNTOS DE LICENCIAS";
  sheet.getCell("D11").value = 923690;
  sheet.getCell("E11").value = 852563;
  sheet.getCell("F11").value = 71127;
  sheet.getCell("B12").value = "PUNTOS LIBRES";
  sheet.getCell("D12").value = 612546;
  sheet.getCell("E12").value = 569270;
  sheet.getCell("F12").value = 43276;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test("acepta un CUADRO conciliado de Ciencias Económicas", async () => {
  const result = await validateWorkbook(
    await workbookBuffer(),
    economics,
    10 * 1024 * 1024,
  );
  assert.equal(result.valid, true);
  assert.equal(result.summary?.available, 114403);
  assert.equal(result.summary?.breakdown.license.available, 71127);
  assert.equal(result.errors.length, 0);
});

test("rechaza una diferencia entre total, usados y disponibles", async () => {
  const result = await validateWorkbook(
    await workbookBuffer(999999),
    economics,
    10 * 1024 * 1024,
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("Total = Usados")));
});

test("acepta el rótulo institucional abreviado Totales de la Fac.", async () => {
  const result = await validateWorkbook(
    await workbookBuffer(114403, "Totales de la Fac. de Cs. Economicas"),
    economics,
    10 * 1024 * 1024,
  );

  assert.equal(result.valid, true);
  assert.equal(result.summary?.used, 5265597);
  assert.ok(
    result.checks.some((check) =>
      check.includes("5.380.000 = 5.265.597 + 114.403"),
    ),
  );
});

test("busca el resumen debajo de encabezados con filas intermedias", () => {
  const headings: unknown[] = [];
  headings[1] = "TOTALES";
  headings[3] = "USADOS";
  headings[5] = "DISPONIBLES";
  const totals: unknown[] = [];
  totals[1] = 1000;
  totals[3] = 850;
  totals[5] = 150;

  const summary = extractSummary([
    headings,
    ["Puntos autorizados", 1000],
    [],
    totals,
    ["PUNTOS EN USO", 600, 600, 0],
    ["PUNTOS DE LICENCIAS", 250, 200, 50],
    ["PUNTOS LIBRES", 150, 50, 100],
  ]);

  assert.equal(summary.total, 1000);
  assert.equal(summary.used, 850);
  assert.equal(summary.available, 150);
});
