import pg, { type PoolClient, type QueryResultRow } from "pg";

const globalDatabase = globalThis as typeof globalThis & {
  __controlPuntosPool?: pg.Pool;
};

export function databaseConfigurationErrors() {
  const errors: string[] = [];
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    errors.push("Falta DATABASE_URL.");
  } else {
    try {
      const parsed = new URL(databaseUrl);
      if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
        errors.push("DATABASE_URL no corresponde a PostgreSQL.");
      }
    } catch {
      errors.push("DATABASE_URL no tiene un formato válido.");
    }
  }
  return errors;
}

function pool() {
  if (databaseConfigurationErrors().length) {
    throw new Error("La base de datos de identidad no está configurada.");
  }
  if (!globalDatabase.__controlPuntosPool) {
    globalDatabase.__controlPuntosPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: process.env.PUNTOS_DATABASE_SSL === "true"
        ? { rejectUnauthorized: true }
        : false,
      application_name: "control-puntos-docentes-unrc",
    });
    globalDatabase.__controlPuntosPool.on("error", (error) => {
      console.error("Conexión PostgreSQL inactiva con error", error);
    });
  }
  return globalDatabase.__controlPuntosPool;
}

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
) {
  return pool().query<T>(text, values);
}

export async function withTransaction<T>(
  operation: (client: PoolClient) => Promise<T>,
) {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function databaseHealthy() {
  if (databaseConfigurationErrors().length) return false;
  try {
    await query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

