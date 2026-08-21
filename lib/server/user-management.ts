import type { PoolClient } from "pg";
import {
  ROLE_DETAILS,
  isRoleCode,
  normalizeFacultyScopes,
  publicRoleCatalog,
  validateRoleScopes,
  type FacultyId,
  type RoleCode,
  type UserStatusCode,
} from "./access-control";
import {
  auditEvent,
  revokeAllUserSessions,
  type AuthenticatedSession,
} from "./auth";
import { query, withTransaction } from "./database";
import type { RequestContext } from "./request-security";
import {
  institutionalEmailRequirement,
  isInstitutionalEmail,
} from "./institutional-email";

export class UserManagementError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizedUserId(value: string, field = "El identificador de usuario") {
  const id = value.trim();
  if (!UUID_PATTERN.test(id)) {
    throw new UserManagementError(`${field} no es válido.`, 400);
  }
  return id;
}

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  role_code: RoleCode;
  status_code: UserStatusCode;
  protected_principal: boolean;
  google_sub: string | null;
  valid_from: Date | string | null;
  valid_until: Date | string | null;
  last_login_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  suspension_reason: string | null;
  deactivation_reason: string | null;
  faculty_ids: string[];
  active_sessions: number | string;
};

type AccessInput = {
  displayName: string;
  role: RoleCode;
  facultyIds: FacultyId[];
  validFrom: string | null;
  validUntil: string | null;
  reason: string;
};

function iso(value: Date | string | null) {
  return value ? new Date(value).toISOString() : null;
}

function publicUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role_code,
    roleLabel: ROLE_DETAILS[row.role_code].label,
    status: row.status_code,
    protectedPrincipal: row.protected_principal,
    identityLinked: Boolean(row.google_sub),
    facultyIds: row.faculty_ids ?? [],
    validFrom: iso(row.valid_from),
    validUntil: iso(row.valid_until),
    lastLoginAt: iso(row.last_login_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    suspensionReason: row.suspension_reason,
    deactivationReason: row.deactivation_reason,
    activeSessions: Number(row.active_sessions || 0),
  };
}

function normalizedText(value: unknown, field: string, minimum = 3, maximum = 160) {
  if (typeof value !== "string") {
    throw new UserManagementError(`Falta ${field}.`);
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new UserManagementError(`${field} debe tener entre ${minimum} y ${maximum} caracteres.`);
  }
  return normalized;
}

function normalizedReason(value: unknown) {
  return normalizedText(value, "el motivo", 5, 1000);
}

function normalizedDate(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new UserManagementError(`${field} no tiene una fecha válida.`);
  }
  return new Date(value).toISOString();
}

function parseAccessInput(body: Record<string, unknown>): AccessInput {
  if (!isRoleCode(body.role)) throw new UserManagementError("El perfil seleccionado no es válido.");
  const facultyIds = normalizeFacultyScopes(body.facultyIds);
  const scopeError = validateRoleScopes(body.role, facultyIds);
  if (scopeError) throw new UserManagementError(scopeError);
  const validFrom = normalizedDate(body.validFrom, "La fecha de inicio");
  const validUntil = normalizedDate(body.validUntil, "La fecha de finalización");
  if (validFrom && validUntil && new Date(validUntil) <= new Date(validFrom)) {
    throw new UserManagementError("La fecha de finalización debe ser posterior al inicio.");
  }
  return {
    displayName: normalizedText(body.displayName, "el nombre y apellido", 3, 160),
    role: body.role,
    facultyIds,
    validFrom,
    validUntil,
    reason: normalizedReason(body.reason),
  };
}

function normalizeEmail(value: unknown) {
  if (typeof value !== "string") throw new UserManagementError("Falta el correo institucional.");
  const email = value.trim().toLowerCase();
  if (!isInstitutionalEmail(email)) {
    throw new UserManagementError(institutionalEmailRequirement());
  }
  return email;
}

function assertCanGrantRole(actor: AuthenticatedSession, role: RoleCode) {
  if (role === "ADMIN_GENERAL" && !actor.user.protectedPrincipal) {
    throw new UserManagementError(
      "Sólo el Administrador General principal protegido puede designar otro Administrador General.",
      403,
    );
  }
}

async function replaceScopes(
  client: PoolClient,
  userId: string,
  facultyIds: FacultyId[],
  actorId: string,
) {
  await client.query("DELETE FROM user_faculty_scopes WHERE user_id = $1", [userId]);
  for (const facultyId of facultyIds) {
    await client.query(
      `INSERT INTO user_faculty_scopes (user_id, faculty_id, created_by)
       VALUES ($1, $2, $3)`,
      [userId, facultyId, actorId],
    );
  }
}

async function lockedUser(client: PoolClient, userId: string) {
  const result = await client.query<UserRow>(
    `SELECT u.*,
       COALESCE((SELECT array_agg(s.faculty_id ORDER BY s.faculty_id)
         FROM user_faculty_scopes s WHERE s.user_id = u.id), '{}') AS faculty_ids,
       (SELECT count(*) FROM user_sessions ss
         WHERE ss.user_id = u.id AND ss.revoked_at IS NULL
           AND ss.idle_expires_at > now() AND ss.absolute_expires_at > now()) AS active_sessions
     FROM app_users u
     WHERE u.id = $1
     FOR UPDATE`,
    [userId],
  );
  if (!result.rows[0]) throw new UserManagementError("Usuario no encontrado.", 404);
  return result.rows[0];
}

export async function listUsers(filters: {
  search?: string;
  role?: string;
  status?: string;
} = {}) {
  const search = filters.search?.trim().slice(0, 160) || null;
  const role = isRoleCode(filters.role) ? filters.role : null;
  const allowedStatuses = ["PENDIENTE", "ACTIVO", "SUSPENDIDO", "BAJA"];
  const status = allowedStatuses.includes(filters.status ?? "") ? filters.status : null;
  const result = await query<UserRow>(
    `SELECT u.*,
       COALESCE((SELECT array_agg(s.faculty_id ORDER BY s.faculty_id)
         FROM user_faculty_scopes s WHERE s.user_id = u.id), '{}') AS faculty_ids,
       (SELECT count(*) FROM user_sessions ss
         WHERE ss.user_id = u.id AND ss.revoked_at IS NULL
           AND ss.idle_expires_at > now() AND ss.absolute_expires_at > now()) AS active_sessions
     FROM app_users u
     WHERE ($1::text IS NULL OR u.email ILIKE '%' || $1 || '%' OR u.display_name ILIKE '%' || $1 || '%')
       AND ($2::text IS NULL OR u.role_code = $2)
       AND ($3::text IS NULL OR u.status_code = $3)
     ORDER BY u.protected_principal DESC, u.display_name, u.email
     LIMIT 500`,
    [search, role, status],
  );
  return result.rows.map(publicUser);
}

export async function createUser(
  actor: AuthenticatedSession,
  body: Record<string, unknown>,
  context: RequestContext,
) {
  const email = normalizeEmail(body.email);
  const access = parseAccessInput(body);
  assertCanGrantRole(actor, access.role);

  return withTransaction(async (client) => {
    const existing = await client.query(
      "SELECT id FROM app_users WHERE lower(email) = $1 FOR UPDATE",
      [email],
    );
    if (existing.rowCount) {
      throw new UserManagementError("Ya existe un usuario registrado con ese correo.", 409);
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO app_users
        (email, display_name, role_code, status_code, valid_from, valid_until, created_by, updated_by)
       VALUES ($1, $2, $3, 'PENDIENTE', $4, $5, $6, $6)
       RETURNING id`,
      [
        email,
        access.displayName,
        access.role,
        access.validFrom,
        access.validUntil,
        actor.user.id,
      ],
    );
    const userId = inserted.rows[0].id;
    await replaceScopes(client, userId, access.facultyIds, actor.user.id);
    await auditEvent({
      actor,
      targetUserId: userId,
      action: "USUARIO_ALTA",
      outcome: "EXITO",
      reason: access.reason,
      newValues: {
        email,
        displayName: access.displayName,
        role: access.role,
        facultyIds: access.facultyIds,
        validFrom: access.validFrom,
        validUntil: access.validUntil,
        status: "PENDIENTE",
      },
      context,
    }, client);
    return userId;
  });
}

function snapshot(user: UserRow) {
  return {
    displayName: user.display_name,
    role: user.role_code,
    status: user.status_code,
    facultyIds: user.faculty_ids,
    validFrom: iso(user.valid_from),
    validUntil: iso(user.valid_until),
  };
}

function assertTargetMutable(actor: AuthenticatedSession, target: UserRow) {
  if (target.protected_principal) {
    throw new UserManagementError(
      "El Administrador General principal está protegido y no puede modificarse desde la interfaz.",
      403,
    );
  }
  if (target.role_code === "ADMIN_GENERAL" && !actor.user.protectedPrincipal) {
    throw new UserManagementError(
      "Sólo el Administrador General principal puede modificar otro administrador.",
      403,
    );
  }
  if (target.id === actor.user.id) {
    throw new UserManagementError("No puede modificar su propia autorización desde esta pantalla.", 403);
  }
}

export async function updateUser(
  actor: AuthenticatedSession,
  userId: string,
  body: Record<string, unknown>,
  context: RequestContext,
) {
  userId = normalizedUserId(userId);
  const action = typeof body.action === "string" ? body.action : "";
  return withTransaction(async (client) => {
    const target = await lockedUser(client, userId);
    assertTargetMutable(actor, target);
    const before = snapshot(target);
    let after: Record<string, unknown>;
    let auditAction: string;
    let reason: string;

    if (action === "update_access" || action === "reinstate") {
      if (action === "update_access" && target.status_code === "BAJA") {
        throw new UserManagementError("Use Reincorporar para un usuario dado de baja.");
      }
      if (action === "reinstate" && target.status_code !== "BAJA") {
        throw new UserManagementError("Sólo puede reincorporarse un usuario dado de baja.");
      }
      const access = parseAccessInput(body);
      assertCanGrantRole(actor, access.role);
      const newStatus = action === "reinstate"
        ? (target.google_sub ? "ACTIVO" : "PENDIENTE")
        : target.status_code;
      await client.query(
        `UPDATE app_users
         SET display_name = $2, role_code = $3, status_code = $4,
             valid_from = $5, valid_until = $6, updated_by = $7,
             deactivation_reason = CASE WHEN $8::boolean THEN NULL ELSE deactivation_reason END,
             deactivated_at = CASE WHEN $8::boolean THEN NULL ELSE deactivated_at END,
             deactivated_by = CASE WHEN $8::boolean THEN NULL ELSE deactivated_by END
         WHERE id = $1`,
        [
          userId,
          access.displayName,
          access.role,
          newStatus,
          access.validFrom,
          access.validUntil,
          actor.user.id,
          action === "reinstate",
        ],
      );
      await replaceScopes(client, userId, access.facultyIds, actor.user.id);
      reason = access.reason;
      auditAction = action === "reinstate" ? "USUARIO_REINCORPORADO" : "USUARIO_ACCESO_MODIFICADO";
      after = {
        displayName: access.displayName,
        role: access.role,
        status: newStatus,
        facultyIds: access.facultyIds,
        validFrom: access.validFrom,
        validUntil: access.validUntil,
      };
    } else if (action === "suspend") {
      if (!["ACTIVO", "PENDIENTE"].includes(target.status_code)) {
        throw new UserManagementError("El usuario no se encuentra en un estado que admita suspensión.");
      }
      reason = normalizedReason(body.reason);
      await client.query(
        `UPDATE app_users
         SET status_code = 'SUSPENDIDO', suspension_reason = $2,
             suspended_at = now(), suspended_by = $3, updated_by = $3
         WHERE id = $1`,
        [userId, reason, actor.user.id],
      );
      auditAction = "USUARIO_SUSPENDIDO";
      after = { ...before, status: "SUSPENDIDO" };
    } else if (action === "reactivate") {
      if (target.status_code !== "SUSPENDIDO") {
        throw new UserManagementError("Sólo puede reactivarse un usuario suspendido.");
      }
      reason = normalizedReason(body.reason);
      const newStatus = target.google_sub ? "ACTIVO" : "PENDIENTE";
      await client.query(
        `UPDATE app_users
         SET status_code = $2, suspension_reason = NULL,
             suspended_at = NULL, suspended_by = NULL, updated_by = $3
         WHERE id = $1`,
        [userId, newStatus, actor.user.id],
      );
      auditAction = "USUARIO_REACTIVADO";
      after = { ...before, status: newStatus };
    } else if (action === "deactivate") {
      if (target.status_code === "BAJA") {
        throw new UserManagementError("El usuario ya se encuentra dado de baja.");
      }
      reason = normalizedReason(body.reason);
      await client.query(
        `UPDATE app_users
         SET status_code = 'BAJA', deactivation_reason = $2,
             deactivated_at = now(), deactivated_by = $3, updated_by = $3
         WHERE id = $1`,
        [userId, reason, actor.user.id],
      );
      auditAction = "USUARIO_BAJA_LOGICA";
      after = { ...before, status: "BAJA" };
    } else {
      throw new UserManagementError("La acción solicitada no es válida.");
    }

    await revokeAllUserSessions(client, userId, `${auditAction}: ${reason}`);
    await auditEvent({
      actor,
      targetUserId: userId,
      action: auditAction,
      outcome: "EXITO",
      reason,
      previousValues: before,
      newValues: after,
      context,
    }, client);
    return { action: auditAction };
  });
}

export async function listAuditLog(filters: {
  action?: string;
  userId?: string;
  offset?: number;
}) {
  const action = filters.action?.trim().slice(0, 100) || null;
  const userId = filters.userId?.trim()
    ? normalizedUserId(filters.userId, "El filtro de usuario")
    : null;
  const offset = Math.max(0, Math.min(10_000, filters.offset ?? 0));
  const result = await query<{
    id: string;
    occurred_at: Date | string;
    actor_email: string | null;
    target_email: string | null;
    action_code: string;
    outcome_code: string;
    reason: string | null;
    previous_values: unknown;
    new_values: unknown;
    metadata: unknown;
    ip_address: string | null;
    user_agent: string | null;
  }>(
    `SELECT a.id, a.occurred_at, a.actor_email, target.email AS target_email,
       a.action_code, a.outcome_code, a.reason, a.previous_values,
       a.new_values, a.metadata, a.ip_address, a.user_agent
     FROM audit_log a
     LEFT JOIN app_users target ON target.id = a.target_user_id
     WHERE ($1::text IS NULL OR a.action_code = $1)
       AND ($2::uuid IS NULL OR a.target_user_id = $2::uuid OR a.actor_user_id = $2::uuid)
     ORDER BY a.occurred_at DESC, a.id DESC
     LIMIT 100 OFFSET $3`,
    [action, userId, offset],
  );
  return result.rows.map((entry) => ({
    id: entry.id,
    occurredAt: iso(entry.occurred_at),
    actorEmail: entry.actor_email,
    targetEmail: entry.target_email,
    action: entry.action_code,
    outcome: entry.outcome_code,
    reason: entry.reason,
    previousValues: entry.previous_values,
    newValues: entry.new_values,
    metadata: entry.metadata,
    ipAddress: entry.ip_address,
    userAgent: entry.user_agent,
  }));
}

export function administrationCatalog() {
  return {
    roles: publicRoleCatalog(),
    faculties: [
      { id: "ayv", code: 1, short: "AyV", name: "Facultad de Agronomía y Veterinaria" },
      { id: "exa", code: 2, short: "EXA", name: "Facultad de Ciencias Exactas Fco. Qcas. y Naturales" },
      { id: "ing", code: 3, short: "ING", name: "Facultad de Ingeniería" },
      { id: "eco", code: 4, short: "ECO", name: "Facultad de Ciencias Económicas" },
      { id: "hum", code: 5, short: "HUM", name: "Facultad de Ciencias Humanas" },
    ],
  };
}
