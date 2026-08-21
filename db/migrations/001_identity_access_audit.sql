CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL,
  role_code text NOT NULL CHECK (role_code IN (
    'ADMIN_GENERAL',
    'OPERADOR_DGPFP',
    'RESPONSABLE_FACULTAD',
    'CONSULTA_GENERAL',
    'CONSULTA_FACULTAD'
  )),
  status_code text NOT NULL DEFAULT 'PENDIENTE' CHECK (status_code IN (
    'PENDIENTE', 'ACTIVO', 'SUSPENDIDO', 'BAJA'
  )),
  google_sub text UNIQUE,
  protected_principal boolean NOT NULL DEFAULT false,
  valid_from timestamptz,
  valid_until timestamptz,
  suspension_reason text,
  deactivation_reason text,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app_users(id),
  updated_by uuid REFERENCES app_users(id),
  suspended_at timestamptz,
  suspended_by uuid REFERENCES app_users(id),
  deactivated_at timestamptz,
  deactivated_by uuid REFERENCES app_users(id),
  CONSTRAINT app_users_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT app_users_institutional_email CHECK (email ~ '^[^@[:space:]]+@ac\.unrc\.edu\.ar$'),
  CONSTRAINT app_users_validity_order CHECK (
    valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from
  ),
  CONSTRAINT app_users_protected_admin CHECK (
    NOT protected_principal OR role_code = 'ADMIN_GENERAL'
  )
);

CREATE UNIQUE INDEX app_users_email_unique ON app_users ((lower(email)));
CREATE UNIQUE INDEX app_users_one_protected_principal
  ON app_users (protected_principal)
  WHERE protected_principal;
CREATE INDEX app_users_status_role_idx ON app_users (status_code, role_code);

CREATE TABLE user_faculty_scopes (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  faculty_id text NOT NULL CHECK (faculty_id IN ('ayv', 'exa', 'ing', 'eco', 'hum')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app_users(id),
  PRIMARY KEY (user_id, faculty_id)
);

CREATE TABLE user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  token_hash char(64) NOT NULL UNIQUE,
  csrf_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  reauthenticated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_reason text,
  ip_address text,
  user_agent text,
  CONSTRAINT user_sessions_expiration_order CHECK (
    idle_expires_at > created_at AND absolute_expires_at > created_at
  )
);

CREATE INDEX user_sessions_active_user_idx
  ON user_sessions (user_id, absolute_expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX user_sessions_expiration_idx
  ON user_sessions (idle_expires_at, absolute_expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  actor_email text,
  target_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  action_code text NOT NULL,
  outcome_code text NOT NULL CHECK (outcome_code IN ('EXITO', 'RECHAZADO', 'ERROR')),
  reason text,
  previous_values jsonb,
  new_values jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  session_id uuid REFERENCES user_sessions(id) ON DELETE SET NULL,
  ip_address text,
  user_agent text
);

CREATE INDEX audit_log_occurred_at_idx ON audit_log (occurred_at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_user_id, occurred_at DESC);
CREATE INDEX audit_log_target_idx ON audit_log (target_user_id, occurred_at DESC);
CREATE INDEX audit_log_action_idx ON audit_log (action_code, occurred_at DESC);

CREATE TABLE security_rate_limits (
  key_hash char(64) PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL CHECK (attempt_count >= 0),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX security_rate_limits_cleanup_idx
  ON security_rate_limits (updated_at);

CREATE OR REPLACE FUNCTION set_row_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER app_users_set_updated_at
BEFORE UPDATE ON app_users
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

CREATE OR REPLACE FUNCTION protect_principal_administrator()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.protected_principal AND (
    NOT NEW.protected_principal OR
    NEW.role_code <> 'ADMIN_GENERAL' OR
    NEW.status_code <> 'ACTIVO' OR
    NEW.email <> OLD.email
  ) THEN
    RAISE EXCEPTION 'El Administrador General principal está protegido';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER app_users_protect_principal
BEFORE UPDATE ON app_users
FOR EACH ROW EXECUTE FUNCTION protect_principal_administrator();

CREATE OR REPLACE FUNCTION validate_user_faculty_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  checked_user_id uuid;
  checked_role text;
  scope_count integer;
BEGIN
  IF TG_TABLE_NAME = 'app_users' THEN
    checked_user_id := COALESCE(NEW.id, OLD.id);
  ELSE
    checked_user_id := COALESCE(NEW.user_id, OLD.user_id);
  END IF;
  SELECT role_code INTO checked_role FROM app_users WHERE id = checked_user_id;
  IF checked_role IS NULL THEN RETURN NULL; END IF;
  SELECT count(*) INTO scope_count FROM user_faculty_scopes WHERE user_id = checked_user_id;
  IF checked_role IN ('RESPONSABLE_FACULTAD', 'CONSULTA_FACULTAD') AND scope_count = 0 THEN
    RAISE EXCEPTION 'El perfil requiere al menos una Facultad asignada';
  END IF;
  IF checked_role NOT IN ('RESPONSABLE_FACULTAD', 'CONSULTA_FACULTAD') AND scope_count > 0 THEN
    RAISE EXCEPTION 'El perfil institucional no admite Facultades individuales';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER app_users_validate_faculty_scope
AFTER INSERT OR UPDATE ON app_users
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_user_faculty_scope();

CREATE CONSTRAINT TRIGGER user_faculty_scopes_validate_user
AFTER INSERT OR UPDATE OR DELETE ON user_faculty_scopes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_user_faculty_scope();

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'El registro de auditoría es inalterable';
END;
$$;

CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
