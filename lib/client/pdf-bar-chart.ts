import type { jsPDF } from "jspdf";

const nf = new Intl.NumberFormat("es-AR");

const colorToRgb = (color?: string): [number, number, number] => {
  const normalized = (color ?? "#12345a").replace("#", "");
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
};

export function pdfBarChart(
  doc: jsPDF,
  title: string,
  items: { label: string; value: number; color: string }[],
  x: number,
  y: number,
  width = 182,
  height = 50,
) {
  const max = Math.max(...items.map((item) => item.value), 1);
  doc.setDrawColor(220, 228, 234);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(x, y, width, height, 2, 2, "FD");
  doc.setTextColor(25, 50, 74);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(title, x + 5, y + 7.5);
  items.forEach((item, index) => {
    const rowY = y + 16 + index * ((height - 22) / 2);
    const barX = x + 37;
    const barWidth = width - 78;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(65, 82, 98);
    doc.text(item.label, x + 5, rowY + 1);
    doc.setFillColor(228, 234, 239);
    doc.roundedRect(barX, rowY - 2, barWidth, 4, 1, 1, "F");
    doc.setFillColor(...colorToRgb(item.color));
    if (item.value > 0) {
      doc.roundedRect(barX, rowY - 2, Math.max(1, (barWidth * item.value) / max), 4, 1, 1, "F");
    }
    doc.setTextColor(25, 50, 74);
    doc.setFont("helvetica", "bold");
    doc.text(nf.format(item.value), x + width - 5, rowY + 1, { align: "right" });
  });
}
