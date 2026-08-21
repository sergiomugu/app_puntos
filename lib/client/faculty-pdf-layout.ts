type BreakdownItem = { total: number; used: number; available: number };

export type FacultyChartSource = {
  color: string;
  breakdown: {
    active: BreakdownItem;
    license: BreakdownItem;
    free: BreakdownItem;
  };
};

export type FacultyChartSeries = {
  title: string;
  items: { label: string; value: number; color: string }[];
};

export const FACULTY_CHART_WIDTH = 182;
export const FACULTY_CHART_GAP = 4;
export const FACULTY_CHART_MAX_HEIGHT = 50;
export const FACULTY_CONTENT_BOTTOM = 278;

export function facultyChartSeries(faculty: FacultyChartSource): FacultyChartSeries[] {
  const categories = [
    { label: "En uso", item: faculty.breakdown.active, color: faculty.color },
    { label: "De licencia", item: faculty.breakdown.license, color: "#d6a03b" },
    { label: "Libres", item: faculty.breakdown.free, color: "#35a677" },
  ];
  const measures = [
    { title: "Gráfico 1 · Totales", key: "total" },
    { title: "Gráfico 2 · Usados", key: "used" },
    { title: "Gráfico 3 · Disponibles", key: "available" },
  ] as const;

  return measures.map((measure) => ({
    title: measure.title,
    items: categories.map((category) => ({
      label: category.label,
      value: category.item[measure.key],
      color: category.color,
    })),
  }));
}

export function facultyChartLayout(tableEnd: number, chartCount = 3) {
  const gapsHeight = FACULTY_CHART_GAP * Math.max(0, chartCount - 1);
  const availableHeight = Math.max(0, FACULTY_CONTENT_BOTTOM - tableEnd - gapsHeight);
  const height = Math.min(FACULTY_CHART_MAX_HEIGHT, availableHeight / chartCount);
  const positions = Array.from(
    { length: chartCount },
    (_, index) => tableEnd + index * (height + FACULTY_CHART_GAP),
  );

  return {
    height,
    positions,
    bottom: positions.length ? positions.at(-1)! + height : tableEnd,
  };
}
