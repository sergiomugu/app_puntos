"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Image from "next/image";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  FACULTY_CHART_WIDTH,
  facultyChartLayout,
  facultyChartSeries,
} from "@/lib/client/faculty-pdf-layout";
import { pdfBarChart } from "@/lib/client/pdf-bar-chart";
import { publishPdfBlob, reservePdfWindow } from "@/lib/client/pdf-window";

type ImportAttempt = {
  attempt: number;
  status: "vigente" | "rechazado";
  fileName: string;
  driveModifiedAt: string;
  detectedAt: string;
  validatedAt: string;
  activatedAt?: string;
  sha256: string;
  recordCount: number;
  checks: string[];
  errors: string[];
  warnings: string[];
};

type Faculty = {
  id: string;
  code: number;
  name: string;
  short: string;
  color: string;
  total: number;
  used: number;
  available: number;
  breakdown: Breakdown;
  loadedAt?: string;
  fileName?: string;
  status: "vigente" | "pendiente" | "observado";
  note?: string;
  source?: {
    expectedFileName: string;
    current?: ImportAttempt;
    lastAttempt?: ImportAttempt;
  };
};

type DriveStatus = {
  configured: boolean;
  folderId: string;
  intervalSeconds: number;
  lastSyncAt?: string;
  status: "pendiente" | "correcto" | "advertencia" | "error";
  message: string;
  warnings: string[];
};

type DashboardResponse = {
  updatedAt: string;
  faculties: Faculty[];
  drive: DriveStatus;
};

type AuthResponse = {
  authenticated: boolean;
  user?: {
    id: string;
    email: string;
    displayName: string;
    role: string;
    roleLabel: string;
    protectedPrincipal: boolean;
    facultyIds: string[];
  };
  permissions?: string[];
  csrfToken?: string;
  reauthFresh?: boolean;
  absoluteExpiresAt?: string;
};

type BreakdownItem = { total: number; used: number; available: number };
type Breakdown = {
  active: BreakdownItem;
  license: BreakdownItem;
  free: BreakdownItem;
};

type SortKey =
  | "code"
  | "name"
  | "total"
  | "used"
  | "available"
  | "licenseAvailable"
  | "freeAvailable"
  | "usage"
  | "loadedAt";
type SortDirection = "asc" | "desc";
type HistoryScope = "activity" | "full";

const emptyBreakdown = (): Breakdown => ({
  active: { total: 0, used: 0, available: 0 },
  license: { total: 0, used: 0, available: 0 },
  free: { total: 0, used: 0, available: 0 },
});

const initial: Faculty[] = [
  [1, "ayv", "Facultad de Agronomía y Veterinaria", "AyV", "#318457", "PUFAV.xlsx"],
  [2, "exa", "Facultad de Ciencias Exactas Fco. Qcas. y Naturales", "EXA", "#7652a6", "PUEXA.xlsx"],
  [3, "ing", "Facultad de Ingeniería", "ING", "#d56a18", "PUINGE.xlsx"],
  [4, "eco", "Facultad de Ciencias Económicas", "ECO", "#1775b8", "PUECON.xlsx"],
  [5, "hum", "Facultad de Ciencias Humanas", "HUM", "#b53a63", "PUHUM.xlsx"],
].map(([code, id, name, short, color, expectedFileName]) => ({
  code: code as number,
  id: id as string,
  name: name as string,
  short: short as string,
  color: color as string,
  total: 0,
  used: 0,
  available: 0,
  breakdown: emptyBreakdown(),
  status: "pendiente" as const,
  source: { expectedFileName: expectedFileName as string },
}));

const nf = new Intl.NumberFormat("es-AR");
const df = { format: (value: string) => value.replace("|", ", ") };

const formatIso = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("es-AR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";

class RequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function requestJson<T>(
  input: string,
  init: RequestInit = {},
  timeoutMilliseconds = 120_000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMilliseconds);
  try {
    const response = await fetch(input, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as
      | (T & { error?: string })
      | null;
    if (!response.ok) {
      throw new RequestError(
        payload?.error ||
          `El servidor rechazó la consulta (código ${response.status}).`,
        response.status,
      );
    }
    if (!payload) throw new Error("El servidor devolvió una respuesta vacía.");
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        "La verificación superó los dos minutos. Revise la conexión a Internet o la ventana del servidor.",
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function SystemIcon({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`systemIcon ${compact ? "compact" : ""}`}>
      <Image
        src="/icono-unrc-pd.png"
        alt="Identidad visual de la Universidad Nacional de Río Cuarto"
        width={1122}
        height={1402}
        priority={!compact}
      />
    </span>
  );
}

export default function Home() {
  const [authenticated, setAuthenticated] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthResponse["user"]>();
  const [permissions, setPermissions] = useState<string[]>([]);
  const [csrfToken, setCsrfToken] = useState("");
  const [loginError, setLoginError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string>();
  const [faculties, setFaculties] = useState(initial);
  const [sort, setSort] = useState<{
    key: SortKey | null;
    direction: SortDirection;
  }>({ key: null, direction: "asc" });
  const [reportId, setReportId] = useState<string | null>(null);
  const [drive, setDrive] = useState<DriveStatus>({
    configured: false,
    folderId: "",
    intervalSeconds: 60,
    status: "pendiente",
    message: "Conectando con Google Drive…",
    warnings: [],
  });
  const [refreshing, setRefreshing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [historyFacultyId, setHistoryFacultyId] = useState<string | null>(null);
  const [history, setHistory] = useState<ImportAttempt[]>([]);
  const [historyScope, setHistoryScope] = useState<HistoryScope>("activity");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [retainedHistoryRecords, setRetainedHistoryRecords] = useState(0);
  const [sessionBaselineDisplay, setSessionBaselineDisplay] = useState<Record<string, number>>({});
  const sessionBaselineAttempts = useRef<Record<string, number>>({});
  const sessionBaselineReady = useRef(false);
  const dashboardActivityRecorded = useRef(false);

  const recordActivity = useCallback((
    activityCode:
      | "TABLERO_CONSULTADO"
      | "FACULTAD_CONSULTADA"
      | "HISTORIAL_FACULTAD_CONSULTADO"
      | "PDF_FACULTAD_GENERADO"
      | "PDF_CONSOLIDADO_GENERADO",
    facultyId?: string,
  ) => {
    if (!csrfToken) return;
    void requestJson("/api/activity", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ activityCode, facultyId }),
    }, 10_000).catch(() => undefined);
  }, [csrfToken]);

  useEffect(() => {
    let active = true;
    void requestJson<AuthResponse>("/api/auth/session")
      .then((session) => {
        if (!active) return;
        setAuthenticated(session.authenticated);
        setCurrentUser(session.user);
        setPermissions(session.permissions ?? []);
        setCsrfToken(session.csrfToken ?? "");
        const errorCode = new URL(window.location.href).searchParams.get("authError");
        if (errorCode) {
          setLoginError(
            errorCode === "sesion_vencida"
              ? "La sesión venció. Ingrese nuevamente."
              : "La cuenta institucional no está autorizada o no superó la verificación de seguridad.",
          );
          window.history.replaceState({}, "", window.location.pathname);
        }
      })
      .catch(() => {
        if (active) setAuthenticated(false);
      })
      .finally(() => {
        if (active) setAuthReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const refreshDashboard = useCallback(async (force: boolean) => {
    if (force) {
      setRefreshing(true);
      setSyncMessage("");
    }
    try {
      const payload = await requestJson<DashboardResponse>(
        force ? "/api/sync" : "/api/facultades",
        {
        method: force ? "POST" : "GET",
        headers: force ? { "X-CSRF-Token": csrfToken } : undefined,
        },
      );
      if (Array.isArray(payload.faculties)) {
        if (!sessionBaselineReady.current) {
          const baseline = Object.fromEntries(
            payload.faculties.map((faculty) => [
              faculty.id,
              faculty.source?.lastAttempt?.attempt ?? 0,
            ]),
          );
          sessionBaselineAttempts.current = baseline;
          setSessionBaselineDisplay(baseline);
          sessionBaselineReady.current = true;
        }
        setFaculties(payload.faculties);
      }
      if (payload.drive) setDrive(payload.drive);
      if (payload.updatedAt) setUpdatedAt(payload.updatedAt);
      if (force) setSyncMessage(payload.drive.message);
    } catch (error) {
      if (error instanceof RequestError && error.status === 401) {
        setAuthenticated(false);
        setCurrentUser(undefined);
        setPermissions([]);
        setCsrfToken("");
        setLoginError("La sesión venció. Ingrese nuevamente.");
        return;
      }
      const message = error instanceof Error
          ? error.message
          : "No se pudo actualizar el tablero.";
      setSyncMessage(message);
      setDrive((current) => ({ ...current, status: "error", message }));
    } finally {
      if (force) setRefreshing(false);
    }
  }, [csrfToken]);

  useEffect(() => {
    if (!authenticated) return;
    const initial = window.setTimeout(() => {
      void refreshDashboard(false);
    }, 0);
    const timer = window.setInterval(() => {
      void refreshDashboard(false);
    }, 15_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [authenticated, refreshDashboard]);

  useEffect(() => {
    if (!authenticated || !csrfToken || dashboardActivityRecorded.current) return;
    dashboardActivityRecorded.current = true;
    recordActivity("TABLERO_CONSULTADO");
  }, [authenticated, csrfToken, recordActivity]);

  function openActivity(facultyId: string) {
    if (historyFacultyId === facultyId) {
      setHistoryFacultyId(null);
      setHistory([]);
      return;
    }
    recordActivity("HISTORIAL_FACULTAD_CONSULTADO", facultyId);
    setHistory([]);
    setHistoryScope("activity");
    setHistoryFacultyId(facultyId);
  }

  useEffect(() => {
    if (!authenticated || !historyFacultyId || !sessionBaselineReady.current) {
      return;
    }
    const facultyId = historyFacultyId;
    const baseline = sessionBaselineAttempts.current[facultyId] ?? 0;
    let active = true;
    setHistoryLoading(true);
    const query = historyScope === "full"
      ? "scope=full"
      : `scope=activity&sinceAttempt=${baseline}`;
    void requestJson<{
      imports: ImportAttempt[];
      retainedRecords: number;
    }>(
      `/api/facultades/${encodeURIComponent(facultyId)}/importaciones?${query}`,
      {},
    ).then((payload) => {
      if (!active) return;
      setHistory(payload.imports ?? []);
      setRetainedHistoryRecords(payload.retainedRecords ?? 0);
    }).catch((error) => {
      if (!active) return;
      if (error instanceof RequestError && error.status === 401) {
        setAuthenticated(false);
        setCurrentUser(undefined);
        setPermissions([]);
        setCsrfToken("");
        setLoginError("La sesión venció. Ingrese nuevamente.");
        return;
      }
      setSyncMessage(
        error instanceof Error ? error.message : "No se pudo recuperar la actividad.",
      );
    }).finally(() => {
      if (active) setHistoryLoading(false);
    });
    return () => {
      active = false;
    };
  }, [authenticated, historyFacultyId, historyScope, faculties]);

  function closeHistory() {
    setHistoryFacultyId(null);
    setHistory([]);
    setHistoryScope("activity");
  }

  function toggleHistoryScope() {
    setHistory([]);
    setHistoryScope((current) => current === "activity" ? "full" : "activity");
  }

  async function logout() {
    await requestJson<AuthResponse>("/api/auth/logout", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
    }).catch(
      () => undefined,
    );
    setAuthenticated(false);
    setCurrentUser(undefined);
    setPermissions([]);
    setCsrfToken("");
    setReportId(null);
    closeHistory();
    sessionBaselineAttempts.current = {};
    setSessionBaselineDisplay({});
    sessionBaselineReady.current = false;
    dashboardActivityRecorded.current = false;
  }
  const can = (permission: string) => permissions.includes(permission);
  const totals = useMemo(
    () =>
      faculties.reduce(
        (a, f) => ({
          total: a.total + f.total,
          used: a.used + f.used,
          available: a.available + f.available,
          licenseAvailable: a.licenseAvailable + f.breakdown.license.available,
          freeAvailable: a.freeAvailable + f.breakdown.free.available,
        }),
        { total: 0, used: 0, available: 0, licenseAvailable: 0, freeAvailable: 0 },
      ),
    [faculties],
  );
  const percentage = totals.total ? (totals.used / totals.total) * 100 : 0;
  const report = faculties.find((f) => f.id === reportId);
  const sortedFaculties = useMemo(() => {
    if (!sort.key) return faculties;
    const dateValue = (value?: string) => {
      if (!value) return 0;
      const [date, time = "00:00"] = value.split("|");
      const [day, month, year] = date.split("/").map(Number);
      const [hour, minute] = time.split(":").map(Number);
      return new Date(year, month - 1, day, hour, minute).getTime();
    };
    const value = (f: Faculty) => {
      switch (sort.key) {
        case "name":
          return f.name;
        case "code":
          return f.code;
        case "usage":
          return f.total ? f.used / f.total : 0;
        case "loadedAt":
          return dateValue(f.loadedAt);
        case "total":
        case "used":
        case "available":
          return f[sort.key];
        case "licenseAvailable":
          return f.breakdown.license.available;
        case "freeAvailable":
          return f.breakdown.free.available;
        default:
          return 0;
      }
    };
    return [...faculties].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      const comparison =
        typeof av === "string" && typeof bv === "string"
          ? av.localeCompare(bv, "es", { sensitivity: "base" })
          : Number(av) - Number(bv);
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [faculties, sort]);

  function changeSort(key: SortKey) {
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  function sortHeader(key: SortKey, label: string) {
    const active = sort.key === key;
    const directionLabel =
      active && sort.direction === "asc" ? "ascendente" : "descendente";
    return (
      <button
        className={`sortButton ${active ? "active" : ""}`}
        onClick={() => changeSort(key)}
        aria-label={`Ordenar ${label} en forma ${directionLabel}`}
      >
        <span>{label}</span>
        <b aria-hidden="true">
          {active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}
        </b>
      </button>
    );
  }

  function openReport(id: string) {
    recordActivity("FACULTAD_CONSULTADA", id);
    setReportId(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function colorToRgb(color = "#12345a"): [number, number, number] {
    const hex = color.replace("#", "");
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }

  function pdfHeader(doc: jsPDF, title: string, subtitle: string, color?: string) {
    doc.setFillColor(...colorToRgb(color));
    doc.rect(0, 0, 210, 31, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("UNRC · Control de Puntos Docentes", 14, 13);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(title, 14, 22);
    doc.setTextColor(25, 50, 74);
    doc.setFontSize(9);
    doc.text(subtitle, 14, 38);
  }

  function pdfFooter(doc: jsPDF) {
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
      doc.setPage(page);
      doc.setDrawColor(220, 228, 234);
      doc.line(14, 284, 196, 284);
      doc.setTextColor(111, 129, 144);
      doc.setFontSize(8);
      doc.text("Dirección General de Programación Financiera y Presupuestaria · UNRC", 14, 290);
      doc.text(`Página ${page} de ${pages}`, 196, 290, { align: "right" });
    }
  }

  function facultyPdf(doc: jsPDF, faculty: Faculty, startY = 45) {
    const usage = faculty.total ? (faculty.used / faculty.total) * 100 : 0;
    const accent = colorToRgb(faculty.color);
    doc.setTextColor(25, 50, 74);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text(faculty.name, 14, startY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(
      `Código UNRC ${faculty.code} · Estado: ${faculty.status.toUpperCase()} · Carga: ${faculty.loadedAt ? df.format(faculty.loadedAt) : "sin registrar"}`,
      14,
      startY + 7,
    );
    doc.text(`Archivo de origen: ${faculty.fileName ?? "sin archivo vigente"}`, 14, startY + 13);
    autoTable(doc, {
      startY: startY + 19,
      head: [["Concepto", "Totales", "Usados", "Disponibles", "Nivel de uso"]],
      body: [
        ["En uso", nf.format(faculty.breakdown.active.total), nf.format(faculty.breakdown.active.used), nf.format(faculty.breakdown.active.available), "100,0%"],
        ["De licencia", nf.format(faculty.breakdown.license.total), nf.format(faculty.breakdown.license.used), nf.format(faculty.breakdown.license.available), `${(faculty.breakdown.license.total ? faculty.breakdown.license.used / faculty.breakdown.license.total * 100 : 0).toFixed(1).replace(".", ",")}%`],
        ["Libres", nf.format(faculty.breakdown.free.total), nf.format(faculty.breakdown.free.used), nf.format(faculty.breakdown.free.available), `${(faculty.breakdown.free.total ? faculty.breakdown.free.used / faculty.breakdown.free.total * 100 : 0).toFixed(1).replace(".", ",")}%`],
      ],
      foot: [["TOTAL FACULTAD", nf.format(faculty.total), nf.format(faculty.used), nf.format(faculty.available), `${usage.toFixed(1).replace(".", ",")}%`]],
      theme: "grid",
      headStyles: { fillColor: accent, halign: "right" },
      footStyles: { fillColor: accent, textColor: [255, 255, 255], fontStyle: "bold", halign: "right" },
      columnStyles: {
        0: { halign: "left", cellWidth: 48 },
        1: { halign: "right" },
        2: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "right" },
      },
      styles: { fontSize: 9, cellPadding: 3 },
    });
    const tableEnd = ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? startY + 72) + 6;
    const charts = facultyChartSeries(faculty);
    const chartLayout = facultyChartLayout(tableEnd, charts.length);

    charts.forEach((chart, index) => {
      pdfBarChart(
        doc,
        chart.title,
        chart.items,
        14,
        chartLayout.positions[index],
        FACULTY_CHART_WIDTH,
        chartLayout.height,
      );
    });
  }

  function generateFacultyPdf(faculty: Faculty) {
    recordActivity("PDF_FACULTAD_GENERADO", faculty.id);
    const pdfWindow = reservePdfWindow();
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    pdfHeader(doc, "Informe detallado por Facultad", `Emitido el ${new Date().toLocaleString("es-AR")}`, faculty.color);
    facultyPdf(doc, faculty);
    pdfFooter(doc);
    publishPdfBlob(doc.output("blob"), pdfWindow, `Informe_${faculty.short}_Puntos_Docentes.pdf`);
  }

  function generateConsolidatedPdf() {
    recordActivity("PDF_CONSOLIDADO_GENERADO");
    const pdfWindow = reservePdfWindow();
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    pdfHeader(doc, "Informe consolidado de las Facultades", `Emitido el ${new Date().toLocaleString("es-AR")}`);
    autoTable(doc, {
      startY: 46,
      head: [["Cód.", "Facultad", "Totales", "Usados", "Disp. licencia", "Disp. libres", "Disp. total"]],
      body: faculties
        .slice()
        .sort((a, b) => a.code - b.code)
        .map((f) => [f.code, f.name.replace("Facultad de ", ""), nf.format(f.total), nf.format(f.used), nf.format(f.breakdown.license.available), nf.format(f.breakdown.free.available), nf.format(f.available)]),
      foot: [["", "TOTAL GENERAL", nf.format(totals.total), nf.format(totals.used), nf.format(totals.licenseAvailable), nf.format(totals.freeAvailable), nf.format(totals.available)]],
      theme: "grid",
      headStyles: { fillColor: [18, 52, 90], halign: "right", fontSize: 8 },
      footStyles: { fillColor: [238, 244, 248], textColor: [18, 52, 90], fontStyle: "bold", halign: "right" },
      columnStyles: { 0: { halign: "center", cellWidth: 10 }, 1: { halign: "left", cellWidth: 50 }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } },
      styles: { fontSize: 8, cellPadding: 2.5 },
    });
    faculties.slice().sort((a, b) => a.code - b.code).forEach((faculty) => {
      doc.addPage();
      pdfHeader(doc, "Detalle individual incluido en el consolidado", `Emitido el ${new Date().toLocaleString("es-AR")}`, faculty.color);
      facultyPdf(doc, faculty);
    });
    pdfFooter(doc);
    publishPdfBlob(doc.output("blob"), pdfWindow, "Informe_Consolidado_Puntos_Docentes_UNRC.pdf");
  }

  if (!authReady) return null;

  if (!authenticated) {
    return (
      <main className="loginPage">
        <section className="loginBrand">
          <div className="loginInstitution">
            <SystemIcon />
            <div>
              <strong>UNRC</strong>
              <small>Secretaría Económica</small>
            </div>
          </div>
          <div className="loginIntro">
            <p className="eyebrow">SISTEMA INSTITUCIONAL</p>
            <h1>Control de<br />Puntos Docentes</h1>
            <p>Información consolidada para la gestión y el seguimiento presupuestario de las Facultades.</p>
          </div>
          <p className="loginOffice">Universidad Nacional de Río Cuarto · Dirección General de Programación Financiera y Presupuestaria</p>
        </section>
        <section className="loginAccess">
          <section className="loginCard">
            <div className="loginCardHead">
              <span>Acceso institucional restringido</span>
              <h2>Ingresar al sistema</h2>
              <p>Identifíquese con su cuenta de Google Workspace de la UNRC. El acceso sólo se habilita si fue autorizado previamente.</p>
            </div>
            {loginError && <p className="loginError" role="alert">{loginError}</p>}
            <a className="loginButton googleLoginButton" href="/api/auth/google/start">
              <span aria-hidden="true">G</span>
              Ingresar con cuenta institucional
            </a>
            <div className="demoNotice">
              <strong>Seguridad institucional</strong>
              <span>El sistema no recibe ni almacena su contraseña. Google confirma la identidad y el servidor aplica el perfil y alcance autorizado.</span>
            </div>
          </section>
          <p className="loginHelp">¿Problemas para ingresar? Contacte a la administración del sistema.</p>
        </section>
      </main>
    );
  }

  if (report) {
    const usage = report.total ? (report.used / report.total) * 100 : 0;
    const availability = report.total
      ? (report.available / report.total) * 100
      : 0;
    const reconciled =
      Math.abs(report.total - report.used - report.available) <= 1;
    return (
      <main>
        <header className="topbar">
          <div className="brand">
            <SystemIcon compact />
            <div>
              <strong>UNRC</strong>
              <small>Programación Financiera y Presupuestaria</small>
            </div>
          </div>
          <div className="topActions">
            <button className="backTop" onClick={() => setReportId(null)}>← Volver al tablero</button>
            <button className="logoutButton" onClick={() => void logout()}>Cerrar sesión</button>
          </div>
        </header>
        <section className="reportHero" style={{ "--faculty": report.color } as CSSProperties}>
          <div className="reportHeroTop">
            <div>
              <button className="crumb" onClick={() => setReportId(null)}>
                Tablero general
              </button>
              <span> / Informe por Facultad</span>
            </div>
            <button className="facultyPdfButton" onClick={() => generateFacultyPdf(report)}>
              Generar PDF
            </button>
          </div>
          <div className="reportTitle">
            <b className="reportAvatar" style={{ background: report.color }}>{report.short}</b>
            <div>
              <p className="eyebrow">INFORME DETALLADO</p>
              <h1>{report.name}</h1>
              <span className="facultyCode">Código UNRC {report.code}</span>
              <p>
                Situación de puntos docentes según la última información
                incorporada.
              </p>
            </div>
          </div>
          <div className="reportMeta">
            <span>
              <small>ESTADO</small>
              <b className={`badge ${report.status}`}>
                {report.status === "vigente"
                  ? "✓ Vigente"
                  : report.status === "observado"
                    ? "! Observado"
                    : "Pendiente"}
              </b>
            </span>
            <span>
              <small>FECHA DE CARGA</small>
              <strong>
                {report.loadedAt
                  ? df.format(report.loadedAt)
                  : "Sin carga registrada"}
              </strong>
            </span>
            <span>
              <small>ARCHIVO DE ORIGEN</small>
              <strong>{report.fileName ?? "Sin archivo vigente"}</strong>
            </span>
          </div>
        </section>
        <section className="metrics reportMetrics">
          <article>
            <span>PUNTOS TOTALES</span>
            <strong>{nf.format(report.total)}</strong>
            <small>Cupo autorizado de la Facultad</small>
          </article>
          <article>
            <span>PUNTOS USADOS</span>
            <strong>{nf.format(report.used)}</strong>
            <small>{usage.toFixed(2).replace(".", ",")}% del cupo total</small>
          </article>
          <article className="available">
            <span>PUNTOS DISPONIBLES</span>
            <strong>{nf.format(report.available)}</strong>
            <small>
              {availability.toFixed(2).replace(".", ",")}% de disponibilidad
            </small>
          </article>
          <article>
            <span>CONTROL MATEMÁTICO</span>
            <strong className={reconciled ? "okText" : "warnText"}>
              {reconciled ? "Conciliado" : "Revisar"}
            </strong>
            <small>Total = usados + disponibles</small>
          </article>
        </section>
        <section className="panel breakdownPanel" style={{ "--faculty": report.color } as CSSProperties}>
          <div className="panelHead">
            <div>
              <h2>Detalle por origen y situación</h2>
              <p>Desglose de los puntos en uso permanente, de licencia y libres.</p>
            </div>
          </div>
          <div className="tableWrap">
            <table className="breakdownTable">
              <thead><tr><th>CONCEPTO</th><th className="numeric">TOTALES</th><th className="numeric">USADOS</th><th className="numeric">DISPONIBLES</th><th className="numeric">NIVEL DE USO</th></tr></thead>
              <tbody>
                {([
                  ["En uso", report.breakdown.active],
                  ["De licencia", report.breakdown.license],
                  ["Libres", report.breakdown.free],
                ] as [string, BreakdownItem][]).map(([label, item]) => {
                  const level = item.total ? (item.used / item.total) * 100 : 0;
                  return <tr key={label}>
                    <td><i className="categoryDot" /> <strong>{label}</strong></td>
                    <td className="numeric">{nf.format(item.total)}</td>
                    <td className="numeric">{nf.format(item.used)}</td>
                    <td className="numeric green">{nf.format(item.available)}</td>
                    <td className="numeric"><div className="usage"><span><i style={{ width: `${level}%`, background: report.color }} /></span><b>{level.toFixed(1).replace(".", ",")}%</b></div></td>
                  </tr>;
                })}
              </tbody>
              <tfoot><tr><th>TOTAL FACULTAD</th><th className="numeric">{nf.format(report.total)}</th><th className="numeric">{nf.format(report.used)}</th><th className="numeric">{nf.format(report.available)}</th><th className="numeric">{usage.toFixed(1).replace(".", ",")}%</th></tr></tfoot>
            </table>
          </div>
        </section>
        <section className="reportGrid">
          <article className="panel reportPanel">
            <div className="panelHead">
              <div>
                <h2>Composición del cupo</h2>
                <p>
                  Distribución entre puntos actualmente usados y disponibles.
                </p>
              </div>
            </div>
            <div className="composition">
              <div
                className="donut"
                style={{
                  background: `conic-gradient(${report.color} 0 ${usage}%, #35a677 ${usage}% 100%)`,
                }}
              >
                <span>
                  <b>{usage.toFixed(1).replace(".", ",")}%</b>
                  <small>en uso</small>
                </span>
              </div>
              <div className="compLegend">
                <p>
                  <i style={{ background: report.color }} />
                  <span>Puntos usados</span>
                  <strong>{nf.format(report.used)}</strong>
                </p>
                <p>
                  <i className="freeDot" />
                  <span>Puntos disponibles</span>
                  <strong>{nf.format(report.available)}</strong>
                </p>
                <hr />
                <p className="totalLine">
                  <span>Total Facultad</span>
                  <strong>{nf.format(report.total)}</strong>
                </p>
              </div>
            </div>
          </article>
          <article className="panel reportPanel">
            <div className="panelHead">
              <div>
                <h2>Control de la información</h2>
                <p>Trazabilidad y validaciones de la carga vigente.</p>
              </div>
            </div>
            <div className="checks">
              <p>
                <b>✓</b>
                <span>
                  <strong>Hoja de origen identificada</strong>
                  <small>La lectura corresponde a la hoja CUADRO.</small>
                </span>
              </p>
              <p>
                <b>✓</b>
                <span>
                  <strong>Conceptos reconocidos</strong>
                  <small>Totales, usados y disponibles localizados.</small>
                </span>
              </p>
              <p className={reconciled ? "" : "checkWarn"}>
                <b>{reconciled ? "✓" : "!"}</b>
                <span>
                  <strong>Conciliación matemática</strong>
                  <small>
                    {nf.format(report.total)} = {nf.format(report.used)} +{" "}
                    {nf.format(report.available)}
                  </small>
                </span>
              </p>
              <p className={report.loadedAt ? "" : "checkWarn"}>
                <b>{report.loadedAt ? "✓" : "!"}</b>
                <span>
                  <strong>Fecha de actualización</strong>
                  <small>
                    {report.loadedAt
                      ? df.format(report.loadedAt)
                      : "Pendiente de registrar una carga"}
                  </small>
                </span>
              </p>
            </div>
          </article>
        </section>
        {report.note && (
          <section className="panel alertPanel">
            <strong>Observación de la carga</strong>
            <p>{report.note}</p>
          </section>
        )}
        <section className="panel reportSummary">
          <div className="panelHead">
            <div>
              <h2>Lectura ejecutiva</h2>
              <p>Indicadores principales para el control de disponibilidad.</p>
            </div>
          </div>
          <div className="summaryText">
            <p>
              La Facultad posee un cupo total de{" "}
              <strong>{nf.format(report.total)} puntos</strong>. Actualmente
              utiliza <strong>{nf.format(report.used)} puntos</strong> y
              mantiene{" "}
              <strong>{nf.format(report.available)} puntos disponibles</strong>.
            </p>
            <p>
              El nivel de utilización es del{" "}
              <strong>{usage.toFixed(2).replace(".", ",")}%</strong>. La
              información se considera <strong>{report.status}</strong>
              {report.loadedAt
                ? ` desde la carga realizada el ${df.format(report.loadedAt)}`
                : ", pendiente de una carga identificada"}
              .
            </p>
          </div>
        </section>
        <div className="reportActions">
          <button className="secondary" onClick={() => setReportId(null)}>
            ← Volver al consolidado
          </button>
          <button
            className="primary dark"
            onClick={() => {
              setReportId(null);
              setTimeout(
                () =>
                  document
                    .getElementById("imports")
                    ?.scrollIntoView({ behavior: "smooth" }),
                50,
              );
            }}
          >
            Ver fuente automática de esta Facultad
          </button>
        </div>
        <footer>
          Dirección General de Programación Financiera y Presupuestaria ·
          Universidad Nacional de Río Cuarto{" "}
          <span>Informe institucional · {report.short}</span>
        </footer>
      </main>
    );
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <SystemIcon compact />
          <div>
            <strong>UNRC</strong>
            <small>Programación Financiera y Presupuestaria</small>
          </div>
        </div>
        <div className="user">
          <span>{currentUser?.displayName.slice(0, 2).toUpperCase() || "UN"}</span>
          <div>
            <strong>{currentUser?.displayName}</strong>
            <small>{currentUser?.roleLabel}</small>
          </div>
          {can("users:manage") && (
            <a className="adminLink" href="/admin/usuarios">Gestión de usuarios</a>
          )}
          <button className="logoutButton" onClick={() => void logout()}>Cerrar sesión</button>
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">CONTROL INSTITUCIONAL</p>
          <h1>Puntos docentes</h1>
          <p>
            Información consolidada de las cinco Facultades · Última
            actualización del tablero: {formatIso(updatedAt)}
          </p>
        </div>
        {can("report:consolidated") && (
          <button className="primary" onClick={generateConsolidatedPdf}>
            Generar PDF consolidado
          </button>
        )}
      </section>

      <section className="metrics">
        <article>
          <span>PUNTOS TOTALES</span>
          <strong>{nf.format(totals.total)}</strong>
          <small>Cupo autorizado consolidado</small>
        </article>
        <article>
          <span>PUNTOS USADOS</span>
          <strong>{nf.format(totals.used)}</strong>
          <small>
            {percentage.toFixed(2).replace(".", ",")}% del total asignado
          </small>
        </article>
        <article className="available">
          <span>DISPONIBLES</span>
          <strong>{nf.format(totals.available)}</strong>
          <small className="availableSplit">
            <span>De licencia: <b>{nf.format(totals.licenseAvailable)}</b></span>
            <span>Libres: <b>{nf.format(totals.freeAvailable)}</b></span>
          </small>
        </article>
        <article>
          <span>FACULTADES ACTUALIZADAS</span>
          <strong>
            {faculties.filter((f) => f.status === "vigente").length}{" "}
            <em>/ 5</em>
          </strong>
          <small>
            {faculties.some((f) => f.status !== "vigente")
              ? "Requiere completar cargas"
              : "Información completa"}
          </small>
        </article>
      </section>

      <section className="panel">
        <div className="panelHead">
          <div>
            <h2>Situación por Facultad</h2>
            <p>
              Control de uso y disponibilidad según la última carga confirmada.
            </p>
          </div>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>{sortHeader("code", "CÓDIGO")}</th>
                <th>{sortHeader("name", "FACULTAD")}</th>
                <th className="numeric">{sortHeader("total", "PUNTOS TOTALES")}</th>
                <th className="numeric">{sortHeader("used", "USADOS")}</th>
                <th className="numeric">{sortHeader("licenseAvailable", "DISP. DE LICENCIA")}</th>
                <th className="numeric">{sortHeader("freeAvailable", "DISP. LIBRES")}</th>
                <th className="numeric">{sortHeader("available", "DISP. TOTALES")}</th>
                <th className="numeric">{sortHeader("usage", "NIVEL DE USO")}</th>
                <th>{sortHeader("loadedAt", "ÚLTIMA CARGA")}</th>
              </tr>
            </thead>
            <tbody>
              {sortedFaculties.map((f) => {
                const p = f.total ? (f.used / f.total) * 100 : 0;
                return (
                  <tr
                    key={f.id}
                    className="clickRow"
                    style={{ "--faculty": f.color } as CSSProperties}
                    onClick={() => openReport(f.id)}
                  >
                    <td><b className="codeBadge" style={{ background: f.color }}>{f.code}</b></td>
                    <td className="facultyCell">
                      <b className="avatar" style={{ background: `${f.color}18`, color: f.color, borderColor: `${f.color}55` }}>{f.short}</b>
                      <span>
                        <strong>{f.name.replace("Facultad de ", "")}</strong>
                        <small>{f.fileName ?? "Sin archivo vigente"}</small>
                      </span>
                    </td>
                    <td className="numeric">{nf.format(f.total)}</td>
                    <td className="numeric">{nf.format(f.used)}</td>
                    <td className="numeric availablePart licensePart">{nf.format(f.breakdown.license.available)}</td>
                    <td className="numeric availablePart freePart">{nf.format(f.breakdown.free.available)}</td>
                    <td className="numeric green availableTotal"><strong>{nf.format(f.available)}</strong></td>
                    <td className="numeric">
                      <div className="usage">
                        <span>
                          <i style={{ width: `${p}%`, background: f.color }} />
                        </span>
                        <b>{p.toFixed(1).replace(".", ",")}%</b>
                      </div>
                    </td>
                    <td>
                      {f.loadedAt ? (
                        <>
                          <strong>{df.format(f.loadedAt).split(",")[0]}</strong>
                          <small>{df.format(f.loadedAt).split(",")[1]}</small>
                        </>
                      ) : (
                        <span className="muted">Sin carga</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel importPanel" id="imports">
        <div className="panelHead">
          <div>
            <p className="eyebrow">ACTUALIZACIÓN AUTOMÁTICA</p>
            <h2>Fuentes de Google Drive</h2>
            <p>
              La carpeta privada se consulta cada {drive.intervalSeconds} segundos.
              Sólo se activa un archivo cuando supera la validación de la hoja <b>CUADRO</b>.
            </p>
          </div>
          {can("sync:manual") ? (
            <button
              className="syncButton"
              onClick={() => void refreshDashboard(true)}
              disabled={refreshing}
            >
              {refreshing ? "Verificando…" : "Verificar ahora"}
            </button>
          ) : (
            <span className="readOnlyNotice">Sólo lectura · actualización automática del servidor</span>
          )}
        </div>
        <div className={`driveSummary ${drive.status}`}>
          <span className="driveDot" />
          <div>
            <strong>{drive.message}</strong>
            <small>
              Última consulta: {formatIso(drive.lastSyncAt)} · Carpeta configurada en modo de sólo lectura
            </small>
          </div>
        </div>
        {drive.warnings.map((warning) => (
          <div className="driveWarning" key={warning}>{warning}</div>
        ))}
        {syncMessage && <div className="message">{syncMessage}</div>}
        <div className="tableWrap sourceTableWrap">
          <table className="sourceTable">
            <thead>
              <tr>
                <th>FACULTAD</th>
                <th>ARCHIVO OFICIAL</th>
                <th>ÚLTIMA REVISIÓN</th>
                <th>MODIFICADO EN DRIVE</th>
                <th>VERSIÓN</th>
                <th>VALIDACIÓN</th>
              </tr>
            </thead>
            <tbody>
              {faculties.slice().sort((a, b) => a.code - b.code).map((faculty) => {
                const attempt = faculty.source?.lastAttempt;
                const current = faculty.source?.current;
                return (
                  <tr key={faculty.id}>
                    <td><strong>{faculty.short}</strong><small>{faculty.name.replace("Facultad de ", "")}</small></td>
                    <td><strong>{faculty.source?.expectedFileName ?? faculty.fileName}</strong><small>{current ? "Origen: Google Drive" : "Pendiente de primera lectura"}</small></td>
                    <td>{formatIso(attempt?.validatedAt)}</td>
                    <td>{formatIso(attempt?.driveModifiedAt)}</td>
                    <td>{current ? `v${current.attempt}` : "—"}</td>
                    <td>
                      {can("history:activity") ? (
                        <button
                          className={`historyButton ${attempt?.status ?? "pendiente"}`}
                          onClick={() => openActivity(faculty.id)}
                        >
                          {attempt?.status === "vigente"
                            ? `Válido · ${attempt.checks.length} controles`
                            : attempt?.status === "rechazado"
                              ? `Rechazado · ${attempt.errors.length} errores`
                              : "Ver actividad"}
                        </button>
                      ) : (
                        <span className={`historyButton static ${attempt?.status ?? "pendiente"}`}>
                          {attempt?.status === "vigente" ? "Válido" : attempt?.status === "rechazado" ? "Observado" : "Pendiente"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {historyFacultyId && (
          <div className="historyPanel">
            <div className="historyHead">
              <div>
                <strong>
                  {historyScope === "activity" ? "Actividad de la sesión" : "Historial completo"}
                  {" · "}
                  {faculties.find((faculty) => faculty.id === historyFacultyId)?.name}
                </strong>
                <small>
                  {historyScope === "activity"
                    ? "Incluye el último registro al ingresar y los cambios detectados durante esta sesión."
                    : `Consulta administrativa: ${retainedHistoryRecords} registro(s) de auditoría conservado(s).`}
                </small>
              </div>
              <div className="historyActions">
                {can("history:full") && (
                  <button onClick={toggleHistoryScope}>
                    {historyScope === "activity" ? "Ver historial completo" : "Volver a actividad"}
                  </button>
                )}
                <button onClick={closeHistory}>Cerrar</button>
              </div>
            </div>
            {historyLoading ? (
              <p className="emptyHistory">Actualizando actividad…</p>
            ) : history.length ? history.map((entry) => (
              <article className={`historyEntry ${entry.status}`} key={`${entry.attempt}-${entry.sha256}`}>
                <div>
                  <strong>Intento {entry.attempt} · {entry.status === "vigente" ? "Activado" : "Rechazado"}</strong>
                  <small>
                    {entry.fileName} · validado {formatIso(entry.validatedAt)} · huella {entry.sha256}
                  </small>
                  {historyScope === "activity" && (
                    <em className="sessionTag">
                      {entry.attempt === (sessionBaselineDisplay[historyFacultyId] ?? 0)
                        ? "Último registro al ingresar"
                        : "Nuevo en esta sesión"}
                    </em>
                  )}
                </div>
                <div>
                  <span>{entry.recordCount} filas informativas</span>
                  <span>{entry.checks.length} controles superados</span>
                </div>
                {entry.errors.map((error) => <p key={error}>{error}</p>)}
              </article>
            )) : <p className="emptyHistory">Todavía no hay versiones procesadas desde Google Drive.</p>}
          </div>
        )}
      </section>
      <footer>
        Dirección General de Programación Financiera y Presupuestaria ·
        Universidad Nacional de Río Cuarto{" "}
        <span>Control de Puntos Docentes · v2.3.1 Institucional</span>
      </footer>
    </main>
  );
}
