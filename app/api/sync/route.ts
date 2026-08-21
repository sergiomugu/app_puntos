import { NextRequest, NextResponse } from "next/server";
import {
  auditEvent,
  contextFor,
  getSession,
  mutationProtectionError,
  requirePermission,
} from "../../../lib/server/auth";
import { publicDashboard } from "../../../lib/server/public-state";
import { NO_STORE_HEADERS } from "../../../lib/server/request-security";
import {
  sanitizedMessage,
  syncDriveNow,
} from "../../../lib/server/sync-drive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "La sesión venció. Ingrese nuevamente." },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  if (!requirePermission(session, "sync:manual")) {
    return NextResponse.json(
      { error: "Su perfil no puede iniciar la verificación manual de archivos." },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }
  const protectionError = mutationProtectionError(request, session);
  if (protectionError) {
    return NextResponse.json(
      { error: protectionError },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }
  try {
    const state = await syncDriveNow();
    await auditEvent({
      actor: session,
      action: "VERIFICACION_MANUAL_DRIVE",
      outcome: "EXITO",
      context: contextFor(request),
      metadata: { driveStatus: state.drive.status },
    });
    return NextResponse.json(publicDashboard(state, {
      role: session.user.role,
      facultyIds: session.user.facultyIds,
    }), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    console.error("Fallo al verificar Google Drive", error);
    await auditEvent({
      actor: session,
      action: "VERIFICACION_MANUAL_DRIVE",
      outcome: "ERROR",
      reason: sanitizedMessage(error),
      context: contextFor(request),
    }).catch(() => undefined);
    return NextResponse.json(
      { error: sanitizedMessage(error) },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
