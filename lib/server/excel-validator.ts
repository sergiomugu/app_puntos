import ExcelJS from "exceljs";
import JSZip from "jszip";
import type {
  Breakdown,
  FacultyConfig,
  Summary,
} from "./types";

type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  checks: string[];
  recordCount: number;
  summary?: Summary;
};

export const VALIDATOR_VERSION = "2.1.3";

const normalize = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

function unbox(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if ("result" in value) return unbox(value.result);
  if ("text" in value && typeof value.text === "string") return value.text;
  if ("richText" in value && Array.isArray(value.richText)) {
    return value.richText
      .map((part: { text?: string }) => part.text ?? "")
      .join("");
  }
  return value;
}

const numeric = (value: unknown) => {
  const unboxed = unbox(value);
  if (typeof unboxed === "number" && Number.isFinite(unboxed)) return unboxed;
  const parsed = Number(
    String(unboxed ?? "")
      .replace(/\s/g, "")
      .replace(/\./g, "")
      .replace(",", "."),
  );
  return Number.isFinite(parsed) ? parsed : 0;
};

function hasNumericValue(value: unknown) {
  const unboxed = unbox(value);
  if (typeof unboxed === "number") return Number.isFinite(unboxed);
  if (typeof unboxed !== "string" || !unboxed.trim()) return false;
  const parsed = Number(
    unboxed
      .replace(/\s/g, "")
      .replace(/\./g, "")
      .replace(",", "."),
  );
  return Number.isFinite(parsed);
}

const isFacultyTotalLabel = (label: string) =>
  label.includes("TOTAL") && /\bFAC(?:ULTAD\b|\.)/.test(label);

const formatPoints = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: 2,
  }).format(value);

export function extractSummary(data: unknown[][]): Summary {
  const result = { total: 0, used: 0, available: 0 };
  const breakdown: Breakdown = {
    active: { total: 0, used: 0, available: 0 },
    license: { total: 0, used: 0, available: 0 },
    free: { total: 0, used: 0, available: 0 },
  };

  for (let rowIndex = 0; rowIndex < data.length; rowIndex += 1) {
    const row = data[rowIndex] ?? [];
    for (let column = 0; column < row.length; column += 1) {
      const label = normalize(unbox(row[column]));
      if (!label) continue;
      const category = label.includes("PUNTOS EN USO")
        ? "active"
        : label.includes("LICENCIA")
          ? "license"
          : label.includes("LIBRES") || label === "LIBRE"
            ? "free"
            : null;

      if (category) {
        const numbers = row
          .slice(column + 1)
          .filter((value) => value !== null && value !== undefined && value !== "")
          .map(numeric);
        if (numbers.length >= 3) {
          [
            breakdown[category].total,
            breakdown[category].used,
            breakdown[category].available,
          ] = numbers.slice(-3);
        }
      }

      // Los libros institucionales usan tanto "Facultad" como la abreviatura
      // "Fac." en el rótulo de la fila resumen.
      if (isFacultyTotalLabel(label)) {
        const numbers = row
          .slice(column + 1)
          .filter((value) => value !== null && value !== undefined && value !== "")
          .map(numeric);
        if (numbers.length >= 3) {
          [result.total, result.used, result.available] = numbers.slice(-3);
        }
      }
    }
  }

  if (!result.total) {
    for (let rowIndex = 0; rowIndex < data.length - 1; rowIndex += 1) {
      // ExcelJS representa algunas filas con posiciones vacías (sparse arrays).
      // Array.prototype.map conserva esos huecos y findIndex entrega undefined
      // al recorrerlos. Array.from densifica la fila antes de buscar rótulos.
      const labels = Array.from(
        data[rowIndex] ?? [],
        (value) => normalize(unbox(value)),
      );
      const totalIndex = labels.findIndex(
        (value) => value === "TOTALES" || value === "TOTAL",
      );
      const usedIndex = labels.findIndex(
        (value) => value.includes("USADOS") || value.includes("OCUPADOS"),
      );
      const availableIndex = labels.findIndex((value) =>
        value.includes("DISPONIBLES"),
      );
      if (totalIndex >= 0 && usedIndex >= 0 && availableIndex >= 0) {
        // El resumen no siempre está inmediatamente debajo de los encabezados:
        // puede haber una fila de puntos autorizados y otra fila en blanco.
        const searchEnd = Math.min(data.length, rowIndex + 7);
        for (
          let candidateIndex = rowIndex + 1;
          candidateIndex < searchEnd;
          candidateIndex += 1
        ) {
          const candidate = data[candidateIndex] ?? [];
          if (
            hasNumericValue(candidate[totalIndex]) &&
            hasNumericValue(candidate[usedIndex]) &&
            hasNumericValue(candidate[availableIndex])
          ) {
            result.total = numeric(candidate[totalIndex]);
            result.used = numeric(candidate[usedIndex]);
            result.available = numeric(candidate[availableIndex]);
            break;
          }
        }
      }
    }
  }

  return { ...result, breakdown };
}

async function inspectContainer(buffer: Buffer) {
  const errors: string[] = [];
  if (buffer.length < 4 || buffer.subarray(0, 2).toString("hex") !== "504b") {
    return ["El contenido no corresponde a un archivo .xlsx válido."];
  }
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files);
  const forbidden = [
    /(^|\/)vbaProject\.bin$/i,
    /^xl\/externalLinks\//i,
    /^xl\/embeddings\//i,
    /^xl\/activeX\//i,
  ];
  if (names.some((name) => forbidden.some((pattern) => pattern.test(name)))) {
    errors.push(
      "El libro contiene macros, vínculos externos u objetos incrustados no admitidos.",
    );
  }
  return errors;
}

const closeEnough = (left: number, right: number) =>
  Math.abs(left - right) <= 1;

export async function validateWorkbook(
  buffer: Buffer,
  faculty: FacultyConfig,
  maximumBytes: number,
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: string[] = [];

  if (buffer.length > maximumBytes) {
    errors.push(
      `El archivo supera el máximo permitido de ${Math.round(maximumBytes / 1024 / 1024)} MB.`,
    );
  } else {
    checks.push("Tamaño del archivo dentro del límite permitido");
  }

  try {
    errors.push(...(await inspectContainer(buffer)));
    if (!errors.length) checks.push("Contenedor .xlsx sin contenido ejecutable");
  } catch {
    errors.push("La estructura interna del archivo .xlsx está dañada.");
  }
  if (errors.length) {
    return { valid: false, errors, warnings, checks, recordCount: 0 };
  }

  const workbook = new ExcelJS.Workbook();
  try {
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    await workbook.xlsx.load(arrayBuffer);
  } catch {
    return {
      valid: false,
      errors: ["Excel no pudo interpretar el contenido del archivo."],
      warnings,
      checks,
      recordCount: 0,
    };
  }

  const worksheet = workbook.getWorksheet("CUADRO");
  if (!worksheet) {
    return {
      valid: false,
      errors: ["No se encontró la hoja obligatoria CUADRO."],
      warnings,
      checks,
      recordCount: 0,
    };
  }
  checks.push("Hoja CUADRO identificada");

  const rows: unknown[][] = [];
  let recordCount = 0;
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const values = Array.isArray(row.values)
      ? Array.from(row.values).slice(1)
      : [];
    rows.push(values);
    if (values.some((value) => normalize(unbox(value)))) recordCount += 1;
  });

  const text = normalize(rows.flat().map(unbox).join(" "));
  const contentIdentifiers = Array.isArray(faculty.identificadoresContenido)
    ? faculty.identificadoresContenido.filter(
        (keyword): keyword is string => typeof keyword === "string" && Boolean(keyword.trim()),
      )
    : [];
  if (
    contentIdentifiers.length &&
    !contentIdentifiers.some((keyword) =>
      text.includes(normalize(keyword)),
    )
  ) {
    errors.push(
      `El contenido de CUADRO no permite confirmar que corresponda a ${faculty.nombre}.`,
    );
  } else {
    checks.push("Facultad confirmada por el contenido del libro");
  }

  const summary = extractSummary(rows);
  const numbers = [
    summary.total,
    summary.used,
    summary.available,
    summary.breakdown.active.total,
    summary.breakdown.active.used,
    summary.breakdown.active.available,
    summary.breakdown.license.total,
    summary.breakdown.license.used,
    summary.breakdown.license.available,
    summary.breakdown.free.total,
    summary.breakdown.free.used,
    summary.breakdown.free.available,
  ];

  if (!summary.total || numbers.some((value) => value < 0)) {
    errors.push("Los valores de puntos están vacíos, son cero o contienen negativos.");
  } else {
    checks.push("Valores numéricos reconocidos y no negativos");
  }

  if (!closeEnough(summary.total, summary.used + summary.available)) {
    errors.push(
      `No se cumple Total = Usados + Disponibles: ${formatPoints(summary.total)} ≠ ${formatPoints(summary.used)} + ${formatPoints(summary.available)} (diferencia ${formatPoints(summary.total - summary.used - summary.available)}).`,
    );
  } else {
    checks.push(
      `Conciliación Total = Usados + Disponibles: ${formatPoints(summary.total)} = ${formatPoints(summary.used)} + ${formatPoints(summary.available)}`,
    );
  }

  const breakdownTotal =
    summary.breakdown.active.total +
    summary.breakdown.license.total +
    summary.breakdown.free.total;
  const breakdownUsed =
    summary.breakdown.active.used +
    summary.breakdown.license.used +
    summary.breakdown.free.used;
  const breakdownAvailable =
    summary.breakdown.active.available +
    summary.breakdown.license.available +
    summary.breakdown.free.available;

  if (
    !closeEnough(summary.total, breakdownTotal) ||
    !closeEnough(summary.used, breakdownUsed) ||
    !closeEnough(summary.available, breakdownAvailable)
  ) {
    errors.push(
      `El detalle En uso + Licencias + Libres no coincide con el total de la Facultad. Total: ${formatPoints(summary.total)} frente a ${formatPoints(breakdownTotal)}; usados: ${formatPoints(summary.used)} frente a ${formatPoints(breakdownUsed)}; disponibles: ${formatPoints(summary.available)} frente a ${formatPoints(breakdownAvailable)}.`,
    );
  } else {
    checks.push(
      `Desglose conciliado. Total: ${formatPoints(summary.total)}; usados: ${formatPoints(summary.used)}; disponibles: ${formatPoints(summary.available)}`,
    );
  }

  if (recordCount < 4) {
    warnings.push("La hoja CUADRO contiene menos filas informativas de las esperadas.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    checks,
    recordCount,
    summary,
  };
}
