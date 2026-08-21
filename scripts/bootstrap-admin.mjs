import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("Falta DATABASE_URL.");

const email = (
  process.env.PUNTOS_INITIAL_ADMIN_EMAIL || "rtorrespicco@ac.unrc.edu.ar"
).trim().toLowerCase();
const displayName = (
  process.env.PUNTOS_INITIAL_ADMIN_NAME || "Ramiro Torres Picco"
).trim();
const institutionalEmail = /^[^@\s]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*unrc\.edu\.ar$/;
if (!institutionalEmail.test(email)) {
  throw new Error("PUNTOS_INITIAL_ADMIN_EMAIL debe pertenecer a unrc.edu.ar o a un subdominio institucional válido.");
}
if (displayName.length < 3) throw new Error("Falta el nombre del Administrador General.");

const ssl = process.env.PUNTOS_DATABASE_SSL === "true"
  ? { rejectUnauthorized: true }
  : false;
const client = new pg.Client({ connectionString: databaseUrl, ssl });
await client.connect();
try {
  await client.query("BEGIN");
  const protectedPrincipal = await client.query(
    "SELECT id, email, role_code, protected_principal FROM app_users WHERE protected_principal = true FOR UPDATE",
  );
  if (protectedPrincipal.rowCount) {
    const current = protectedPrincipal.rows[0];
    if (current.email !== email) {
      throw new Error(`Ya existe otro Administrador General principal protegido: ${current.email}.`);
    }
    await client.query(
      `UPDATE app_users
       SET display_name = $2, role_code = 'ADMIN_GENERAL', status_code = 'ACTIVO'
       WHERE id = $1`,
      [current.id, displayName],
    );
  } else {
    const existing = await client.query(
      "SELECT id FROM app_users WHERE lower(email) = $1 FOR UPDATE",
      [email],
    );
    if (existing.rowCount) {
      await client.query(
        `UPDATE app_users
         SET display_name = $2, role_code = 'ADMIN_GENERAL', status_code = 'ACTIVO', protected_principal = true
         WHERE id = $1`,
        [existing.rows[0].id, displayName],
      );
    } else {
      await client.query(
        `INSERT INTO app_users
          (email, display_name, role_code, status_code, protected_principal)
         VALUES ($1, $2, 'ADMIN_GENERAL', 'ACTIVO', true)`,
        [email, displayName],
      );
    }
  }
  await client.query("COMMIT");
  console.log(`Administrador General principal preparado: ${email}`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
