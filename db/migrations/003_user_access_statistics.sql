CREATE TABLE user_activity_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  session_id uuid REFERENCES user_sessions(id) ON DELETE SET NULL,
  activity_code text NOT NULL CHECK (activity_code IN (
    'TABLERO_CONSULTADO',
    'FACULTAD_CONSULTADA',
    'HISTORIAL_FACULTAD_CONSULTADO',
    'PDF_FACULTAD_GENERADO',
    'PDF_CONSOLIDADO_GENERADO'
  )),
  faculty_id text CHECK (faculty_id IS NULL OR faculty_id IN ('ayv', 'exa', 'ing', 'eco', 'hum')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT user_activity_faculty_required CHECK (
    (activity_code IN (
      'FACULTAD_CONSULTADA',
      'HISTORIAL_FACULTAD_CONSULTADO',
      'PDF_FACULTAD_GENERADO'
    ) AND faculty_id IS NOT NULL)
    OR
    (activity_code IN ('TABLERO_CONSULTADO', 'PDF_CONSOLIDADO_GENERADO') AND faculty_id IS NULL)
  )
);

CREATE INDEX user_activity_events_user_date_idx
  ON user_activity_events (user_id, occurred_at DESC);
CREATE INDEX user_activity_events_code_date_idx
  ON user_activity_events (activity_code, occurred_at DESC);
CREATE INDEX user_activity_events_date_idx
  ON user_activity_events (occurred_at DESC);

CREATE OR REPLACE FUNCTION prevent_user_activity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'El registro de actividad de usuarios es inalterable';
END;
$$;

CREATE TRIGGER user_activity_events_no_update
BEFORE UPDATE ON user_activity_events
FOR EACH ROW EXECUTE FUNCTION prevent_user_activity_mutation();

CREATE TRIGGER user_activity_events_no_delete
BEFORE DELETE ON user_activity_events
FOR EACH ROW EXECUTE FUNCTION prevent_user_activity_mutation();
