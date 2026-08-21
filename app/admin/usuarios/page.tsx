"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

type SessionResponse = {
  authenticated: boolean;
  user?: { displayName: string; email: string; roleLabel: string };
  permissions?: string[];
  csrfToken?: string;
};

type Role = {
  code: string;
  label: string;
  description: string;
  institutionalScope: boolean;
  permissions: string[];
};

type Faculty = { id: string; code: number; short: string; name: string };

type ManagedUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  roleLabel: string;
  status: "PENDIENTE" | "ACTIVO" | "SUSPENDIDO" | "BAJA";
  protectedPrincipal: boolean;
  identityLinked: boolean;
  facultyIds: string[];
  validFrom: string | null;
  validUntil: string | null;
  lastLoginAt: string | null;
  activeSessions: number;
  suspensionReason: string | null;
  deactivationReason: string | null;
};

type UsersResponse = {
  users: ManagedUser[];
  catalog: { roles: Role[]; faculties: Faculty[] };
  canGrantAdmin: boolean;
  reauthFresh: boolean;
};

type AuditEntry = {
  id: string;
  occurredAt: string;
  actorEmail: string | null;
  targetEmail: string | null;
  action: string;
  outcome: string;
  reason: string | null;
  ipAddress: string | null;
};

type UserStatistic = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  protectedPrincipal: boolean;
  firstLoginAt: string | null;
  lastLoginAt: string | null;
  lastActivityAt: string | null;
  totalLogins: number;
  logins7Days: number;
  logins30Days: number;
  distinctAccessDays: number;
  queries30Days: number;
  reports30Days: number;
  activeSessions: number;
};

type StatisticsResponse = {
  generatedAt: string;
  summary: {
    totalUsers: number;
    activeUsers30Days: number;
    neverLoggedIn: number;
    totalLogins30Days: number;
    totalQueries30Days: number;
    totalReports30Days: number;
  };
  users: UserStatistic[];
  daily: Array<{
    day: string;
    logins: number;
    activeUsers: number;
    queries: number;
    reports: number;
  }>;
  monthly: Array<{ month: string; logins: number; activeUsers: number }>;
};

type UserAccessDetail = {
  user: { id: string; email: string; displayName: string };
  logins: Array<{
    occurredAt: string;
    ipAddress: string | null;
    userAgent: string | null;
  }>;
  activities: Array<{
    occurredAt: string;
    activityCode: string;
    facultyId: string | null;
  }>;
};

type AccessForm = {
  email: string;
  displayName: string;
  role: string;
  facultyIds: string[];
  validFrom: string;
  validUntil: string;
  reason: string;
};

type LifecycleAction = "suspend" | "reactivate" | "deactivate";

const emptyForm: AccessForm = {
  email: "",
  displayName: "",
  role: "CONSULTA_GENERAL",
  facultyIds: [],
  validFrom: "",
  validUntil: "",
  reason: "",
};

const statusLabels = {
  PENDIENTE: "Pendiente de primer acceso",
  ACTIVO: "Activo",
  SUSPENDIDO: "Suspendido",
  BAJA: "Baja lógica",
};

const actionLabels: Record<LifecycleAction, { title: string; button: string; help: string }> = {
  suspend: {
    title: "Suspender acceso transitoriamente",
    button: "Confirmar suspensión",
    help: "La suspensión será inmediata y cerrará todas las sesiones activas.",
  },
  reactivate: {
    title: "Reactivar usuario",
    button: "Confirmar reactivación",
    help: "El usuario podrá volver a ingresar con la autorización existente.",
  },
  deactivate: {
    title: "Dar de baja lógicamente",
    button: "Confirmar baja",
    help: "No se eliminará ningún antecedente. Una reincorporación posterior será un acto nuevo.",
  },
};

const activityLabels: Record<string, string> = {
  TABLERO_CONSULTADO: "Consultó el tablero general",
  FACULTAD_CONSULTADA: "Consultó el informe de una Facultad",
  HISTORIAL_FACULTAD_CONSULTADO: "Consultó el historial de una Facultad",
  PDF_FACULTAD_GENERADO: "Generó un PDF de Facultad",
  PDF_CONSOLIDADO_GENERADO: "Generó el PDF consolidado",
};

class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly reauthRequired = false) {
    super(message);
  }
}

async function api<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(path, { ...init, cache: "no-store" });
  const payload = await response.json().catch(() => null) as (T & {
    error?: string;
    reauthRequired?: boolean;
  }) | null;
  if (!response.ok) {
    throw new ApiError(
      payload?.error || `La operación fue rechazada (${response.status}).`,
      response.status,
      payload?.reauthRequired === true,
    );
  }
  if (!payload) throw new ApiError("El servidor devolvió una respuesta vacía.", 500);
  return payload;
}

function formatIso(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value))
    : "—";
}

function localInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function isoInput(value: string) {
  return value ? new Date(value).toISOString() : null;
}

export default function UsersAdministrationPage() {
  const [session, setSession] = useState<SessionResponse>();
  const [csrfToken, setCsrfToken] = useState("");
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [canGrantAdmin, setCanGrantAdmin] = useState(false);
  const [reauthFresh, setReauthFresh] = useState(false);
  const [tab, setTab] = useState<"users" | "statistics" | "audit">("users");
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [statistics, setStatistics] = useState<StatisticsResponse>();
  const [statisticsLoading, setStatisticsLoading] = useState(false);
  const [accessDetail, setAccessDetail] = useState<UserAccessDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [editing, setEditing] = useState<ManagedUser | "new" | null>(null);
  const [form, setForm] = useState<AccessForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [lifecycle, setLifecycle] = useState<{
    user: ManagedUser;
    action: LifecycleAction;
    reason: string;
  } | null>(null);

  const loadUsers = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (statusFilter) params.set("status", statusFilter);
    if (roleFilter) params.set("role", roleFilter);
    const payload = await api<UsersResponse>(`/api/admin/users?${params}`);
    setUsers(payload.users);
    setRoles(payload.catalog.roles);
    setFaculties(payload.catalog.faculties);
    setCanGrantAdmin(payload.canGrantAdmin);
    setReauthFresh(payload.reauthFresh);
  }, [search, statusFilter, roleFilter]);

  const loadAudit = useCallback(async () => {
    const payload = await api<{ entries: AuditEntry[] }>("/api/admin/audit");
    setAudit(payload.entries);
  }, []);

  const loadStatistics = useCallback(async () => {
    setStatisticsLoading(true);
    try {
      setStatistics(await api<StatisticsResponse>("/api/admin/user-statistics"));
    } finally {
      setStatisticsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void api<SessionResponse>("/api/auth/session")
      .then(async (current) => {
        if (!active) return;
        if (!current.authenticated || !current.permissions?.includes("users:manage")) {
          window.location.replace("/");
          return;
        }
        setSession(current);
        setCsrfToken(current.csrfToken || "");
        await loadUsers();
      })
      .catch(() => window.location.replace("/"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [loadUsers]);

  useEffect(() => {
    if (!session || loading) return;
    const timer = window.setTimeout(() => {
      void loadUsers().catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudo filtrar."));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, statusFilter, roleFilter, loadUsers, loading, session]);

  const selectedRole = useMemo(
    () => roles.find((role) => role.code === form.role),
    [roles, form.role],
  );

  const dailyMaximum = useMemo(() => Math.max(
    1,
    ...(statistics?.daily.slice(-14).map((day) =>
      day.logins + day.queries + day.reports
    ) ?? [1]),
  ), [statistics]);

  async function openAccessDetail(userId: string) {
    setDetailLoading(true);
    setError("");
    try {
      setAccessDetail(await api<UserAccessDetail>(
        `/api/admin/user-statistics/${encodeURIComponent(userId)}`,
      ));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el detalle.");
    } finally {
      setDetailLoading(false);
    }
  }

  function exportStatistics() {
    if (!statistics) return;
    const csvCell = (value: string | number | null) =>
      `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [
      [
        "Nombre y apellido",
        "Correo institucional",
        "Perfil",
        "Estado",
        "Primer acceso",
        "Último acceso",
        "Última actividad",
        "Ingresos totales",
        "Ingresos últimos 7 días",
        "Ingresos últimos 30 días",
        "Días distintos de acceso",
        "Consultas últimos 30 días",
        "Informes últimos 30 días",
      ],
      ...statistics.users.map((user) => [
        user.displayName,
        user.email,
        roles.find((role) => role.code === user.role)?.label || user.role,
        user.status,
        user.firstLoginAt ? formatIso(user.firstLoginAt) : "Nunca ingresó",
        user.lastLoginAt ? formatIso(user.lastLoginAt) : "Nunca ingresó",
        user.lastActivityAt ? formatIso(user.lastActivityAt) : "Sin actividad",
        user.totalLogins,
        user.logins7Days,
        user.logins30Days,
        user.distinctAccessDays,
        user.queries30Days,
        user.reports30Days,
      ]),
    ];
    const csv = `\ufeff${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `Estadisticas_Usuarios_Puntos_Docentes_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function openNew() {
    setError("");
    setMessage("");
    setForm(emptyForm);
    setEditing("new");
  }

  function openEdit(user: ManagedUser) {
    setError("");
    setMessage("");
    setForm({
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      facultyIds: user.facultyIds,
      validFrom: localInput(user.validFrom),
      validUntil: localInput(user.validUntil),
      reason: "",
    });
    setEditing(user);
  }

  function toggleFaculty(id: string) {
    setForm((current) => ({
      ...current,
      facultyIds: current.facultyIds.includes(id)
        ? current.facultyIds.filter((facultyId) => facultyId !== id)
        : [...current.facultyIds, id],
    }));
  }

  async function submitAccess(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError("");
    setMessage("");
    const payload = {
      email: form.email,
      displayName: form.displayName,
      role: form.role,
      facultyIds: selectedRole?.institutionalScope ? [] : form.facultyIds,
      validFrom: isoInput(form.validFrom),
      validUntil: isoInput(form.validUntil),
      reason: form.reason,
      action: editing === "new"
        ? undefined
        : editing.status === "BAJA" ? "reinstate" : "update_access",
    };
    try {
      if (editing === "new") {
        await api("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
          body: JSON.stringify(payload),
        });
        setMessage("Usuario autorizado. Quedó pendiente de su primer acceso institucional.");
      } else {
        await api(`/api/admin/users/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
          body: JSON.stringify(payload),
        });
        setMessage(editing.status === "BAJA" ? "Usuario reincorporado con una nueva autorización." : "Perfil y alcance actualizados; las sesiones anteriores fueron revocadas.");
      }
      setEditing(null);
      await loadUsers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar.");
      if (cause instanceof ApiError && cause.reauthRequired) setReauthFresh(false);
    } finally {
      setSaving(false);
    }
  }

  async function submitLifecycle(event: FormEvent) {
    event.preventDefault();
    if (!lifecycle) return;
    setSaving(true);
    setError("");
    try {
      await api(`/api/admin/users/${lifecycle.user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ action: lifecycle.action, reason: lifecycle.reason }),
      });
      setMessage(
        lifecycle.action === "suspend"
          ? "Usuario suspendido y sesiones revocadas."
          : lifecycle.action === "reactivate"
            ? "Usuario reactivado."
            : "Baja lógica registrada; los antecedentes permanecen intactos.",
      );
      setLifecycle(null);
      await loadUsers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo completar la acción.");
      if (cause instanceof ApiError && cause.reauthRequired) setReauthFresh(false);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className="adminLoading">Verificando autorización…</main>;

  return (
    <main className="adminPage">
      <header className="adminTopbar">
        <Link className="adminBrand" href="/">
          <Image src="/icono-unrc-pd.png" alt="UNRC" width={48} height={54} />
          <span><strong>Control de Puntos Docentes</strong><small>Administración segura</small></span>
        </Link>
        <div className="adminIdentity">
          <span><strong>{session?.user?.displayName}</strong><small>{session?.user?.roleLabel}</small></span>
          <Link href="/">Volver al tablero</Link>
        </div>
      </header>

      <section className="adminHero">
        <div>
          <p className="eyebrow">ADMINISTRADOR GENERAL</p>
          <h1>Usuarios, perfiles y alcances</h1>
          <p>Altas autorizadas, cambios trazables, suspensión reversible y baja lógica sin pérdida de antecedentes.</p>
        </div>
        <button onClick={openNew}>+ Nuevo usuario</button>
      </section>

      {!reauthFresh && (
        <section className="reauthBanner">
          <div><strong>Confirmación de identidad requerida</strong><span>Para guardar cambios críticos debe volver a identificarse con Google Workspace.</span></div>
          <a href="/api/auth/google/start?intent=reauth&returnTo=/admin/usuarios">Verificar mi identidad</a>
        </section>
      )}
      {message && <p className="adminMessage success" role="status">{message}</p>}
      {error && <p className="adminMessage error" role="alert">{error}</p>}

      <nav className="adminTabs" aria-label="Secciones de administración">
        <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>Usuarios</button>
        <button className={tab === "statistics" ? "active" : ""} onClick={() => {
          setTab("statistics");
          void loadStatistics().catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudieron cargar las estadísticas."));
        }}>Estadísticas de acceso</button>
        <button className={tab === "audit" ? "active" : ""} onClick={() => {
          setTab("audit");
          void loadAudit().catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudo cargar la auditoría."));
        }}>Auditoría de seguridad</button>
      </nav>

      {tab === "users" ? (
        <section className="adminPanel">
          <div className="adminFilters">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nombre o correo" />
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
              <option value="">Todos los perfiles</option>
              {roles.map((role) => <option key={role.code} value={role.code}>{role.label}</option>)}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">Todos los estados</option>
              {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <span>{users.length} usuario(s)</span>
          </div>
          <div className="adminTableWrap">
            <table className="adminTable">
              <thead><tr><th>USUARIO</th><th>PERFIL Y ALCANCE</th><th>ESTADO</th><th>ÚLTIMO ACCESO</th><th>SESIONES</th><th>ACCIONES</th></tr></thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td><strong>{user.displayName}</strong><small>{user.email}</small>{user.protectedPrincipal && <em>Administrador principal protegido</em>}</td>
                    <td><strong>{user.roleLabel}</strong><small>{user.facultyIds.length ? user.facultyIds.map((id) => faculties.find((faculty) => faculty.id === id)?.short || id).join(", ") : "Alcance institucional"}</small></td>
                    <td><span className={`userStatus ${user.status.toLowerCase()}`}>{statusLabels[user.status]}</span><small>{user.identityLinked ? "Identidad Google vinculada" : "Aún sin vincular"}</small></td>
                    <td>{formatIso(user.lastLoginAt)}<small>{user.validUntil ? `Vigencia hasta ${formatIso(user.validUntil)}` : "Sin vencimiento programado"}</small></td>
                    <td><strong>{user.activeSessions}</strong><small>activas</small></td>
                    <td>
                      {user.protectedPrincipal || (user.role === "ADMIN_GENERAL" && !canGrantAdmin) ? <span className="protectedText">Protegido</span> : (
                        <div className="rowActions">
                          <button onClick={() => openEdit(user)}>{user.status === "BAJA" ? "Reincorporar" : "Editar"}</button>
                          {user.status === "SUSPENDIDO" ? (
                            <button onClick={() => setLifecycle({ user, action: "reactivate", reason: "" })}>Reactivar</button>
                          ) : user.status !== "BAJA" ? (
                            <button onClick={() => setLifecycle({ user, action: "suspend", reason: "" })}>Suspender</button>
                          ) : null}
                          {user.status !== "BAJA" && <button className="danger" onClick={() => setLifecycle({ user, action: "deactivate", reason: "" })}>Baja</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : tab === "statistics" ? (
        <section className="adminPanel statisticsPanel">
          <div className="statisticsHead">
            <div>
              <h2>Utilización del sistema por usuario</h2>
              <p>Ingresos institucionales, días de uso, consultas e informes generados. Período móvil: últimos 30 días.</p>
            </div>
            <div>
              <button onClick={() => void loadStatistics()} disabled={statisticsLoading}>
                {statisticsLoading ? "Actualizando…" : "Actualizar"}
              </button>
              <button onClick={exportStatistics} disabled={!statistics}>Exportar para Excel</button>
            </div>
          </div>
          {statisticsLoading && !statistics ? (
            <p className="emptyAdmin">Calculando estadísticas…</p>
          ) : statistics ? (
            <>
              <div className="statisticsCards">
                <article><span>USUARIOS REGISTRADOS</span><strong>{statistics.summary.totalUsers}</strong><small>Total de autorizaciones</small></article>
                <article><span>ACTIVOS EN 30 DÍAS</span><strong>{statistics.summary.activeUsers30Days}</strong><small>Con acceso o actividad reciente</small></article>
                <article><span>NUNCA INGRESARON</span><strong>{statistics.summary.neverLoggedIn}</strong><small>Pendientes de primer acceso</small></article>
                <article><span>INGRESOS EN 30 DÍAS</span><strong>{statistics.summary.totalLogins30Days}</strong><small>Autenticaciones exitosas</small></article>
                <article><span>CONSULTAS EN 30 DÍAS</span><strong>{statistics.summary.totalQueries30Days}</strong><small>Facultades e historiales</small></article>
                <article><span>INFORMES EN 30 DÍAS</span><strong>{statistics.summary.totalReports30Days}</strong><small>PDF individuales y consolidados</small></article>
              </div>

              <div className="statisticsGrid">
                <article className="statisticsBlock">
                  <div className="statisticsBlockHead"><div><h3>Actividad diaria</h3><p>Últimos 14 días</p></div><span>{formatIso(statistics.generatedAt)}</span></div>
                  <div className="statisticsChart" aria-label="Actividad diaria de los últimos 14 días">
                    {statistics.daily.slice(-14).map((day) => (
                      <div key={day.day}>
                        <span>{day.logins + day.queries + day.reports}</span>
                        <div className="statisticsBar" title={`${day.day}: ${day.logins} ingresos, ${day.queries} consultas, ${day.reports} informes`}>
                          <i className="reports" style={{ height: `${day.reports / dailyMaximum * 100}%` }} />
                          <i className="queries" style={{ height: `${day.queries / dailyMaximum * 100}%` }} />
                          <i className="logins" style={{ height: `${day.logins / dailyMaximum * 100}%` }} />
                        </div>
                        <small>{new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit" }).format(new Date(`${day.day}T12:00:00`))}</small>
                      </div>
                    ))}
                  </div>
                  <div className="statisticsLegend"><span><i className="logins" />Ingresos</span><span><i className="queries" />Consultas</span><span><i className="reports" />Informes</span></div>
                </article>
                <article className="statisticsBlock monthlyBlock">
                  <div className="statisticsBlockHead"><div><h3>Evolución mensual</h3><p>Últimos 12 meses</p></div></div>
                  <div className="monthlyList">
                    {statistics.monthly.map((month) => (
                      <p key={month.month}><span>{new Intl.DateTimeFormat("es-AR", { month: "short", year: "2-digit" }).format(new Date(`${month.month}-15T12:00:00`))}</span><strong>{month.logins}</strong><small>{month.activeUsers} usuario(s)</small></p>
                    ))}
                  </div>
                </article>
              </div>

              <div className="statisticsUsersHead">
                <div><h3>Detalle por usuario</h3><p>Ordenado por cantidad histórica de ingresos exitosos.</p></div>
                <span>{statistics.users.length} usuario(s)</span>
              </div>
              <div className="adminTableWrap">
                <table className="adminTable statisticsTable">
                  <thead><tr><th>USUARIO</th><th>PRIMER ACCESO</th><th>ÚLTIMO ACCESO / ACTIVIDAD</th><th>INGRESOS</th><th>7 / 30 DÍAS</th><th>CONSULTAS / INFORMES</th><th>DETALLE</th></tr></thead>
                  <tbody>
                    {statistics.users.map((user) => (
                      <tr key={user.id}>
                        <td><strong>{user.displayName}</strong><small>{user.email}</small><small>{roles.find((role) => role.code === user.role)?.label || user.role} · {user.status}</small></td>
                        <td>{user.firstLoginAt ? formatIso(user.firstLoginAt) : <span className="neverAccessed">Nunca ingresó</span>}</td>
                        <td><strong>{formatIso(user.lastLoginAt)}</strong><small>Actividad: {formatIso(user.lastActivityAt)}</small></td>
                        <td><strong>{user.totalLogins}</strong><small>{user.distinctAccessDays} día(s) distintos</small></td>
                        <td><strong>{user.logins7Days} / {user.logins30Days}</strong><small>ingresos exitosos</small></td>
                        <td><strong>{user.queries30Days} / {user.reports30Days}</strong><small>últimos 30 días</small></td>
                        <td><button className="statisticsDetailButton" disabled={detailLoading} onClick={() => void openAccessDetail(user.id)}>Ver historial</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="statisticsNote">Los ingresos anteriores se recuperan de la auditoría existente. Las consultas y los informes comienzan a contabilizarse desde la instalación de la versión 2.3.0.</p>
            </>
          ) : (
            <p className="emptyAdmin">No hay estadísticas disponibles.</p>
          )}
        </section>
      ) : (
        <section className="adminPanel">
          <div className="auditHead"><div><h2>Auditoría inalterable</h2><p>Últimos 100 eventos. Este registro puede consultarse, pero no modificarse ni eliminarse desde la aplicación.</p></div><button onClick={() => void loadAudit()}>Actualizar</button></div>
          <div className="auditList">
            {audit.map((entry) => (
              <article key={entry.id}>
                <span className={`auditOutcome ${entry.outcome.toLowerCase()}`}>{entry.outcome}</span>
                <div><strong>{entry.action.replaceAll("_", " ")}</strong><small>{formatIso(entry.occurredAt)} · por {entry.actorEmail || "sistema"} · sobre {entry.targetEmail || "—"}</small>{entry.reason && <p>{entry.reason}</p>}</div>
                <small>IP {entry.ipAddress || "—"}</small>
              </article>
            ))}
            {!audit.length && <p className="emptyAdmin">No hay eventos para mostrar.</p>}
          </div>
        </section>
      )}

      {accessDetail && (
        <div className="modalBackdrop" role="presentation">
          <section className="adminModal accessHistoryModal" role="dialog" aria-modal="true" aria-labelledby="history-title">
            <div className="modalHead">
              <div><p className="eyebrow">ESTADÍSTICAS POR USUARIO</p><h2 id="history-title">Historial de accesos y actividad</h2></div>
              <button onClick={() => setAccessDetail(null)} aria-label="Cerrar">×</button>
            </div>
            <div className="accessHistoryIdentity"><strong>{accessDetail.user.displayName}</strong><span>{accessDetail.user.email}</span></div>
            <div className="accessHistoryGrid">
              <section>
                <h3>Ingresos exitosos</h3>
                <p>Últimos {accessDetail.logins.length} registros conservados.</p>
                <div className="accessHistoryList">
                  {accessDetail.logins.map((login, index) => (
                    <article key={`${login.occurredAt}-${index}`}><span>Ingreso</span><strong>{formatIso(login.occurredAt)}</strong></article>
                  ))}
                  {!accessDetail.logins.length && <p className="emptyAdmin">El usuario todavía no ingresó.</p>}
                </div>
              </section>
              <section>
                <h3>Actividad funcional</h3>
                <p>Consultas e informes registrados en la versión 2.3.0.</p>
                <div className="accessHistoryList">
                  {accessDetail.activities.map((activity, index) => (
                    <article key={`${activity.occurredAt}-${index}`}>
                      <span>{activityLabels[activity.activityCode] || activity.activityCode.replaceAll("_", " ")}</span>
                      <strong>{formatIso(activity.occurredAt)}{activity.facultyId ? ` · ${faculties.find((faculty) => faculty.id === activity.facultyId)?.short || activity.facultyId.toUpperCase()}` : ""}</strong>
                    </article>
                  ))}
                  {!accessDetail.activities.length && <p className="emptyAdmin">Todavía no hay actividad funcional registrada.</p>}
                </div>
              </section>
            </div>
            <div className="modalActions accessHistoryActions"><button onClick={() => setAccessDetail(null)}>Cerrar</button></div>
          </section>
        </div>
      )}

      {editing && (
        <div className="modalBackdrop" role="presentation">
          <section className="adminModal" role="dialog" aria-modal="true" aria-labelledby="access-title">
            <div className="modalHead"><div><p className="eyebrow">AUTORIZACIÓN DE ACCESO</p><h2 id="access-title">{editing === "new" ? "Nuevo usuario" : editing.status === "BAJA" ? "Reincorporar usuario" : "Editar perfil y alcance"}</h2></div><button onClick={() => setEditing(null)} aria-label="Cerrar">×</button></div>
            <form onSubmit={submitAccess}>
              <div className="formGrid">
                <label><span>Correo institucional</span><input type="email" required disabled={editing !== "new"} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="usuario@eco.unrc.edu.ar" /></label>
                <label><span>Nombre y apellido</span><input required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>
                <label className="full"><span>Perfil</span><select required value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value, facultyIds: [] })}>{roles.filter((role) => role.code !== "ADMIN_GENERAL" || canGrantAdmin).map((role) => <option key={role.code} value={role.code}>{role.label}</option>)}</select>{selectedRole && <small>{selectedRole.description}</small>}</label>
                {selectedRole && !selectedRole.institutionalScope && (
                  <fieldset className="full"><legend>Facultades autorizadas</legend><div className="facultyChecks">{faculties.map((faculty) => <label key={faculty.id}><input type="checkbox" checked={form.facultyIds.includes(faculty.id)} onChange={() => toggleFaculty(faculty.id)} /><span><b>{faculty.short}</b>{faculty.name}</span></label>)}</div></fieldset>
                )}
                <label><span>Vigente desde (opcional)</span><input type="datetime-local" value={form.validFrom} onChange={(event) => setForm({ ...form, validFrom: event.target.value })} /></label>
                <label><span>Vigente hasta (opcional)</span><input type="datetime-local" value={form.validUntil} onChange={(event) => setForm({ ...form, validUntil: event.target.value })} /></label>
                <label className="full"><span>Motivo obligatorio</span><textarea required minLength={5} maxLength={1000} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Indique el fundamento administrativo del alta o cambio" /></label>
              </div>
              <div className="modalActions"><button type="button" onClick={() => setEditing(null)}>Cancelar</button><button className="primaryAdmin" disabled={saving || !reauthFresh}>{saving ? "Guardando…" : editing === "new" ? "Autorizar usuario" : editing.status === "BAJA" ? "Reincorporar" : "Guardar cambios"}</button></div>
            </form>
          </section>
        </div>
      )}

      {lifecycle && (
        <div className="modalBackdrop" role="presentation">
          <section className="adminModal compactModal" role="dialog" aria-modal="true" aria-labelledby="lifecycle-title">
            <div className="modalHead"><div><p className="eyebrow">ACCIÓN SOBRE EL ACCESO</p><h2 id="lifecycle-title">{actionLabels[lifecycle.action].title}</h2></div><button onClick={() => setLifecycle(null)} aria-label="Cerrar">×</button></div>
            <p><strong>{lifecycle.user.displayName}</strong><br />{lifecycle.user.email}</p>
            <p className="modalHelp">{actionLabels[lifecycle.action].help}</p>
            <form onSubmit={submitLifecycle}>
              <label><span>Motivo obligatorio</span><textarea autoFocus required minLength={5} maxLength={1000} value={lifecycle.reason} onChange={(event) => setLifecycle({ ...lifecycle, reason: event.target.value })} /></label>
              <div className="modalActions"><button type="button" onClick={() => setLifecycle(null)}>Cancelar</button><button className={lifecycle.action === "deactivate" ? "dangerConfirm" : "primaryAdmin"} disabled={saving || !reauthFresh}>{saving ? "Procesando…" : actionLabels[lifecycle.action].button}</button></div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
