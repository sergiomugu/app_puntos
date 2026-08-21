ALTER TABLE app_users
  DROP CONSTRAINT app_users_institutional_email;

ALTER TABLE app_users
  ADD CONSTRAINT app_users_institutional_email CHECK (
    email ~ '^[^@[:space:]]+@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*unrc\.edu\.ar$'
  );

COMMENT ON CONSTRAINT app_users_institutional_email ON app_users IS
  'Admite el dominio raíz unrc.edu.ar y subdominios institucionales DNS válidos';
