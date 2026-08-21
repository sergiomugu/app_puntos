import { NextResponse } from "next/server";
import { getSession, requirePermission } from "../../../../../lib/server/auth";
import { canAccessFaculty } from "../../../../../lib/server/access-control";
import { NO_STORE_HEADERS } from "../../../../../lib/server/request-security";
import {
  publicAttempt,
  sessionActivity,
} from "../../../../../lib/server/public-state";
import { getState } from "../../../../../lib/server/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "La sesión venció. Ingrese nuevamente." },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  const { id } = await context.params;
  const state = await getState();
  const faculty = state.faculties.find((item) => item.id === id);
  if (!faculty) {
    return NextResponse.json(
      { error: "Facultad no encontrada." },
      { status: 404 },
    );
  }
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") === "full" ? "full" : "activity";
  if (!canAccessFaculty(session.user.role, session.user.facultyIds, id)) {
    return NextResponse.json(
      { error: "La Facultad solicitada no pertenece a su alcance autorizado." },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }
  const permission = scope === "full" ? "history:full" : "history:activity";
  if (!requirePermission(session, permission)) {
    return NextResponse.json(
      { error: "Su perfil no puede consultar este historial." },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }
  const parsedSince = Number.parseInt(url.searchParams.get("sinceAttempt") ?? "0", 10);
  const sinceAttempt = Number.isFinite(parsedSince) && parsedSince >= 0
    ? parsedSince
    : 0;
  const completeHistory = state.history[id] ?? [];
  const imports = scope === "full"
    ? completeHistory
    : sessionActivity(completeHistory, sinceAttempt);
  return NextResponse.json(
    {
      faculty: { id: faculty.id, name: faculty.name },
      scope,
      retainedRecords: completeHistory.length,
      imports: imports.map(publicAttempt),
    },
    { headers: NO_STORE_HEADERS },
  );
}
