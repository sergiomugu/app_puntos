import { NextRequest, NextResponse } from "next/server";
import { getSession, requirePermission } from "@/lib/server/auth";
import { NO_STORE_HEADERS } from "@/lib/server/request-security";
import { listAuditLog } from "@/lib/server/user-management";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "La sesión venció. Ingrese nuevamente." },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  if (!requirePermission(session, "audit:read")) {
    return NextResponse.json(
      { error: "No tiene permiso para consultar la auditoría de seguridad." },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }
  const offset = Number.parseInt(request.nextUrl.searchParams.get("offset") || "0", 10);
  const entries = await listAuditLog({
    action: request.nextUrl.searchParams.get("action") ?? undefined,
    userId: request.nextUrl.searchParams.get("userId") ?? undefined,
    offset: Number.isFinite(offset) ? offset : 0,
  });
  return NextResponse.json({ entries, limit: 100, offset }, { headers: NO_STORE_HEADERS });
}
