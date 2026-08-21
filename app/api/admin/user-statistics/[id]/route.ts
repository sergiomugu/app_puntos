import { NextResponse } from "next/server";
import { getSession, requirePermission } from "@/lib/server/auth";
import { NO_STORE_HEADERS } from "@/lib/server/request-security";
import {
  UserStatisticsError,
  userAccessHistory,
} from "@/lib/server/user-statistics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "La sesión venció. Ingrese nuevamente." },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  if (!requirePermission(session, "users:manage")) {
    return NextResponse.json(
      { error: "No tiene permiso para consultar estadísticas de usuarios." },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }
  try {
    const { id } = await context.params;
    return NextResponse.json(
      await userAccessHistory(id),
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const status = error instanceof UserStatisticsError ? error.status : 500;
    const message = error instanceof UserStatisticsError
      ? error.message
      : "No se pudo recuperar el historial del usuario.";
    return NextResponse.json(
      { error: message },
      { status, headers: NO_STORE_HEADERS },
    );
  }
}
