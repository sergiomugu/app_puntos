import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import type { PoolClient } from "pg";
import {
  ROLE_DETAILS,
  hasPermission,
  type Permission,
  type RoleCode,
  type UserStatusCode,
} from "./access-control";
import { query, withTransaction } from "./database";
import {
  requestContext,
  safeReturnPath,
  sameOriginError,
  type RequestContext,
} from "./request-security";
import {
  institutionalEmailRequirement,
  isInstitutionalDomain,
  isInstitutionalEmail,
} from "./institutional-email";

const SESSION_IDLE_MINUTES_DEFAULT = 30;
const SESSION_ABSOLUTE_HOURS_DEFAULT = 8;
const REAUTH_MINUTES_DEFAULT = 10;
const OAUTH_FLOW_SECONDS = 10 * 60;
const AUTH_FAILURE_LIMIT = 5;
const AUTH_FAILURE_WINDOW_MINUTES = 15;

export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string;
  role: RoleCode;
  roleLabel: string;
  status: UserStatusCode;
  protectedPrincipal: boolean;
  facultyIds: string[];
};

export type AuthenticatedSession = {
  id: string;
  user: AuthenticatedUser;
  csrfToken: string;
  createdAt: string;
  lastSeenAt: string;
  absoluteExpiresAt: string;
  reauthenticatedAt: string;
  reauthFresh: boolean;
};

type OAuthIntent = "login" | "reauth";
type OAuthFlow = {
  random: string;
  expiresAt: number;
  intent: OAuthIntent;
  returnTo: string;
};

type AuthorizedUserRow = {
  id: string;
  email: string;
  display_name: string;
  role_code: RoleCode;
  status_code: UserStatusCode;
  google_sub: string | null;
  protected_principal: boolean;
  valid_from: Date | string | null;
  valid_until: Date | string | null;
  faculty_ids: string[];
};

type SessionRow = AuthorizedUserRow & {
  session_id: string;
  created_at: Date | string;
  last_seen_at: Date | string;
  absolute_expires_at: Date | string;
  reauthenticated_at: Date | string;
};

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const base64url = (value: Buffer) => value.toString("base64url");

function safeEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function authSecret() {
  return process.env.PUNTOS_AUTH_SECRET ?? "";
}

function hmac(purpose: string, value: string) {
  return createHmac("sha256", authSecret())
    .update(`${purpose}:${value}`, "utf8")
    .digest("base64url");
}

function configuredBaseUrl() {
  return process.env.PUNTOS_BASE_URL?.trim().replace(/\/$/, "") ?? "";
}

function cookieSecure() {
  return process.env.PUNTOS_COOKIE_SECURE !== "false";
}

export function sessionCookieName() {
  return cookieSecure() ? "__Host-puntos_session" : "puntos_session_dev";
}

export function oauthCookieName() {
  return cookieSecure() ? "__Host-puntos_oauth" : "puntos_oauth_dev";
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: cookieSecure(),
    path: "/",
    maxAge: positiveInteger(
      process.env.PUNTOS_SESSION_ABSOLUTE_HOURS,
      SESSION_ABSOLUTE_HOURS_DEFAULT,
    ) * 60 * 60,
  };
}

export function oauthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: cookieSecure(),
    path: "/",
    maxAge: OAUTH_FLOW_SECONDS,
  };
}

export function authenticationConfigurationErrors() {
  const errors: string[] = [];
  const baseUrl = configuredBaseUrl();
  try {
    const parsed = new URL(baseUrl);
    if (cookieSecure() && parsed.protocol !== "https:") {
      errors.push("PUNTOS_BASE_URL debe utilizar HTTPS.");
    }
    if (
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname !== "/" && parsed.pathname !== "")
    ) {
      errors.push("PUNTOS_BASE_URL debe contener solamente el origen público, sin ruta, credenciales, consulta ni fragmento.");
    }
  } catch {
    errors.push("Falta PUNTOS_BASE_URL o no tiene un formato válido.");
  }
  if (
    !process.env.PUNTOS_GOOGLE_CLIENT_ID?.trim() ||
    /REEMPLAZAR/i.test(process.env.PUNTOS_GOOGLE_CLIENT_ID)
  ) {
    errors.push("Falta PUNTOS_GOOGLE_CLIENT_ID.");
  }
  if (
    !process.env.PUNTOS_GOOGLE_CLIENT_SECRET?.trim() ||
    /REEMPLAZAR/i.test(process.env.PUNTOS_GOOGLE_CLIENT_SECRET)
  ) {
    errors.push("Falta PUNTOS_GOOGLE_CLIENT_SECRET.");
  }
  const domainHint = process.env.PUNTOS_GOOGLE_HOSTED_DOMAIN_HINT?.trim();
  if (domainHint && domainHint !== "*" && !isInstitutionalDomain(domainHint)) {
    errors.push("PUNTOS_GOOGLE_HOSTED_DOMAIN_HINT debe ser *, unrc.edu.ar o un subdominio institucional válido.");
  }
  if (authSecret().length < 64 || /REEMPLAZAR/i.test(authSecret())) {
    errors.push("PUNTOS_AUTH_SECRET debe tener al menos 64 caracteres aleatorios.");
  }
  if (process.env.NODE_ENV === "production" && !cookieSecure()) {
    errors.push("PUNTOS_COOKIE_SECURE no puede desactivarse en producción.");
  }
  return errors;
}

function callbackUrl() {
  return `${configuredBaseUrl()}/api/auth/google/callback`;
}

function oauthClient() {
  return new OAuth2Client({
    clientId: process.env.PUNTOS_GOOGLE_CLIENT_ID,
    clientSecret: process.env.PUNTOS_GOOGLE_CLIENT_SECRET,
    redirectUri: callbackUrl(),
  });
}

function signFlow(encodedPayload: string) {
  return hmac("oauth-flow", encodedPayload);
}

export function createOAuthFlow(
  intent: OAuthIntent = "login",
  returnTo = "/",
  now = Date.now(),
) {
  if (authenticationConfigurationErrors().length) {
    throw new Error("La autenticación institucional no está configurada.");
  }
  const payload: OAuthFlow = {
    random: base64url(randomBytes(32)),
    expiresAt: now + OAUTH_FLOW_SECONDS * 1000,
    intent,
    returnTo: safeReturnPath(returnTo),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const cookieToken = `${encoded}.${signFlow(encoded)}`;
  const state = hmac("oauth-state", payload.random);
  const nonce = hmac("oauth-nonce", payload.random);
  const codeVerifier = hmac("oauth-pkce", payload.random);
  const codeChallenge = createHash("sha256")
    .update(codeVerifier, "utf8")
    .digest("base64url");
  return { payload, cookieToken, state, nonce, codeVerifier, codeChallenge };
}

export function verifyOAuthFlow(
  cookieToken: string | undefined,
  suppliedState: string | null,
  now = Date.now(),
) {
  if (!cookieToken || !suppliedState || authenticationConfigurationErrors().length) {
    return undefined;
  }
  const [encoded, signature, extra] = cookieToken.split(".");
  if (!encoded || !signature || extra || !safeEqual(signature, signFlow(encoded))) {
    return undefined;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as OAuthFlow;
    if (
      typeof payload.random !== "string" ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt <= now ||
      !["login", "reauth"].includes(payload.intent) ||
      safeReturnPath(payload.returnTo) !== payload.returnTo
    ) {
      return undefined;
    }
    const expectedState = hmac("oauth-state", payload.random);
    if (!safeEqual(suppliedState, expectedState)) return undefined;
    return {
      payload,
      nonce: hmac("oauth-nonce", payload.random),
      codeVerifier: hmac("oauth-pkce", payload.random),
    };
  } catch {
    return undefined;
  }
}

export function googleAuthorizationUrl(
  flow: ReturnType<typeof createOAuthFlow>,
) {
  return oauthClient().generateAuthUrl({
    access_type: "online",
    scope: ["openid", "email", "profile"],
    state: flow.state,
    nonce: flow.nonce,
    // hd facilita la selección de cuenta, pero la autorización real se valida
    // después mediante email_verified, email, sub, audiencia y el claim hd.
    hd: process.env.PUNTOS_GOOGLE_HOSTED_DOMAIN_HINT?.trim() || "*",
    include_granted_scopes: false,
    prompt: flow.payload.intent === "reauth" ? "login" : "select_account",
    code_challenge: flow.codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });
}

export async function verifyGoogleAuthorizationCode(
  code: string,
  flow: NonNullable<ReturnType<typeof verifyOAuthFlow>>,
) {
  const client = oauthClient();
  const { tokens } = await client.getToken({
    code,
    codeVerifier: flow.codeVerifier,
    redirect_uri: callbackUrl(),
  });
  if (!tokens.id_token) throw new Error("Google no devolvió una identidad verificable.");
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.PUNTOS_GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (
    !payload ||
    !payload.sub ||
    !payload.email ||
    payload.email_verified !== true ||
    !isInstitutionalDomain(payload.hd) ||
    payload.nonce !== flow.nonce
  ) {
    throw new Error("La identidad institucional de Google no superó todos los controles.");
  }
  const email = payload.email.toLowerCase();
  if (!isInstitutionalEmail(email)) {
    throw new Error(institutionalEmailRequirement());
  }
  return { sub: payload.sub, email, displayName: payload.name?.trim() || email };
}

function accessDenialReason(user: AuthorizedUserRow, now = new Date()) {
  if (user.status_code === "SUSPENDIDO") return "El acceso está suspendido transitoriamente.";
  if (user.status_code === "BAJA") return "El usuario fue dado de baja.";
  if (user.valid_from && new Date(user.valid_from) > now) return "La autorización todavía no está vigente.";
  if (user.valid_until && new Date(user.valid_until) <= now) return "La autorización venció.";
  return undefined;
}

async function findAuthorizedUser(client: PoolClient, email: string) {
  const result = await client.query<AuthorizedUserRow>(
    `SELECT u.*,
       COALESCE((SELECT array_agg(s.faculty_id ORDER BY s.faculty_id)
         FROM user_faculty_scopes s WHERE s.user_id = u.id), '{}') AS faculty_ids
     FROM app_users u
     WHERE lower(u.email) = $1
     FOR UPDATE`,
    [email],
  );
  return result.rows[0];
}

export async function authorizeInstitutionalIdentity(identity: {
  sub: string;
  email: string;
  displayName: string;
}) {
  return withTransaction(async (client) => {
    const user = await findAuthorizedUser(client, identity.email);
    if (!user) throw new Error("La cuenta institucional no fue autorizada por el Administrador General.");
    const denied = accessDenialReason(user);
    if (denied) throw new Error(denied);
    if (user.google_sub && user.google_sub !== identity.sub) {
      throw new Error("La identidad de Google no coincide con la vinculada a este usuario.");
    }
    const result = await client.query<AuthorizedUserRow>(
      `UPDATE app_users
       SET google_sub = COALESCE(google_sub, $2),
           status_code = CASE WHEN status_code = 'PENDIENTE' THEN 'ACTIVO' ELSE status_code END,
           display_name = CASE WHEN display_name = '' THEN $3 ELSE display_name END,
           last_login_at = now()
       WHERE id = $1
       RETURNING *`,
      [user.id, identity.sub, identity.displayName],
    );
    return { ...result.rows[0], faculty_ids: user.faculty_ids };
  });
}

function csrfToken(rawSessionToken: string) {
  return hmac("csrf", rawSessionToken);
}

export async function createDatabaseSession(
  userId: string,
  context: RequestContext,
) {
  const rawToken = base64url(randomBytes(32));
  const csrf = csrfToken(rawToken);
  const idleMinutes = positiveInteger(
    process.env.PUNTOS_SESSION_IDLE_MINUTES,
    SESSION_IDLE_MINUTES_DEFAULT,
  );
  const absoluteHours = positiveInteger(
    process.env.PUNTOS_SESSION_ABSOLUTE_HOURS,
    SESSION_ABSOLUTE_HOURS_DEFAULT,
  );
  const result = await query<{ id: string }>(
    `INSERT INTO user_sessions
      (user_id, token_hash, csrf_hash, idle_expires_at, absolute_expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, now() + ($4::int * interval '1 minute'),
       now() + ($5::int * interval '1 hour'), $6, $7)
     RETURNING id`,
    [userId, sha256(rawToken), sha256(csrf), idleMinutes, absoluteHours, context.ipAddress, context.userAgent],
  );
  return { id: result.rows[0].id, rawToken, csrfToken: csrf };
}

function toIso(value: Date | string) {
  return new Date(value).toISOString();
}

function buildSession(row: SessionRow, rawToken: string): AuthenticatedSession {
  const reauthMinutes = positiveInteger(
    process.env.PUNTOS_REAUTH_MINUTES,
    REAUTH_MINUTES_DEFAULT,
  );
  const reauthenticatedAt = toIso(row.reauthenticated_at);
  return {
    id: row.session_id,
    user: {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role_code,
      roleLabel: ROLE_DETAILS[row.role_code].label,
      status: row.status_code,
      protectedPrincipal: row.protected_principal,
      facultyIds: row.faculty_ids ?? [],
    },
    csrfToken: csrfToken(rawToken),
    createdAt: toIso(row.created_at),
    lastSeenAt: toIso(row.last_seen_at),
    absoluteExpiresAt: toIso(row.absolute_expires_at),
    reauthenticatedAt,
    reauthFresh: Date.now() - new Date(reauthenticatedAt).getTime() <= reauthMinutes * 60_000,
  };
}

export async function sessionFromRawToken(rawToken: string | undefined) {
  if (!rawToken || authenticationConfigurationErrors().length) return undefined;
  const idleMinutes = positiveInteger(
    process.env.PUNTOS_SESSION_IDLE_MINUTES,
    SESSION_IDLE_MINUTES_DEFAULT,
  );
  const result = await query<SessionRow>(
    `WITH valid_session AS (
       SELECT s.id
       FROM user_sessions s
       JOIN app_users u ON u.id = s.user_id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.idle_expires_at > now()
         AND s.absolute_expires_at > now()
         AND u.status_code = 'ACTIVO'
         AND (u.valid_from IS NULL OR u.valid_from <= now())
         AND (u.valid_until IS NULL OR u.valid_until > now())
       FOR UPDATE OF s
     ), touched AS (
       UPDATE user_sessions s
       SET last_seen_at = now(),
           idle_expires_at = LEAST(
             absolute_expires_at,
             now() + ($2::int * interval '1 minute')
           )
       FROM valid_session v
       WHERE s.id = v.id
       RETURNING s.*
     )
     SELECT u.*,
       t.id AS session_id,
       t.created_at,
       t.last_seen_at,
       t.absolute_expires_at,
       t.reauthenticated_at,
       COALESCE(array_agg(sc.faculty_id ORDER BY sc.faculty_id)
         FILTER (WHERE sc.faculty_id IS NOT NULL), '{}') AS faculty_ids
     FROM touched t
     JOIN app_users u ON u.id = t.user_id
     LEFT JOIN user_faculty_scopes sc ON sc.user_id = u.id
     GROUP BY u.id, t.id, t.created_at, t.last_seen_at, t.absolute_expires_at, t.reauthenticated_at`,
    [sha256(rawToken), idleMinutes],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  const csrf = csrfToken(rawToken);
  const stored = await query<{ matches: boolean }>(
    "SELECT csrf_hash = $2 AS matches FROM user_sessions WHERE id = $1",
    [row.session_id, sha256(csrf)],
  );
  if (!stored.rows[0]?.matches) return undefined;
  return buildSession(row, rawToken);
}

export async function getSession() {
  const cookieStore = await cookies();
  return sessionFromRawToken(cookieStore.get(sessionCookieName())?.value);
}

export function requirePermission(
  session: AuthenticatedSession | undefined,
  permission: Permission,
) {
  return Boolean(session && hasPermission(session.user.role, permission));
}

export function mutationProtectionError(
  request: Request,
  session: AuthenticatedSession,
) {
  const originError = sameOriginError(request);
  if (originError) return originError;
  const supplied = request.headers.get("x-csrf-token") || "";
  if (!supplied || !safeEqual(supplied, session.csrfToken)) {
    return "La protección de la sesión no pudo validarse.";
  }
  return undefined;
}

export async function revokeSession(sessionId: string, reason: string) {
  await query(
    `UPDATE user_sessions
     SET revoked_at = COALESCE(revoked_at, now()), revoked_reason = COALESCE(revoked_reason, $2)
     WHERE id = $1`,
    [sessionId, reason.slice(0, 500)],
  );
}

export async function revokeAllUserSessions(
  client: PoolClient,
  userId: string,
  reason: string,
) {
  await client.query(
    `UPDATE user_sessions
     SET revoked_at = COALESCE(revoked_at, now()), revoked_reason = COALESCE(revoked_reason, $2)
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason.slice(0, 500)],
  );
}

export async function rotateSessionAfterReauthentication(
  current: AuthenticatedSession,
  identitySub: string,
  context: RequestContext,
) {
  const matched = await query<{ matches: boolean }>(
    "SELECT google_sub = $2 AS matches FROM app_users WHERE id = $1 AND status_code = 'ACTIVO'",
    [current.user.id, identitySub],
  );
  if (!matched.rows[0]?.matches) {
    throw new Error("La cuenta confirmada no coincide con el usuario de la sesión.");
  }
  await revokeSession(current.id, "Rotación por nueva verificación de identidad");
  return createDatabaseSession(current.user.id, context);
}

export async function auditEvent(input: {
  actor?: AuthenticatedSession;
  targetUserId?: string;
  action: string;
  outcome: "EXITO" | "RECHAZADO" | "ERROR";
  reason?: string;
  previousValues?: unknown;
  newValues?: unknown;
  metadata?: Record<string, unknown>;
  context: RequestContext;
}, client?: PoolClient) {
  const sql = `INSERT INTO audit_log
      (actor_user_id, actor_email, target_user_id, action_code, outcome_code,
       reason, previous_values, new_values, metadata, session_id, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12)`;
  const values = [
      input.actor?.user.id ?? null,
      input.actor?.user.email ?? null,
      input.targetUserId ?? null,
      input.action,
      input.outcome,
      input.reason?.slice(0, 1000) ?? null,
      input.previousValues === undefined ? null : JSON.stringify(input.previousValues),
      input.newValues === undefined ? null : JSON.stringify(input.newValues),
      JSON.stringify(input.metadata ?? {}),
      input.actor?.id ?? null,
      input.context.ipAddress,
      input.context.userAgent,
    ];
  if (client) await client.query(sql, values);
  else await query(sql, values);
}

function rateLimitKey(context: RequestContext) {
  return sha256(`${authSecret()}:${context.ipAddress}`);
}

export async function authenticationIsBlocked(context: RequestContext) {
  const result = await query<{ blocked: boolean }>(
    "SELECT blocked_until > now() AS blocked FROM security_rate_limits WHERE key_hash = $1",
    [rateLimitKey(context)],
  );
  return result.rows[0]?.blocked === true;
}

export async function registerAuthenticationFailure(context: RequestContext) {
  await query(
    `INSERT INTO security_rate_limits
      (key_hash, window_started_at, attempt_count, blocked_until)
     VALUES ($1, now(), 1, NULL)
     ON CONFLICT (key_hash) DO UPDATE SET
       window_started_at = CASE
         WHEN security_rate_limits.window_started_at < now() - ($2::int * interval '1 minute')
         THEN now() ELSE security_rate_limits.window_started_at END,
       attempt_count = CASE
         WHEN security_rate_limits.window_started_at < now() - ($2::int * interval '1 minute')
         THEN 1 ELSE security_rate_limits.attempt_count + 1 END,
       blocked_until = CASE
         WHEN (CASE
           WHEN security_rate_limits.window_started_at < now() - ($2::int * interval '1 minute')
           THEN 1 ELSE security_rate_limits.attempt_count + 1 END) >= $3
         THEN now() + ($2::int * interval '1 minute')
         ELSE security_rate_limits.blocked_until END,
       updated_at = now()`,
    [rateLimitKey(context), AUTH_FAILURE_WINDOW_MINUTES, AUTH_FAILURE_LIMIT],
  );
}

export async function clearAuthenticationFailures(context: RequestContext) {
  await query("DELETE FROM security_rate_limits WHERE key_hash = $1", [rateLimitKey(context)]);
}

export function contextFor(request: Request) {
  return requestContext(request);
}
