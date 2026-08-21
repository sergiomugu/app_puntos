import assert from "node:assert/strict";
import test from "node:test";
import {
  FACULTY_CONTENT_BOTTOM,
  facultyChartLayout,
  facultyChartSeries,
} from "../lib/client/faculty-pdf-layout";

const faculty = {
  color: "#1775b8",
  breakdown: {
    active: { total: 1000, used: 1000, available: 0 },
    license: { total: 300, used: 250, available: 50 },
    free: { total: 200, used: 125, available: 75 },
  },
};

test("organiza Totales, Usados y Disponibles en tres gráficos verticales", () => {
  const charts = facultyChartSeries(faculty);

  assert.deepEqual(charts.map((chart) => chart.title), [
    "Gráfico 1 · Totales",
    "Gráfico 2 · Usados",
    "Gráfico 3 · Disponibles",
  ]);
  assert.deepEqual(charts[2].items.map((item) => item.value), [0, 50, 75]);
});

test("mantiene los tres gráficos dentro de una única página A4", () => {
  const layout = facultyChartLayout(108, 3);

  assert.equal(layout.positions.length, 3);
  assert.ok(layout.positions[0] < layout.positions[1]);
  assert.ok(layout.positions[1] < layout.positions[2]);
  assert.ok(layout.height >= 40);
  assert.ok(layout.bottom <= FACULTY_CONTENT_BOTTOM);
});
