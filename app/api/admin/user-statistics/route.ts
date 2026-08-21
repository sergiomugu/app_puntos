import { NextResponse } from "next/server";
import { getSession, requirePermission } from "@/lib/server/auth";
import { NO_STORE_HEADERS } from "@/lib/server/request-security";
import { userStatisticsOverview } from "@/lib/server/user-statistics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
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
    return NextResponse.json(
      await userStatisticsOverview(),
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("No se pudieron recuperar las estadísticas de usuarios", error);
    return NextResponse.json(
      { error: "No se pudieron recuperar las estadísticas de usuarios." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
