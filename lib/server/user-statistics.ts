import type { AuthenticatedSession } from "./auth";
import { FACULTY_IDS, type FacultyId } from "./access-control";
import { query } from "./database";

export const USER_ACTIVITY_CODES = [
  "TABLERO_CONSULTADO",
  "FACULTAD_CONSULTADA",
  "HISTORIAL_FACULTAD_CONSULTADO",
  "PDF_FACULTAD_GENERADO",
  "PDF_CONSOLIDADO_GENERADO",
] as const;

export type UserActivityCode = (typeof USER_ACTIVITY_CODES)[number];

const FACULTY_ACTIVITY_CODES: readonly UserActivityCode[] = [
  "FACULTAD_CONSULTADA",
  "HISTORIAL_FACULTAD_CONSULTADO",
  "PDF_FACULTAD_GENERADO",
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class UserStatisticsError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export function parseUserActivityInput(value: unknown): {
  activityCode: UserActivityCode;
  facultyId: FacultyId | null;
} {
  if (!value || typeof value !== "object") {
    throw new UserStatisticsError("La actividad informada no es válida.");
  }
  const body = value as Record<string, unknown>;
  if (
    typeof body.activityCode !== "string" ||
    !USER_ACTIVITY_CODES.includes(body.activityCode as UserActivityCode)
  ) {
    throw new UserStatisticsError("El tipo de actividad no es válido.");
  }
  const activityCode = body.activityCode as UserActivityCode;
  const facultyId = typeof body.facultyId === "string" &&
    FACULTY_IDS.includes(body.facultyId as FacultyId)
    ? body.facultyId as FacultyId
    : null;
  if (FACULTY_ACTIVITY_CODES.includes(activityCode) && !facultyId) {
    throw new UserStatisticsError("La actividad requiere identificar una Facultad.");
  }
  if (!FACULTY_ACTIVITY_CODES.includes(activityCode) && body.facultyId != null) {
    throw new UserStatisticsError("La actividad no admite una Facultad asociada.");
  }
  return { activityCode, facultyId };
}

export async function recordUserActivity(
  session: AuthenticatedSession,
  value: unknown,
) {
  const activity = parseUserActivityInput(value);
  await query(
    `INSERT INTO user_activity_events
      (user_id, session_id, activity_code, faculty_id)
     VALUES ($1, $2, $3, $4)`,
    [session.user.id, session.id, activity.activityCode, activity.facultyId],
  );
  return activity;
}

type StatisticsRow = {
  id: string;
  email: string;
  display_name: string;
  role_code: string;
  status_code: string;
  protected_principal: boolean;
  first_login_at: Date | string | null;
  last_login_at: Date | string | null;
  last_activity_at: Date | string | null;
  total_logins: number | string;
  logins_7_days: number | string;
  logins_30_days: number | string;
  distinct_access_days: number | string;
  queries_30_days: number | string;
  reports_30_days: number | string;
  active_sessions: number | string;
};

function iso(value: Date | string | null) {
  return value ? new Date(value).toISOString() : null;
}

function number(value: number | string | null | undefined) {
  return Number(value || 0);
}

export async function userStatisticsOverview() {
  const [userResult, dailyResult, monthlyResult] = await Promise.all([
    query<StatisticsRow>(
      `WITH login_statistics AS (
         SELECT target_user_id AS user_id,
           min(occurred_at) AS first_login_at,
           max(occurred_at) AS last_login_at,
           count(*) AS total_logins,
           count(*) FILTER (WHERE occurred_at >= now() - interval '7 days') AS logins_7_days,
           count(*) FILTER (WHERE occurred_at >= now() - interval '30 days') AS logins_30_days,
           count(DISTINCT (occurred_at AT TIME ZONE 'America/Argentina/Cordoba')::date) AS distinct_access_days
         FROM audit_log
         WHERE action_code = 'INICIO_SESION'
           AND outcome_code = 'EXITO'
           AND target_user_id IS NOT NULL
         GROUP BY target_user_id
       ), activity_statistics AS (
         SELECT user_id,
           max(occurred_at) AS last_recorded_activity_at,
           count(*) FILTER (
             WHERE occurred_at >= now() - interval '30 days'
               AND activity_code IN ('FACULTAD_CONSULTADA', 'HISTORIAL_FACULTAD_CONSULTADO')
           ) AS queries_30_days,
           count(*) FILTER (
             WHERE occurred_at >= now() - interval '30 days'
               AND activity_code IN ('PDF_FACULTAD_GENERADO', 'PDF_CONSOLIDADO_GENERADO')
           ) AS reports_30_days
         FROM user_activity_events
         GROUP BY user_id
       ), session_statistics AS (
         SELECT user_id,
           max(last_seen_at) AS last_seen_at,
           count(*) FILTER (
             WHERE revoked_at IS NULL
               AND idle_expires_at > now()
               AND absolute_expires_at > now()
           ) AS active_sessions
         FROM user_sessions
         GROUP BY user_id
       )
       SELECT u.id, u.email, u.display_name, u.role_code, u.status_code,
         u.protected_principal,
         COALESCE(l.first_login_at, u.last_login_at) AS first_login_at,
         COALESCE(l.last_login_at, u.last_login_at) AS last_login_at,
         CASE
           WHEN s.last_seen_at IS NULL THEN a.last_recorded_activity_at
           WHEN a.last_recorded_activity_at IS NULL THEN s.last_seen_at
           ELSE GREATEST(s.last_seen_at, a.last_recorded_activity_at)
         END AS last_activity_at,
         COALESCE(l.total_logins, 0) AS total_logins,
         COALESCE(l.logins_7_days, 0) AS logins_7_days,
         COALESCE(l.logins_30_days, 0) AS logins_30_days,
         COALESCE(l.distinct_access_days, 0) AS distinct_access_days,
         COALESCE(a.queries_30_days, 0) AS queries_30_days,
         COALESCE(a.reports_30_days, 0) AS reports_30_days,
         COALESCE(s.active_sessions, 0) AS active_sessions
       FROM app_users u
       LEFT JOIN login_statistics l ON l.user_id = u.id
       LEFT JOIN activity_statistics a ON a.user_id = u.id
       LEFT JOIN session_statistics s ON s.user_id = u.id
       ORDER BY COALESCE(l.total_logins, 0) DESC, u.display_name, u.email`,
    ),
    query<{
      day: string;
      logins: number | string;
      active_users: number | string;
      queries: number | string;
      reports: number | string;
    }>(
      `WITH days AS (
         SELECT generate_series(
           (current_timestamp AT TIME ZONE 'America/Argentina/Cordoba')::date - 29,
           (current_timestamp AT TIME ZONE 'America/Argentina/Cordoba')::date,
           interval '1 day'
         )::date AS day
       ), logins AS (
         SELECT (occurred_at AT TIME ZONE 'America/Argentina/Cordoba')::date AS day,
           count(*) AS logins,
           count(DISTINCT target_user_id) AS active_users
         FROM audit_log
         WHERE action_code = 'INICIO_SESION' AND outcome_code = 'EXITO'
           AND occurred_at >= now() - interval '30 days'
         GROUP BY 1
       ), activities AS (
         SELECT (occurred_at AT TIME ZONE 'America/Argentina/Cordoba')::date AS day,
           count(*) FILTER (WHERE activity_code IN ('FACULTAD_CONSULTADA', 'HISTORIAL_FACULTAD_CONSULTADO')) AS queries,
           count(*) FILTER (WHERE activity_code IN ('PDF_FACULTAD_GENERADO', 'PDF_CONSOLIDADO_GENERADO')) AS reports
         FROM user_activity_events
         WHERE occurred_at >= now() - interval '30 days'
         GROUP BY 1
       )
       SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
         COALESCE(l.logins, 0) AS logins,
         COALESCE(l.active_users, 0) AS active_users,
         COALESCE(a.queries, 0) AS queries,
         COALESCE(a.reports, 0) AS reports
       FROM days d
       LEFT JOIN logins l ON l.day = d.day
       LEFT JOIN activities a ON a.day = d.day
       ORDER BY d.day`,
    ),
    query<{
      month: string;
      logins: number | string;
      active_users: number | string;
    }>(
      `WITH months AS (
         SELECT generate_series(
           date_trunc('month', current_timestamp AT TIME ZONE 'America/Argentina/Cordoba') - interval '11 months',
           date_trunc('month', current_timestamp AT TIME ZONE 'America/Argentina/Cordoba'),
           interval '1 month'
         )::date AS month
       ), logins AS (
         SELECT date_trunc('month', occurred_at AT TIME ZONE 'America/Argentina/Cordoba')::date AS month,
           count(*) AS logins,
           count(DISTINCT target_user_id) AS active_users
         FROM audit_log
         WHERE action_code = 'INICIO_SESION' AND outcome_code = 'EXITO'
           AND occurred_at >= now() - interval '12 months'
         GROUP BY 1
       )
       SELECT to_char(m.month, 'YYYY-MM') AS month,
         COALESCE(l.logins, 0) AS logins,
         COALESCE(l.active_users, 0) AS active_users
       FROM months m
       LEFT JOIN logins l ON l.month = m.month
       ORDER BY m.month`,
    ),
  ]);

  const users = userResult.rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role_code,
    status: row.status_code,
    protectedPrincipal: row.protected_principal,
    firstLoginAt: iso(row.first_login_at),
    lastLoginAt: iso(row.last_login_at),
    lastActivityAt: iso(row.last_activity_at),
    totalLogins: number(row.total_logins),
    logins7Days: number(row.logins_7_days),
    logins30Days: number(row.logins_30_days),
    distinctAccessDays: number(row.distinct_access_days),
    queries30Days: number(row.queries_30_days),
    reports30Days: number(row.reports_30_days),
    activeSessions: number(row.active_sessions),
  }));
  const activeThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalUsers: users.length,
      activeUsers30Days: users.filter((user) =>
        user.lastActivityAt && new Date(user.lastActivityAt).getTime() >= activeThreshold
      ).length,
      neverLoggedIn: users.filter((user) => !user.firstLoginAt).length,
      totalLogins30Days: users.reduce((sum, user) => sum + user.logins30Days, 0),
      totalQueries30Days: users.reduce((sum, user) => sum + user.queries30Days, 0),
      totalReports30Days: users.reduce((sum, user) => sum + user.reports30Days, 0),
    },
    users,
    daily: dailyResult.rows.map((row) => ({
      day: row.day,
      logins: number(row.logins),
      activeUsers: number(row.active_users),
      queries: number(row.queries),
      reports: number(row.reports),
    })),
    monthly: monthlyResult.rows.map((row) => ({
      month: row.month,
      logins: number(row.logins),
      activeUsers: number(row.active_users),
    })),
  };
}

export async function userAccessHistory(userId: string) {
  if (!UUID_PATTERN.test(userId)) {
    throw new UserStatisticsError("El identificador de usuario no es válido.");
  }
  const [userResult, loginResult, activityResult] = await Promise.all([
    query<{ id: string; email: string; display_name: string }>(
      "SELECT id, email, display_name FROM app_users WHERE id = $1",
      [userId],
    ),
    query<{
      occurred_at: Date | string;
      ip_address: string | null;
      user_agent: string | null;
    }>(
      `SELECT occurred_at, ip_address, user_agent
       FROM audit_log
       WHERE target_user_id = $1
         AND action_code = 'INICIO_SESION'
         AND outcome_code = 'EXITO'
       ORDER BY occurred_at DESC, id DESC
       LIMIT 100`,
      [userId],
    ),
    query<{
      occurred_at: Date | string;
      activity_code: UserActivityCode;
      faculty_id: string | null;
    }>(
      `SELECT occurred_at, activity_code, faculty_id
       FROM user_activity_events
       WHERE user_id = $1
       ORDER BY occurred_at DESC, id DESC
       LIMIT 100`,
      [userId],
    ),
  ]);
  const user = userResult.rows[0];
  if (!user) throw new UserStatisticsError("Usuario no encontrado.", 404);
  return {
    user: { id: user.id, email: user.email, displayName: user.display_name },
    logins: loginResult.rows.map((row) => ({
      occurredAt: iso(row.occurred_at),
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
    })),
    activities: activityResult.rows.map((row) => ({
      occurredAt: iso(row.occurred_at),
      activityCode: row.activity_code,
      facultyId: row.faculty_id,
    })),
  };
}
